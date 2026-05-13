import type { Profile, Project, Task, TimeEvent, UserRole } from "@/types/database";
import {
  buildActiveProjectIdSet,
  isTaskInActiveOperations,
} from "@/lib/archive-utils";
import {
  isEffectiveCompletedTask,
  isEffectiveOpenTask,
} from "@/lib/task-status";
import { parseGeoPoint } from "@/lib/worker-utils";
import {
  EXTREME_SHIFT_MINUTES,
  WARN_SHIFT_MINUTES,
  shiftDurationSeverity,
  type ShiftSeverity,
} from "@/lib/shift-review";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
  ManagerTimelineItem,
  ManagerWorkspaceData,
  PayrollPreview,
  PayrollPreviewLine,
  PayrollWorkerTotal,
} from "@/lib/manager-types";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDate(value: string): Date {
  return new Date(value);
}

function isSameOrAfter(left: Date, right: Date): boolean {
  return left.getTime() >= right.getTime();
}

function startOfWeek(date = new Date()): Date {
  const base = new Date(date);
  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + mondayOffset);
  return base;
}

export function isOpenTask(task: Pick<Task, "status" | "deleted_at" | "completed_at">): boolean {
  return isEffectiveOpenTask(task);
}

export function isCompletedTask(task: Pick<Task, "status" | "deleted_at" | "completed_at">): boolean {
  return isEffectiveCompletedTask(task);
}

function endOfDay(date = new Date()): Date {
  const base = new Date(date);
  base.setHours(23, 59, 59, 999);
  return base;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

/**
 * Minutes of a single session that overlap a [windowStart, windowEnd)
 * date range.
 *
 * Why this exists:
 *   The Overview project-load card renders "X minutes this week" for
 *   each project. The original aggregation pinned the entire shift to
 *   the week of clockInTime, so a 144h shift that started last
 *   Wednesday looked like 0m this week even though most of its hours
 *   actually fell after Monday. Splitting by overlap fixes that.
 *
 * Open shifts have no clockOutTime; in that case `now` (parametrised
 * for tests, defaults to wall-clock) is used as the upper bound.
 *
 * Returns 0 when the session does not overlap the window at all.
 */
export function sessionMinutesInWindow(args: {
  clockInTime: string;
  clockOutTime: string | null;
  windowStart: Date;
  windowEnd: Date;
  now?: Date;
}): number {
  const start = new Date(args.clockInTime).getTime();
  const end = args.clockOutTime
    ? new Date(args.clockOutTime).getTime()
    : (args.now ?? new Date()).getTime();
  const winStart = args.windowStart.getTime();
  const winEnd = args.windowEnd.getTime();
  const effStart = Math.max(start, winStart);
  const effEnd = Math.min(end, winEnd);
  if (effEnd <= effStart) return 0;
  return Math.round((effEnd - effStart) / 60_000);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isManagerRole(role: UserRole): boolean {
  return role === "owner" || role === "admin" || role === "manager" || role === "supervisor";
}

/**
 * True for roles that should see financial / profitability data
 * (labor cost, paid amounts, project payroll cost, profit estimates).
 * Currently scoped to `owner` + `admin` — `manager` and `supervisor`
 * see operational data only.
 *
 * Used as a UI gate, NOT as a security boundary. The DB is the source
 * of truth for who can read which row; this helper just hides
 * money-shaped numbers from manager-tier roles whose RLS already
 * permits the read but whose product role does not.
 */
export function isOwnerRole(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export interface WorkerLabelInput {
  id: string;
  name: string;
  role: UserRole;
  email?: string | null;
  phone?: string | null;
}

/**
 * Build a per-worker disambiguation suffix. When a name is unique
 * across the supplied roster the suffix is empty; when more than one
 * worker shares the same trimmed/lowercased name the suffix surfaces
 * the first available identifier in this order:
 *
 *   1. role chip                — always available
 *   2. email                    — when present + non-empty
 *   3. phone                    — when present + non-empty
 *   4. short id (first 6 chars) — last-resort fallback
 *
 * The role chip is included even when an email / phone is present so
 * the UI can render `Oliver (worker · oliver@…)` and not lose the
 * "what is this person?" context that managers use to triage.
 *
 * Returns the descriptor pieces — callers compose the final string,
 * which keeps i18n out of the helper.
 */
export interface WorkerDisambiguation {
  /** True when this worker shares a name with at least one other in the roster. */
  isAmbiguous: boolean;
  /** Role label, always present. */
  role: UserRole;
  /** Email if known and ambiguous, else null. */
  email: string | null;
  /** Phone if known and ambiguous, else null. */
  phone: string | null;
  /** Short id when neither email nor phone is available, else null. */
  shortId: string | null;
}

export function buildWorkerDisambiguationMap<T extends WorkerLabelInput>(
  workers: T[],
): Map<string, WorkerDisambiguation> {
  // Count names case-insensitively and trimmed so "Oliver" / "oliver "
  // collide. The roster stays small (org-scoped) so a simple Map is fine.
  const nameCounts = new Map<string, number>();
  for (const worker of workers) {
    const key = (worker.name ?? "").trim().toLowerCase();
    if (!key) continue;
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const out = new Map<string, WorkerDisambiguation>();
  for (const worker of workers) {
    const key = (worker.name ?? "").trim().toLowerCase();
    const collisions = key ? nameCounts.get(key) ?? 0 : 0;
    const isAmbiguous = collisions > 1;
    const email = isAmbiguous && worker.email && worker.email.trim() ? worker.email.trim() : null;
    const phone = !email && isAmbiguous && worker.phone && worker.phone.trim() ? worker.phone.trim() : null;
    const shortId = !email && !phone && isAmbiguous ? worker.id.slice(0, 6) : null;
    out.set(worker.id, {
      isAmbiguous,
      role: worker.role,
      email,
      phone,
      shortId,
    });
  }
  return out;
}

/**
 * Compose the final display string. Always shows the worker's name;
 * appends the disambiguation suffix only when needed.
 *
 *   "Oliver"
 *   "Oliver (worker · oliver@example.com)"
 *   "Oliver (worker · +1-555-…)"
 *   "Oliver (worker · 7f8d2a)"
 */
export function formatWorkerDisplayLabel(
  worker: WorkerLabelInput,
  disambiguation: WorkerDisambiguation | undefined,
): string {
  const name = worker.name?.trim() || "Unknown";
  if (!disambiguation || !disambiguation.isAmbiguous) {
    return name;
  }
  const pieces: string[] = [disambiguation.role];
  if (disambiguation.email) pieces.push(disambiguation.email);
  else if (disambiguation.phone) pieces.push(disambiguation.phone);
  else if (disambiguation.shortId) pieces.push(disambiguation.shortId);
  return `${name} (${pieces.join(" · ")})`;
}

/**
 * Project-transfer gap thresholds. A "transfer gap" is the wall-clock
 * time between a worker's clock_out from project A and their next
 * clock_in to a different project B. Same-project re-clocks are not
 * gaps (worker stayed on site).
 *
 *   warning  > 30 minutes  — long enough to be more than a coffee break
 *   critical > 90 minutes  — likely a real travel/dispute window the
 *                            owner needs to look at by hand
 *
 * Read-only review signal. Does NOT block payroll, write to time_events,
 * or auto-close shifts.
 */
export const TRANSFER_GAP_WARNING_MINUTES = 30;
export const TRANSFER_GAP_CRITICAL_MINUTES = 90;

export type TransferGapSeverity = "warning" | "critical";

export interface TransferGap {
  /** Stable composite id for React keys: outEventId-inEventId. */
  id: string;
  profileId: string;
  workerName: string;
  fromProjectId: string;
  toProjectId: string;
  fromProject: string;
  toProject: string;
  outTime: string;
  inTime: string;
  gapMinutes: number;
  severity: TransferGapSeverity;
}

/**
 * Detect project-transfer gaps across one or many workers.
 *
 * For each worker, sort their clock_in / clock_out events by time and
 * scan adjacent pairs. A pair is a transfer gap when:
 *   • the earlier event is a clock_out (or auto_out), AND
 *   • the later event is a clock_in, AND
 *   • the two events touch different projects, AND
 *   • the wall-clock gap exceeds TRANSFER_GAP_WARNING_MINUTES.
 *
 * Same-project re-clocks (e.g. worker took a lunch break and came back)
 * are intentionally ignored — they are not transfers.
 */
export function detectTransferGaps(args: {
  timeEvents: TimeEvent[];
  projects: Project[];
  profiles: Profile[];
  /** Optional ISO floor — events before this are skipped. */
  sinceIso?: string;
  /** Optional filter — only return gaps for this worker. */
  profileId?: string;
}): TransferGap[] {
  const projectsById = new Map(args.projects.map((p) => [p.id, p]));
  const profilesById = new Map(args.profiles.map((p) => [p.id, p]));
  const sinceMs = args.sinceIso ? new Date(args.sinceIso).getTime() : null;

  const events = args.timeEvents
    .filter((e) => {
      if (
        e.event_type !== "clock_in" &&
        e.event_type !== "clock_out" &&
        e.event_type !== "auto_out"
      ) {
        return false;
      }
      if (args.profileId && e.profile_id !== args.profileId) return false;
      if (sinceMs !== null && new Date(e.event_time).getTime() < sinceMs) {
        return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        new Date(a.event_time).getTime() - new Date(b.event_time).getTime(),
    );

  const byProfile = new Map<string, TimeEvent[]>();
  for (const event of events) {
    const list = byProfile.get(event.profile_id) ?? [];
    list.push(event);
    byProfile.set(event.profile_id, list);
  }

  const gaps: TransferGap[] = [];
  for (const [profileId, list] of byProfile) {
    for (let i = 0; i < list.length - 1; i++) {
      const out = list[i];
      const next = list[i + 1];
      if (out.event_type !== "clock_out" && out.event_type !== "auto_out") {
        continue;
      }
      if (next.event_type !== "clock_in") continue;
      if (out.project_id === next.project_id) continue;

      const gapMinutes = Math.round(
        (new Date(next.event_time).getTime() -
          new Date(out.event_time).getTime()) /
          60_000,
      );
      if (gapMinutes <= TRANSFER_GAP_WARNING_MINUTES) continue;

      const severity: TransferGapSeverity =
        gapMinutes > TRANSFER_GAP_CRITICAL_MINUTES ? "critical" : "warning";

      gaps.push({
        id: `${out.id}-${next.id}`,
        profileId,
        workerName: profilesById.get(profileId)?.name ?? "Unknown",
        fromProjectId: out.project_id,
        toProjectId: next.project_id,
        fromProject: projectsById.get(out.project_id)?.name ?? "Unknown",
        toProject: projectsById.get(next.project_id)?.name ?? "Unknown",
        outTime: out.event_time,
        inTime: next.event_time,
        gapMinutes,
        severity,
      });
    }
  }

  return gaps.sort((a, b) => b.gapMinutes - a.gapMinutes);
}

export const TRANSFER_GAP_COLOR: Record<TransferGapSeverity, string> = {
  warning: "#f59e0b",
  critical: "var(--red)",
};

export interface OvertimeBreakdown {
  regularHours: number;
  overtimeHours: number;
  regularPay: number;
  overtimePay: number;
  grossPay: number;
}

/**
 * Split a worker's hours/rate into regular + OT pay using a weekly
 * threshold (default 40h) and OT multiplier (default 1.5×).
 *
 * Negative inputs and NaN are clamped to zero. All money values are
 * rounded to two decimal places.
 *
 * Lives here so it can be unit-tested in isolation; PayrollCalculator
 * has the same math inline in computeOt() — keep both in sync until
 * the calculator is refactored to import this.
 */
export function computeOvertime(
  hours: number,
  rate: number,
  options: { threshold?: number; multiplier?: number } = {},
): OvertimeBreakdown {
  const threshold = options.threshold ?? 40;
  const multiplier = options.multiplier ?? 1.5;
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;

  const regularHours = Math.min(safeHours, threshold);
  const overtimeHours = Math.max(0, safeHours - threshold);
  const regularPay = roundCurrency(regularHours * safeRate);
  const overtimePay = roundCurrency(overtimeHours * safeRate * multiplier);
  const grossPay = roundCurrency(regularPay + overtimePay);

  return {
    regularHours: Math.round(regularHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
    regularPay,
    overtimePay,
    grossPay,
  };
}

export function buildManagerSessions(data: ManagerWorkspaceData): ManagerSession[] {
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const eventsByProfile = new Map<string, typeof data.timeEvents>();

  for (const event of data.timeEvents) {
    const profileEvents = eventsByProfile.get(event.profile_id) ?? [];
    profileEvents.push(event);
    eventsByProfile.set(event.profile_id, profileEvents);
  }

  const sessions: ManagerSession[] = [];

  for (const [profileId, profileEvents] of eventsByProfile.entries()) {
    const profile = profilesById.get(profileId);
    if (!profile) {
      continue;
    }

    const orderedEvents = [...profileEvents].sort((left, right) => {
      return toDate(left.event_time).getTime() - toDate(right.event_time).getTime();
    });
    let openClockIn = null as (typeof orderedEvents)[number] | null;

    for (const event of orderedEvents) {
      if (event.event_type === "clock_in") {
        openClockIn = event;
        continue;
      }

      if (event.event_type !== "clock_out" && event.event_type !== "auto_out") {
        continue;
      }

      if (!openClockIn) {
        continue;
      }

      const project = projectsById.get(openClockIn.project_id);
      const clockInTime = toDate(openClockIn.event_time);
      const clockOutTime = toDate(event.event_time);

      const closingMeta = (event.metadata ?? null) as
        | { checkout_note?: unknown }
        | null;
      const checkoutNote =
        closingMeta && typeof closingMeta.checkout_note === "string"
          ? closingMeta.checkout_note.trim() || null
          : null;

      sessions.push({
        id: openClockIn.id,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        projectId: openClockIn.project_id,
        projectName: project?.name ?? "Unknown project",
        clockInEventId: openClockIn.id,
        clockOutEventId: event.id,
        clockInTime: openClockIn.event_time,
        clockOutTime: event.event_time,
        durationMinutes: minutesBetween(clockInTime, clockOutTime),
        checkoutStatus: event.video_status,
        isOpen: false,
        eventIds: [openClockIn.id, event.id],
        checkoutNote,
      });

      openClockIn = null;
    }

    if (openClockIn) {
      const project = projectsById.get(openClockIn.project_id);
      sessions.push({
        id: openClockIn.id,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        projectId: openClockIn.project_id,
        projectName: project?.name ?? "Unknown project",
        clockInEventId: openClockIn.id,
        clockOutEventId: null,
        clockInTime: openClockIn.event_time,
        clockOutTime: null,
        durationMinutes: minutesBetween(toDate(openClockIn.event_time), new Date()),
        checkoutStatus: "not_required",
        isOpen: true,
        eventIds: [openClockIn.id],
        checkoutNote: null,
      });
    }
  }

  return sessions.sort((left, right) => {
    return toDate(right.clockInTime).getTime() - toDate(left.clockInTime).getTime();
  });
}

export function buildProjectSummaries(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  options: { includeFinancials?: boolean } = {},
): ManagerProjectSummary[] {
  const includeFinancials = options.includeFinancials ?? true;
  const weekStart = startOfWeek();
  const weekEnd = addDays(weekStart, 7);
  const assignmentsByProject = new Map<string, Set<string>>();
  const openTasksByProject = new Map<string, number>();
  const onSiteByProject = new Map<string, Set<string>>();
  const weekMinutesByProject = new Map<string, number>();
  const longShiftCountByProject = new Map<string, number>();
  const extremeShiftCountByProject = new Map<string, number>();
  const longestShiftByProject = new Map<
    string,
    { workerName: string; durationMinutes: number }
  >();
  const receiptTotalByProject = new Map<string, number>();

  if (includeFinancials) {
    for (const item of data.media) {
      if (item.deleted_at || !item.project_id) continue;
      const meta = item.metadata as Record<string, unknown>;
      if (meta?.category !== "receipt") continue;
      const amount = Number(meta.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      receiptTotalByProject.set(
        item.project_id,
        roundCurrency((receiptTotalByProject.get(item.project_id) ?? 0) + amount),
      );
    }
  }

  const lastActivityByProject = new Map<string, string>();
  for (const event of data.timeEvents) {
    const current = lastActivityByProject.get(event.project_id);
    if (!current || event.event_time > current) {
      lastActivityByProject.set(event.project_id, event.event_time);
    }
  }

  for (const assignment of data.assignments) {
    const ids = assignmentsByProject.get(assignment.project_id) ?? new Set<string>();
    ids.add(assignment.profile_id);
    assignmentsByProject.set(assignment.project_id, ids);
  }

  for (const task of data.tasks) {
    if (!task.project_id || !isOpenTask(task)) {
      continue;
    }

    openTasksByProject.set(
      task.project_id,
      (openTasksByProject.get(task.project_id) ?? 0) + 1,
    );
  }

  for (const session of sessions) {
    if (session.isOpen) {
      const ids = onSiteByProject.get(session.projectId) ?? new Set<string>();
      ids.add(session.profileId);
      onSiteByProject.set(session.projectId, ids);
    }

    // Count minutes that overlap the current week, NOT minutes whose
    // clockInTime happens to fall in the current week. A shift that
    // started last Wednesday and ended this Tuesday should contribute
    // its Monday → Tuesday tail to "this week" without the Wed → Sun
    // pre-week portion.
    const overlap = sessionMinutesInWindow({
      clockInTime: session.clockInTime,
      clockOutTime: session.clockOutTime,
      windowStart: weekStart,
      windowEnd: weekEnd,
    });
    if (overlap > 0) {
      weekMinutesByProject.set(
        session.projectId,
        (weekMinutesByProject.get(session.projectId) ?? 0) + overlap,
      );
    }

    // Abnormal-shift counters and "longest shift" detail are computed
    // against the FULL session duration regardless of week overlap —
    // the workload card needs to flag a 144h shift on the project even
    // if only its tail crosses into the current week.
    if (session.durationMinutes >= EXTREME_SHIFT_MINUTES) {
      extremeShiftCountByProject.set(
        session.projectId,
        (extremeShiftCountByProject.get(session.projectId) ?? 0) + 1,
      );
    } else if (session.durationMinutes >= WARN_SHIFT_MINUTES) {
      longShiftCountByProject.set(
        session.projectId,
        (longShiftCountByProject.get(session.projectId) ?? 0) + 1,
      );
    }
    const currentLongest = longestShiftByProject.get(session.projectId);
    if (
      !currentLongest ||
      session.durationMinutes > currentLongest.durationMinutes
    ) {
      longestShiftByProject.set(session.projectId, {
        workerName: session.profileName,
        durationMinutes: session.durationMinutes,
      });
    }
  }

  // Pre-index media per project — most recent first, receipts excluded,
  // soft-deletes excluded. Keep the first 6 for the strip + a separate
  // total count so the card can render "+N" overflow badge.
  const mediaByProject = new Map<string, ManagerProjectSummary["recentMedia"]>();
  const mediaTotalByProject = new Map<string, number>();
  const sortedMedia = [...data.media].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (const item of sortedMedia) {
    if (item.deleted_at || !item.project_id) continue;
    const meta = item.metadata as Record<string, unknown> | null;
    if (meta?.category === "receipt") continue;
    mediaTotalByProject.set(
      item.project_id,
      (mediaTotalByProject.get(item.project_id) ?? 0) + 1,
    );
    const list = mediaByProject.get(item.project_id) ?? [];
    if (list.length < 6) {
      list.push({
        id: item.id,
        media_type: item.media_type,
        storage_path: item.storage_path,
        filename: item.filename ?? null,
      });
      mediaByProject.set(item.project_id, list);
    }
  }

  return data.projects
    .map((project) => {
      const siteCoordinates = parseGeoPoint(project.site_point);

      return {
        ...project,
        assignedWorkerCount: assignmentsByProject.get(project.id)?.size ?? 0,
        onSiteWorkerCount: onSiteByProject.get(project.id)?.size ?? 0,
        openTaskCount: openTasksByProject.get(project.id) ?? 0,
        weekMinutes: weekMinutesByProject.get(project.id) ?? 0,
        receiptTotal: includeFinancials ? receiptTotalByProject.get(project.id) ?? 0 : 0,
        lastActivityTime: lastActivityByProject.get(project.id) ?? null,
        siteCoordinates,
        hasValidSiteCoordinates: Boolean(siteCoordinates),
        recentMedia: mediaByProject.get(project.id) ?? [],
        recentMediaTotal: mediaTotalByProject.get(project.id) ?? 0,
        longShiftCount: longShiftCountByProject.get(project.id) ?? 0,
        extremeShiftCount: extremeShiftCountByProject.get(project.id) ?? 0,
        longestShift: longestShiftByProject.get(project.id) ?? null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildProfileSummaries(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  financeAccessUserIds?: ReadonlySet<string>,
): ManagerProfileSummary[] {
  const weekStart = startOfWeek();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const assignmentsByProfile = new Map<string, string[]>();
  const openTasksByProfile = new Map<string, number>();
  const weekMinutesByProfile = new Map<string, number>();
  const openSessionsByProfile = new Map<string, ManagerSession>();
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const activeProjectIds = buildActiveProjectIdSet(data.projects);
  const videoUploadedTodayByProfile = new Set<string>();

  for (const item of data.media) {
    if (item.deleted_at) continue;
    if (!item.is_checkout || !item.uploaded_by) continue;
    if (toDate(item.created_at).getTime() < todayStart.getTime()) continue;
    videoUploadedTodayByProfile.add(item.uploaded_by);
  }

  for (const assignment of data.assignments) {
    if (!activeProjectIds.has(assignment.project_id)) continue;
    const ids = assignmentsByProfile.get(assignment.profile_id) ?? [];
    ids.push(assignment.project_id);
    assignmentsByProfile.set(assignment.profile_id, ids);
  }

  for (const task of data.tasks) {
    if (!task.assigned_to || !isOpenTask(task) || !isTaskInActiveOperations(task, activeProjectIds)) {
      continue;
    }

    openTasksByProfile.set(
      task.assigned_to,
      (openTasksByProfile.get(task.assigned_to) ?? 0) + 1,
    );
  }

  const weekEnd = addDays(weekStart, 7);
  for (const session of sessions) {
    if (session.isOpen) {
      openSessionsByProfile.set(session.profileId, session);
    }

    // Same overlap rule as buildProjectSummaries — a cross-week shift
    // contributes only its current-week tail to weekMinutes.
    const overlap = sessionMinutesInWindow({
      clockInTime: session.clockInTime,
      clockOutTime: session.clockOutTime,
      windowStart: weekStart,
      windowEnd: weekEnd,
    });
    if (overlap > 0) {
      weekMinutesByProfile.set(
        session.profileId,
        (weekMinutesByProfile.get(session.profileId) ?? 0) + overlap,
      );
    }
  }

  return data.profiles
    .map((profile) => {
      const assignedProjectIds = assignmentsByProfile.get(profile.id) ?? [];
      const currentSession = openSessionsByProfile.get(profile.id) ?? null;
      // Mirror migration 00022's receipt-branch USING clause: owner and
      // admin always have finance access; everyone else needs an explicit
      // user_capabilities grant.
      const financeAccess =
        profile.role === "owner" ||
        profile.role === "admin" ||
        (financeAccessUserIds?.has(profile.id) ?? false);

      return {
        ...profile,
        assignedProjectIds,
        assignedProjectNames: assignedProjectIds
          .map((projectId) => projectsById.get(projectId)?.name)
          .filter((value): value is string => Boolean(value)),
        currentProjectName: profile.current_project && activeProjectIds.has(profile.current_project)
          ? projectsById.get(profile.current_project)?.name ?? null
          : null,
        openTaskCount: openTasksByProfile.get(profile.id) ?? 0,
        weekMinutes: weekMinutesByProfile.get(profile.id) ?? 0,
        isOnSite: Boolean(currentSession),
        currentSessionMinutes: currentSession?.durationMinutes ?? null,
        videoUploadedToday: videoUploadedTodayByProfile.has(profile.id),
        financeAccess,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildTimelineItems(data: ManagerWorkspaceData): ManagerTimelineItem[] {
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));

  return [...data.timeEvents]
    .sort((left, right) => {
      return toDate(right.event_time).getTime() - toDate(left.event_time).getTime();
    })
    .map((event) => {
      const profile = profilesById.get(event.profile_id);
      const project = projectsById.get(event.project_id);

      return {
        ...event,
        profileName: profile?.name ?? "Unknown worker",
        profileRole: profile?.role ?? "worker",
        projectName: project?.name ?? "Unknown project",
      };
    });
}

export function getOverviewStats(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  projectSummaries: ManagerProjectSummary[],
  profileSummaries: ManagerProfileSummary[],
  options: { includeFinancials?: boolean } = {},
) {
  const includeFinancials = options.includeFinancials ?? true;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const unpaidPreview = includeFinancials ? computePayrollPreview(data, sessions) : null;
  const todayMinutes = sessions.reduce((sum, session) => {
    if (isSameOrAfter(toDate(session.clockInTime), todayStart)) {
      return sum + session.durationMinutes;
    }

    return sum;
  }, 0);

  const receiptTotal = includeFinancials
    ? roundCurrency(
        projectSummaries.reduce((sum, project) => sum + project.receiptTotal, 0),
      )
    : 0;
  const activeProjectIds = buildActiveProjectIdSet(data.projects);

  return {
    onSiteCount: profileSummaries.filter((profile) => profile.isOnSite).length,
    activeProjectCount: projectSummaries.filter((project) => project.status === "active").length,
    openTaskCount: data.tasks.filter((task) => (
      isOpenTask(task) && isTaskInActiveOperations(task, activeProjectIds)
    )).length,
    crewCount: data.profiles.length,
    todayHours: roundCurrency(todayMinutes / 60),
    unpaidHours: unpaidPreview?.totalHours ?? 0,
    unpaidAmount: unpaidPreview?.totalAmount ?? 0,
    receiptTotal,
  };
}

export function normalisePeriodEnd(periodEnd?: string): string {
  if (periodEnd) {
    return endOfDay(new Date(`${periodEnd}T12:00:00`)).toISOString();
  }

  return endOfDay(new Date()).toISOString();
}

export function computePayrollPreview(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  periodEndInput?: string,
): PayrollPreview {
  const periodEnd = toDate(normalisePeriodEnd(periodEndInput));
  const latestClosureByProfile = new Map<string, Date>();

  for (const closure of data.payrollClosures) {
    const closureTime = toDate(closure.closed_through);
    const current = latestClosureByProfile.get(closure.profile_id);

    if (!current || closureTime.getTime() > current.getTime()) {
      latestClosureByProfile.set(closure.profile_id, closureTime);
    }
  }

  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const linesByKey = new Map<string, PayrollPreviewLine>();
  let earliestWindowStart = periodEnd.toISOString();

  for (const session of sessions) {
    const sessionStart = toDate(session.clockInTime);
    const sessionEnd = toDate(session.clockOutTime ?? new Date().toISOString());

    if (sessionStart.getTime() > periodEnd.getTime()) {
      continue;
    }

    const effectiveEnd = new Date(Math.min(sessionEnd.getTime(), periodEnd.getTime()));
    const latestClosure = latestClosureByProfile.get(session.profileId);
    const payableStart = new Date(
      Math.max(
        sessionStart.getTime(),
        latestClosure ? latestClosure.getTime() : Number.NEGATIVE_INFINITY,
      ),
    );

    if (effectiveEnd.getTime() <= payableStart.getTime()) {
      continue;
    }

    const minutes = minutesBetween(payableStart, effectiveEnd);
    if (minutes <= 0) {
      continue;
    }

    if (payableStart.toISOString() < earliestWindowStart) {
      earliestWindowStart = payableStart.toISOString();
    }

    const profile = data.profiles.find((entry) => entry.id === session.profileId);
    const project = projectsById.get(session.projectId);
    if (!profile || !project) {
      continue;
    }

    const rate = Number(profile.hourly_rate ?? project.rate ?? 0);
    const hours = roundCurrency(minutes / 60);
    const amount = roundCurrency(hours * rate);
    const key = `${profile.id}:${project.id}:${rate.toFixed(2)}`;
    const existing = linesByKey.get(key);

    if (existing) {
      existing.minutes += minutes;
      existing.hours = roundCurrency(existing.minutes / 60);
      existing.amount = roundCurrency(existing.hours * existing.rate);
      existing.sessionIds.push(session.id);
      existing.eventIds.push(...session.eventIds);
      continue;
    }

    linesByKey.set(key, {
      profileId: profile.id,
      profileName: profile.name,
      profileRole: profile.role,
      projectId: project.id,
      projectName: project.name,
      minutes,
      hours,
      rate,
      amount,
      sessionIds: [session.id],
      eventIds: [...session.eventIds],
    });
  }

  const lines = [...linesByKey.values()].sort((left, right) => {
    if (left.profileName === right.profileName) {
      return left.projectName.localeCompare(right.projectName);
    }

    return left.profileName.localeCompare(right.profileName);
  });
  const workerTotalsById = new Map<string, PayrollWorkerTotal>();

  for (const line of lines) {
    const current = workerTotalsById.get(line.profileId);
    if (current) {
      current.hours = roundCurrency(current.hours + line.hours);
      current.amount = roundCurrency(current.amount + line.amount);
      current.lines.push(line);
      continue;
    }

    workerTotalsById.set(line.profileId, {
      profileId: line.profileId,
      profileName: line.profileName,
      profileRole: line.profileRole,
      hours: line.hours,
      amount: line.amount,
      lines: [line],
    });
  }

  const workerTotals = [...workerTotalsById.values()].sort((left, right) => {
    return left.profileName.localeCompare(right.profileName);
  });
  const totalHours = roundCurrency(lines.reduce((sum, line) => sum + line.hours, 0));
  const totalAmount = roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0));

  return {
    periodStart: earliestWindowStart,
    periodEnd: periodEnd.toISOString(),
    totalHours,
    totalAmount,
    workersCount: workerTotals.length,
    lineCount: lines.length,
    lines,
    workerTotals,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Payroll Draft / review helpers
// ─────────────────────────────────────────────────────────────────────
//
// The pay_periods / pay_period_items model aggregates one row per worker
// per period. The Payroll Draft review surface needs more granular
// visibility — chronological shift rows under each worker, with review
// flags. These helpers derive that shift-level view from the same
// ManagerSession[] array we already build for the manager workspace,
// so we don't change the persistence model and don't add a new query
// path. Selection / approval still operates on per-worker pay_period_items;
// shift rows are presentation only.

export interface PayrollDraftRow {
  /** ManagerSession.id — stable per shift across re-renders. */
  sessionId: string;
  profileId: string;
  profileName: string;
  projectId: string;
  projectName: string;
  /** ISO. Always populated. */
  clockInTime: string;
  /** ISO. Null on shifts that never recorded a checkout. */
  clockOutTime: string | null;
  /** Calendar day key (YYYY-MM-DD) for chronology grouping. */
  dayKey: string;
  durationMinutes: number;
  hasGps: boolean;
  /** True for shifts where the worker never clocked out. */
  missingCheckout: boolean;
  /** True when require_video=true and video_status=pending on close. */
  missingVideo: boolean;
  /** True when this clock_in is the to-side of a project transfer gap. */
  hasTransferGap: boolean;
  /** Severity from shiftDurationSeverity for this shift. */
  shiftSeverity: ShiftSeverity;
  /** Worker free-form note from CheckoutModal, or null. */
  checkoutNote: string | null;
}

/**
 * Project sessions onto a date window into shift-level draft rows. Sessions
 * are kept whenever any portion of their range overlaps the window — the
 * UI labels show the original clockInTime / clockOutTime so the manager
 * can read the actual day. Use this for the "byWorker" and "chronology"
 * payroll review surfaces.
 *
 * `requireVideoByProfileId` lets the helper raise `missingVideo` only on
 * shifts whose worker has require_video=true; lets the call site reuse
 * the same Profile[] it already has.
 *
 * `transferGaps` is optional — pass the same array you'd render in the
 * Overview / TeamMember pages; rows whose clock_in matches a gap's
 * `inTime` get `hasTransferGap=true`. Pass an empty array to skip.
 */
export function buildPayrollDraftRows(args: {
  sessions: ManagerSession[];
  hasGpsBySessionId: Record<string, boolean>;
  requireVideoByProfileId: Record<string, boolean>;
  /** Inclusive ISO date YYYY-MM-DD. */
  startDate: string;
  /** Inclusive ISO date YYYY-MM-DD. */
  endDate: string;
  /** Pre-detected transfer gaps (any window). Optional. */
  transferGaps?: Pick<TransferGap, "profileId" | "inTime">[];
  /** Restrict to one worker. */
  profileId?: string;
}): PayrollDraftRow[] {
  const startMs = new Date(`${args.startDate}T00:00:00`).getTime();
  const endMs = new Date(`${args.endDate}T23:59:59.999`).getTime();
  const transferGapKeys = new Set(
    (args.transferGaps ?? []).map((g) => `${g.profileId}|${g.inTime}`),
  );

  const rows: PayrollDraftRow[] = [];
  for (const session of args.sessions) {
    if (args.profileId && session.profileId !== args.profileId) continue;
    const inMs = new Date(session.clockInTime).getTime();
    const outMs = session.clockOutTime
      ? new Date(session.clockOutTime).getTime()
      : Date.now();
    // Any overlap with the window keeps the shift visible.
    if (outMs < startMs) continue;
    if (inMs > endMs) continue;

    rows.push({
      sessionId: session.id,
      profileId: session.profileId,
      profileName: session.profileName,
      projectId: session.projectId,
      projectName: session.projectName,
      clockInTime: session.clockInTime,
      clockOutTime: session.clockOutTime,
      dayKey: session.clockInTime.slice(0, 10),
      durationMinutes: session.durationMinutes,
      hasGps: Boolean(args.hasGpsBySessionId[session.id]),
      missingCheckout: session.clockOutTime === null,
      missingVideo:
        Boolean(args.requireVideoByProfileId[session.profileId]) &&
        session.checkoutStatus === "pending",
      hasTransferGap: transferGapKeys.has(
        `${session.profileId}|${session.clockInTime}`,
      ),
      shiftSeverity: shiftDurationSeverity(session.durationMinutes),
      checkoutNote: session.checkoutNote,
    });
  }

  rows.sort(
    (a, b) =>
      new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime(),
  );
  return rows;
}

export interface PayrollWorkerGroup {
  profileId: string;
  profileName: string;
  rows: PayrollDraftRow[];
  totalMinutes: number;
  noGpsMinutes: number;
  longShiftCount: number;
  extremeShiftCount: number;
  missingCheckoutCount: number;
  missingVideoCount: number;
  transferGapCount: number;
}

/**
 * Group draft rows by worker and aggregate review counts. Result is
 * sorted alphabetically by worker name to match the existing payroll
 * table convention.
 *
 * `chronological` controls intra-worker order:
 *   - "newest"  → newest clock_in first  (default — payroll review)
 *   - "oldest"  → oldest clock_in first
 */
export function groupPayrollRowsByWorker(
  rows: PayrollDraftRow[],
  options: { chronological?: "newest" | "oldest" } = {},
): PayrollWorkerGroup[] {
  const direction = options.chronological ?? "newest";
  const map = new Map<string, PayrollWorkerGroup>();
  for (const row of rows) {
    const group =
      map.get(row.profileId) ??
      ({
        profileId: row.profileId,
        profileName: row.profileName,
        rows: [],
        totalMinutes: 0,
        noGpsMinutes: 0,
        longShiftCount: 0,
        extremeShiftCount: 0,
        missingCheckoutCount: 0,
        missingVideoCount: 0,
        transferGapCount: 0,
      } as PayrollWorkerGroup);
    group.rows.push(row);
    group.totalMinutes += row.durationMinutes;
    if (!row.hasGps) group.noGpsMinutes += row.durationMinutes;
    if (row.durationMinutes >= EXTREME_SHIFT_MINUTES) {
      group.extremeShiftCount += 1;
    } else if (row.durationMinutes >= WARN_SHIFT_MINUTES) {
      group.longShiftCount += 1;
    }
    if (row.missingCheckout) group.missingCheckoutCount += 1;
    if (row.missingVideo) group.missingVideoCount += 1;
    if (row.hasTransferGap) group.transferGapCount += 1;
    map.set(row.profileId, group);
  }

  for (const group of map.values()) {
    group.rows.sort((a, b) => {
      const ta = new Date(a.clockInTime).getTime();
      const tb = new Date(b.clockInTime).getTime();
      return direction === "newest" ? tb - ta : ta - tb;
    });
  }

  return [...map.values()].sort((a, b) =>
    a.profileName.localeCompare(b.profileName),
  );
}

export interface PayrollDayGroup {
  dayKey: string;
  rows: PayrollDraftRow[];
  totalMinutes: number;
}

/**
 * Group draft rows by calendar day for the chronology review surface.
 * Rows inside a day are sorted by clockInTime ascending so the manager
 * reads them in the order they happened. Days are sorted newest first.
 */
export function groupPayrollRowsByDay(rows: PayrollDraftRow[]): PayrollDayGroup[] {
  const map = new Map<string, PayrollDayGroup>();
  for (const row of rows) {
    const group =
      map.get(row.dayKey) ??
      ({ dayKey: row.dayKey, rows: [], totalMinutes: 0 } as PayrollDayGroup);
    group.rows.push(row);
    group.totalMinutes += row.durationMinutes;
    map.set(row.dayKey, group);
  }

  for (const group of map.values()) {
    group.rows.sort(
      (a, b) =>
        new Date(a.clockInTime).getTime() - new Date(b.clockInTime).getTime(),
    );
  }

  return [...map.values()].sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}

/**
 * Sum visible draft rows. "Visible" = whatever the caller has already
 * filtered (worker selector, chronology range, etc). Returns hours
 * rounded to two decimals so it can be displayed directly.
 */
export function sumDraftRowMinutes(rows: PayrollDraftRow[]): {
  totalMinutes: number;
  totalHours: number;
} {
  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  return {
    totalMinutes,
    totalHours: roundCurrency(totalMinutes / 60),
  };
}
