import Link from "next/link";
import { FullscreenMapWrapper } from "@/components/maps/FullscreenMapWrapper";
import { ForceCheckoutButton } from "@/components/manager/ForceCheckoutButton";
import { EventFeed, type FeedEvent } from "@/components/manager/EventFeed";
import { OverviewLiveIndicator } from "@/components/manager/OverviewLiveIndicator";
import { ShiftReviewAckButton } from "@/components/manager/ShiftReviewAckButton";
import {
  buildActiveProjectIdSet,
  getActiveOperationalMedia,
  getActiveOperationalProjects,
  getActiveOperationalTasks,
} from "@/lib/archive-utils";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  detectTransferGaps,
  getOverviewStats,
  isOpenTask,
  TRANSFER_GAP_COLOR,
} from "@/lib/manager-utils";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { formatDurationCompact, formatEventTime, parseGeoPoint } from "@/lib/worker-utils";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import {
  GPS_STATUS_COLOR,
  deriveWorkerGpsStatus,
  type WorkerGpsStatus,
} from "@/lib/gps-status";
import {
  GPS_FRESHNESS_COLOR,
  deriveGpsFreshness,
  formatGpsAge,
  type GpsFreshness,
  type GpsFreshnessStatus,
} from "@/lib/gps-freshness";
import {
  SHIFT_REVIEW_COLOR,
  buildShiftReviewAckEventIds,
  deriveShiftReview,
  type ShiftReview,
  type ShiftReviewStatus,
} from "@/lib/shift-review";
import { createClient } from "@/lib/supabase/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import {
  buildCommandCenterQueue,
  type CommandCenterActionItem,
} from "@/lib/command-center";
import { getDisplayOrgName } from "@/lib/brand";

// 0 = force-dynamic. F5 must always fetch the current state of time_events,
// projects, tasks, media; OverviewLiveIndicator still pushes router.refresh()
// for passive updates between manual reloads.
export const revalidate = 15;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const priorityRank = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

const reviewPriorityRank: Record<ShiftReviewStatus, number> = {
  needs_review: 0,
  video_missing: 1,
  gps_lost: 2,
  no_gps: 3,
  gps_stale: 4,
  long_shift: 5,
  normal: 6,
};

function hoursColor(minutes: number): string {
  const h = minutes / 60;
  if (h > 12) return "#ef4444";
  if (h > 9) return "#f59e0b";
  return "var(--green)";
}

export default async function OverviewPage() {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getManagerWorkspaceData();
  const orgDisplayName = getDisplayOrgName(data.org.name);
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const sessions = buildManagerSessions(data);
  const activeProjectIds = buildActiveProjectIdSet(data.projects);
  const activeSessions = sessions.filter((session) => activeProjectIds.has(session.projectId));
  const activeTasks = getActiveOperationalTasks(data.tasks, data.projects);
  const activeMedia = getActiveOperationalMedia(data.media, data.projects);
  const activeProjects = getActiveOperationalProjects(data.projects);
  const projectSummaries = getActiveOperationalProjects(buildProjectSummaries(data, activeSessions, {
    includeFinancials: managerHasFinanceAccess,
  }));
  const profileSummaries = buildProfileSummaries(data, activeSessions);
  const stats = getOverviewStats(data, activeSessions, projectSummaries, profileSummaries, {
    includeFinancials: managerHasFinanceAccess,
  });
  const liveProfiles = profileSummaries.filter((profile) => profile.isOnSite).slice(0, 6);
  const urgentTasks = [...activeTasks]
    .filter(isOpenTask)
    .sort((left, right) => {
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) {
        return priorityGap;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    })
    .slice(0, 8);
  const busiestProjects = [...projectSummaries]
    .sort((left, right) => {
      if (right.onSiteWorkerCount !== left.onSiteWorkerCount) {
        return right.onSiteWorkerCount - left.onSiteWorkerCount;
      }

      return right.weekMinutes - left.weekMinutes;
    })
    .slice(0, 6);

  // ── Currently on site: open sessions with project + GPS info ──
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const clockInEventsById = new Map(
    data.timeEvents
      .filter((e) => e.event_type === "clock_in")
      .map((e) => [e.id, e]),
  );
  const clockOutEventsById = new Map(
    data.timeEvents
      .filter((e) => e.event_type === "clock_out" || e.event_type === "auto_out")
      .map((e) => [e.id, e]),
  );
  const acknowledgedShiftEventIds = buildShiftReviewAckEventIds(data.timeEvents);
  const latestClosedThroughByProfileId = new Map<string, number>();
  for (const closure of data.payrollClosures) {
    const closedThroughMs = new Date(closure.closed_through).getTime();
    if (!Number.isFinite(closedThroughMs)) continue;
    const current = latestClosedThroughByProfileId.get(closure.profile_id);
    if (current === undefined || closedThroughMs > current) {
      latestClosedThroughByProfileId.set(closure.profile_id, closedThroughMs);
    }
  }
  const onSiteSessions = activeSessions
    .filter((s) => s.isOpen)
    .map((session) => {
      const project = projectsById.get(session.projectId);
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      const todayMinutes = session.durationMinutes;
      const gpsStatus = deriveWorkerGpsStatus({
        clockInGpsPoint: clockInEvent?.gps_point,
        projectSitePoint: project?.site_point,
        projectRadiusM:
          (project as { gps_radius_m?: number | null } | undefined)?.gps_radius_m ??
          project?.radius_m,
      });
      return {
        ...session,
        projectAddress: project?.address ?? null,
        gpsStatus,
        todayMinutes,
      };
    });

  const gpsStatusLabel: Record<WorkerGpsStatus, string> = {
    on_site: t("gpsStatus.onSite"),
    no_gps: t("gpsStatus.noGps"),
    off_site: t("gpsStatus.offSite"),
    no_fence: t("gpsStatus.noFence"),
  };

  // GPS freshness: latest worker_live_locations.recorded_at per active worker.
  // The supabase server client is only created when there's at least one
  // open session — avoids an empty IN() round-trip on quiet orgs. The
  // try/catch keeps a missing-table or RLS hiccup from breaking the page.
  const freshnessByProfileId = new Map<string, GpsFreshness>();
  if (onSiteSessions.length > 0) {
    try {
      const profileIds = onSiteSessions.map((s) => s.profileId);
      const { data: liveRows, error: liveErr } = await supabase
        .from("worker_live_locations")
        .select("worker_id, recorded_at")
        .in("worker_id", profileIds)
        .order("recorded_at", { ascending: false })
        .limit(profileIds.length * 5);
      if (!liveErr && liveRows) {
        const seen = new Set<string>();
        const lastByWorker = new Map<string, string>();
        for (const row of liveRows as Array<{ worker_id: string; recorded_at: string }>) {
          if (seen.has(row.worker_id)) continue;
          seen.add(row.worker_id);
          lastByWorker.set(row.worker_id, row.recorded_at);
        }
        for (const session of onSiteSessions) {
          freshnessByProfileId.set(
            session.profileId,
            deriveGpsFreshness({
              lastUpdateAt: lastByWorker.get(session.profileId) ?? null,
              shiftStartAt: session.clockInTime,
            }),
          );
        }
      }
    } catch {
      // Table may be unreachable — leave freshnessByProfileId empty so
      // the UI shows "no_signal" gracefully rather than crashing.
    }
  }

  const gpsFreshnessLabel: Record<GpsFreshnessStatus, string> = {
    fresh: t("gpsFresh.fresh"),
    delayed: t("gpsFresh.delayed"),
    stale: t("gpsFresh.stale"),
    lost: t("gpsFresh.lost"),
    needs_review: t("gpsFresh.needsReview"),
    no_signal: t("gpsFresh.noSignal"),
  };

  // Shift review — derive a single "is this active shift suspicious?" verdict
  // for each open session by combining duration, the live GPS freshness above,
  // and whether the original clock_in event recorded a gps_point. Read-only:
  // does not change paid hours, write to time_events, or auto-close shifts.
  const profilesByIdForReview = new Map(data.profiles.map((p) => [p.id, p]));
  const shiftReviewByProfileId = new Map<string, ShiftReview>();
  for (const session of onSiteSessions) {
    const clockInEvent = clockInEventsById.get(session.clockInEventId);
    const profile = profilesByIdForReview.get(session.profileId);
    shiftReviewByProfileId.set(
      session.profileId,
      deriveShiftReview({
        isOpen: true,
        durationMinutes: session.todayMinutes,
        hadGpsAtClockIn: clockInEvent?.gps_point != null,
        gpsFreshness: freshnessByProfileId.get(session.profileId) ?? null,
        requireVideo: profile?.require_video ?? false,
        videoStatus: "not_required",
      }),
    );
  }
  const shiftReviewLabel: Record<ShiftReviewStatus, string> = {
    normal: t("shiftReview.normal"),
    long_shift: t("shiftReview.longShift"),
    gps_stale: t("shiftReview.gpsStale"),
    gps_lost: t("shiftReview.gpsLost"),
    no_gps: t("shiftReview.noGps"),
    needs_review: t("shiftReview.needsReview"),
    video_missing: t("shiftReview.videoMissing"),
  };
  const needsReviewCount = [...shiftReviewByProfileId.values()].filter(
    (r) => r.status === "needs_review",
  ).length;

  const closedShiftAlerts = activeSessions
    .filter((session) => !session.isOpen)
    .filter((session) => {
      if (!session.clockOutTime) return true;
      const closedThroughMs = latestClosedThroughByProfileId.get(session.profileId);
      if (closedThroughMs === undefined) return true;
      const outMs = new Date(session.clockOutTime).getTime();
      return !Number.isFinite(outMs) || outMs > closedThroughMs;
    })
    .map((session) => {
      const profile = profilesByIdForReview.get(session.profileId);
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      const review = deriveShiftReview({
        isOpen: false,
        durationMinutes: session.durationMinutes,
        hadGpsAtClockIn: clockInEvent?.gps_point != null,
        gpsFreshness: null,
        requireVideo: profile?.require_video ?? false,
        videoStatus: session.checkoutStatus,
      });
      return { ...session, review };
    })
    .filter((session) => session.review.status !== "normal")
    .filter((session) => {
      return session.clockOutEventId
        ? !acknowledgedShiftEventIds.has(session.clockOutEventId)
        : true;
    })
    .sort((left, right) => {
      const statusGap =
        reviewPriorityRank[left.review.status] - reviewPriorityRank[right.review.status];
      if (statusGap !== 0) return statusGap;
      return right.durationMinutes - left.durationMinutes;
    })
    .slice(0, 8);

  const activeWorkerMarkers = onSiteSessions
    .map((session) => {
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      const point = parseGeoPoint(clockInEvent?.gps_point);
      if (!point) return null;
      return {
        id: session.profileId,
        name: session.profileName,
        role: session.profileRole,
        projectName: session.projectName,
        lat: point.lat,
        lng: point.lng,
      };
    })
    .filter((w): w is NonNullable<typeof w> => w !== null);

  // ── Project-transfer gap detection ──
  // Today-only scope so the Overview's travel-gaps band shows what's
  // actionable right now. detectTransferGaps applies the spec
  // thresholds (>30 min warning, >90 min critical) and ignores
  // same-project re-clocks (lunch breaks, etc).
  const todayStartIso = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  })();
  const travelGaps = detectTransferGaps({
    timeEvents: data.timeEvents.filter((event) => activeProjectIds.has(event.project_id)),
    projects: activeProjects,
    profiles: data.profiles,
    sinceIso: todayStartIso,
  });
  const workersWithGaps = new Set(travelGaps.map((g) => g.profileId));
  const commandCandidates: CommandCenterActionItem[] = [
    ...onSiteSessions
      .map((session) => {
        const review = shiftReviewByProfileId.get(session.profileId);
        if (!review || review.status === "normal") return null;
        const reasonLabels = review.reasons.map((reason) => shiftReviewLabel[reason]).join(", ");
        const isCritical =
          review.status === "needs_review" ||
          review.status === "video_missing" ||
          review.status === "gps_lost";
        return {
          id: `open-shift-${session.id}`,
          label: t("overview.actionShift"),
          title: session.profileName,
          detail: `${session.projectName} · ${formatDurationCompact(session.todayMinutes)} · ${reasonLabels || shiftReviewLabel[review.status]}`,
          href: `/team/${session.profileId}`,
          severity: isCritical ? 0 as const : 1 as const,
          color: isCritical ? "var(--red)" : "#f59e0b",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...closedShiftAlerts.map((session) => {
      const reasonLabels = session.review.reasons
        .map((reason) => shiftReviewLabel[reason])
        .join(", ");
      return {
        id: `closed-shift-${session.id}`,
        label: t("overview.actionShift"),
        title: session.profileName,
        detail: `${session.projectName} · ${formatDurationCompact(session.durationMinutes)} · ${reasonLabels}`,
        href: `/team/${session.profileId}`,
        severity: 0 as const,
        color: "var(--red)",
      };
    }),
    ...travelGaps.map((gap) => ({
      id: `gap-${gap.id}`,
      label: t("overview.actionTravelGap"),
      title: gap.workerName,
      detail: `${gap.fromProject} → ${gap.toProject} · ${formatDurationCompact(gap.gapMinutes)}`,
      href: `/team/${gap.profileId}`,
      severity: gap.severity === "critical" ? 0 as const : 1 as const,
      color: TRANSFER_GAP_COLOR[gap.severity],
    })),
    ...urgentTasks
      .filter((task) => task.priority === "urgent" || task.priority === "high")
      .map((task) => {
        const project = task.project_id ? projectsById.get(task.project_id) : null;
        const effectiveStatus = getEffectiveTaskStatus(task);
        return {
          id: `task-${task.id}`,
          label: t("overview.actionTask"),
          title: task.title,
          detail: `${project?.name ?? t("common.generalTask")} · ${effectiveStatus}`,
          href: task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks",
          severity: task.priority === "urgent" ? 0 as const : 1 as const,
          color: task.priority === "urgent" ? "var(--red)" : "#f59e0b",
        };
      }),
  ];
  const commandQueue = buildCommandCenterQueue(commandCandidates, { limit: 6 });
  const criticalActionCount = commandQueue.criticalCount;
  const highPriorityTaskCount = urgentTasks.filter((task) => (
    task.priority === "urgent" || task.priority === "high"
  )).length;
  const projectsWithCrewCount = projectSummaries.filter((project) => (
    project.onSiteWorkerCount > 0
  )).length;
  const primaryAction = commandQueue.primaryAction;

  // ── Unified event feed (last 15) ──
  const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
  const feedEvents: FeedEvent[] = [];

  // Time events → clock_in, clock_out, force_checkout, adjust
  for (const e of data.timeEvents) {
    const profile = profilesById.get(e.profile_id);
    const project = projectsById.get(e.project_id);
    const isForce = e.event_type === "auto_out" && (e.metadata as Record<string, unknown>)?.force_checkout === true;
    const kind: FeedEvent["kind"] =
      isForce ? "force_checkout"
        : e.event_type === "clock_in" ? "clock_in"
        : e.event_type === "clock_out" || e.event_type === "auto_out" ? "clock_out"
        : e.event_type === "adjust" ? "adjust"
        : "clock_in"; // fallback for break_start/end
    if (e.event_type === "break_start" || e.event_type === "break_end") continue;
    feedEvents.push({
      id: e.id,
      kind,
      actorName: profile?.name ?? "Unknown",
      actorId: e.profile_id,
      description: "",
      projectName: project?.name ?? null,
      projectId: e.project_id,
      timestamp: e.event_time,
      href: project ? `/projects/${e.project_id}` : null,
    });
  }

  // Tasks → assigned, started, completed
  for (const task of activeTasks) {
    if (!task.deleted_at) {
      const project = task.project_id ? projectsById.get(task.project_id) : null;

      // Assignment event — emitted whenever a task has an assigner + assignee.
      // Without a full audit history we treat task.created_at as the assignment time.
      if (task.assigned_to && task.assigned_by) {
        const assigner = profilesById.get(task.assigned_by);
        const assignee = profilesById.get(task.assigned_to);
        feedEvents.push({
          id: `task-assign-${task.id}`,
          kind: "task_assigned",
          actorName: assigner?.name ?? "Unknown",
          actorId: task.assigned_by,
          description: assignee ? `${task.title} → ${assignee.name}` : task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.created_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      }

      const effectiveStatus = getEffectiveTaskStatus(task);
      if (effectiveStatus === "done" && task.completed_at) {
        const actor = task.completed_by ? profilesById.get(task.completed_by) : null;
        feedEvents.push({
          id: `task-done-${task.id}`,
          kind: "task_completed",
          actorName: actor?.name ?? "Unknown",
          actorId: task.completed_by ?? "",
          description: task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.completed_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      } else if (effectiveStatus === "in_progress") {
        feedEvents.push({
          id: `task-start-${task.id}`,
          kind: "task_started",
          actorName: task.assigned_to ? (profilesById.get(task.assigned_to)?.name ?? "Unknown") : "Unknown",
          actorId: task.assigned_to ?? "",
          description: task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.updated_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      }
    }
  }

  // Media → uploaded
  for (const m of activeMedia) {
    const actor = m.uploaded_by ? profilesById.get(m.uploaded_by) : null;
    const project = m.project_id ? projectsById.get(m.project_id) : null;
    feedEvents.push({
      id: `media-${m.id}`,
      kind: "media_uploaded",
      actorName: actor?.name ?? "Unknown",
      actorId: m.uploaded_by ?? "",
      description: m.filename ?? m.media_type,
      projectName: project?.name ?? null,
      projectId: m.project_id,
      timestamp: m.created_at,
      href: m.project_id ? `/projects/${m.project_id}` : null,
    });
  }

  // Store visits → only kept (closed) ones with real duration.
  for (const v of data.storeVisits) {
    if (!v.exited_at || !v.duration_seconds) continue;
    const actor = profilesById.get(v.worker_id);
    const minutes = Math.max(1, Math.round(v.duration_seconds / 60));
    const chain = v.store_chain || "store";
    const store = v.store_name || chain;
    feedEvents.push({
      id: `store-visit-${v.id}`,
      kind: "store_visit",
      actorName: actor?.name ?? v.worker_name ?? "Unknown",
      actorId: v.worker_id,
      description: `${chain} (${store}) — ${minutes} min`,
      projectName: v.source_project_name ?? null,
      projectId: v.source_project_id,
      timestamp: v.exited_at,
      href: v.source_project_id ? `/projects/${v.source_project_id}` : null,
    });
  }

  feedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentFeed = feedEvents.slice(0, 15);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("overview.title")}
          </p>
          <OverviewLiveIndicator />
        </div>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {orgDisplayName}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("overview.description")}
        </p>
      </section>

      <section className={`grid gap-3 sm:grid-cols-2 ${managerHasFinanceAccess ? "xl:grid-cols-5" : "xl:grid-cols-3"}`}>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.onSite")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.onSiteCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.crewCount} {t("overview.totalCrewProfiles")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.today")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.todayHours.toFixed(2)}h</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.activeProjectCount} {t("overview.activeProjects")}</div>
        </div>
        {managerHasFinanceAccess ? (
          <>
            <Link
              href="/payroll"
              className="surface-card block p-4 transition hover:border-[var(--brand-yellow)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-yellow)]"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.unpaid")}</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {currency.format(stats.unpaidAmount)}
              </div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.unpaidHours.toFixed(2)}{t("payroll.hPendingPayroll")}</div>
            </Link>
            <Link
              href="/projects"
              className="surface-card block p-4 transition hover:border-[var(--brand-yellow)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-yellow)]"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("overview.materials")}</div>
              <div
                className="mt-2 font-mono text-[28px] font-bold"
                style={{ color: "var(--brand-yellow)" }}
              >
                {currency.format(stats.receiptTotal)}
              </div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("overview.materialsCaption")}</div>
            </Link>
          </>
        ) : null}
        <Link
          href="/tasks"
          className="surface-card block p-4 transition hover:border-[var(--brand-yellow)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-yellow)]"
        >
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.tasks")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.openTaskCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("overview.openFieldItems")}</div>
        </Link>
      </section>

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("overview.commandCenterEyebrow")}
            </p>
            <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
              {t("overview.commandCenterTitle")}
            </h2>
            <p className="mt-1 max-w-[70ch] text-sm leading-6 text-[var(--text-secondary)]">
              {t("overview.commandCenterDesc")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/command-center"
              className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
            >
              {t("overview.openCommandCenter")}
            </Link>
            <Link
              href="/timeline"
              className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              {t("overview.fullTimeline")}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--border-default)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("overview.commandNow")}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="font-mono text-3xl font-bold text-[var(--text-primary)]">
                {stats.onSiteCount}
              </span>
              <span className="pb-1 text-sm text-[var(--text-secondary)]">
                {t("common.onSite").toLowerCase()}
              </span>
            </div>
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              {projectsWithCrewCount} {t("overview.commandProjectsWithCrew")} · {stats.todayHours.toFixed(1)}h {t("common.today").toLowerCase()}
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: criticalActionCount > 0 ? "rgba(212, 81, 94, 0.45)" : "var(--border-default)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("overview.commandRisk")}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span
                className="font-mono text-3xl font-bold"
                style={{ color: criticalActionCount > 0 ? "var(--red)" : "var(--green)" }}
              >
                {criticalActionCount}
              </span>
              <span className="pb-1 text-sm text-[var(--text-secondary)]">
                {t("overview.commandCritical")}
              </span>
            </div>
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              {travelGaps.length} {t("overview.actionTravelGap").toLowerCase()} · {highPriorityTaskCount} {t("overview.commandPriorityTasks")}
            </div>
          </div>

          <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--border-default)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("overview.commandNext")}
            </div>
            {primaryAction ? (
              <div className="mt-2">
                <div
                  className="text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: primaryAction.color }}
                >
                  {primaryAction.label}
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                  {primaryAction.title}
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">
                  {primaryAction.detail}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                {t("overview.noActionItems")}
              </div>
            )}
          </div>
        </div>
      </section>

      {closedShiftAlerts.length > 0 ? (
        <section
          className="rounded-[var(--radius-lg)] border p-4"
          style={{
            background: "rgba(212, 81, 94, 0.06)",
            borderColor: "rgba(212, 81, 94, 0.24)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--red)" }}>
                {t("shiftReview.closedShiftAlerts")}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {t("shiftReview.closedShiftAlertsDesc")}
              </p>
            </div>
            <Link href="/payroll" className="text-sm font-semibold text-[var(--brand-yellow)]">
              {t("payroll.title")}
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {closedShiftAlerts.map((session) => {
              const reasonLabels = session.review.reasons
                .map((reason) => shiftReviewLabel[reason])
                .join(", ");
              const clockOutEvent = session.clockOutEventId
                ? clockOutEventsById.get(session.clockOutEventId)
                : null;
              return (
                <article
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2.5"
                  style={{
                    borderColor: "rgba(212, 81, 94, 0.22)",
                    background: "rgba(15, 17, 23, 0.62)",
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/team/${session.profileId}`}
                        className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--brand-yellow)]"
                      >
                        {session.profileName}
                      </Link>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {session.projectName}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {formatEventTime(session.clockInTime)}
                      {clockOutEvent ? ` - ${formatEventTime(clockOutEvent.event_time)}` : ""}
                      {" · "}
                      {reasonLabels}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                      style={{ color: SHIFT_REVIEW_COLOR[session.review.status] }}
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: SHIFT_REVIEW_COLOR[session.review.status] }}
                      />
                      {shiftReviewLabel[session.review.status]}
                    </span>
                    <span className="font-mono text-sm font-bold text-[var(--text-primary)]">
                      {formatDurationCompact(session.durationMinutes)}
                    </span>
                    {clockOutEvent ? (
                      <ShiftReviewAckButton
                        eventId={clockOutEvent.id}
                        managerId={data.manager.id}
                        status={session.review.status}
                      />
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.activeSiteMap")}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t("overview.mapDesc")}
            </p>
          </div>
          <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openProjects")}
          </Link>
        </div>
        <FullscreenMapWrapper projects={projectSummaries} activeWorkers={activeWorkerMarkers} />
      </section>

      {/* ── Currently on site table ── */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.currentlyOnSite")}</h2>
          <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openTeam")}
          </Link>
        </div>
        {needsReviewCount > 0 ? (
          <div
            className="mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold"
            style={{
              borderColor: "rgba(212, 81, 94, 0.3)",
              background: "rgba(212, 81, 94, 0.06)",
              color: "var(--red)",
            }}
          >
            {t("shiftReview.needsReviewCount").replace("{count}", String(needsReviewCount))}
          </div>
        ) : null}
        {onSiteSessions.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("overview.nobodyClockedIn")}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
                  style={{ borderBottom: "1px solid var(--border-default)" }}
                >
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colName")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colProject")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colSince")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colHours")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colGps")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("gpsFresh.columnHeader")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("shiftReview.columnHeader")}</th>
                  <th className="pb-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {onSiteSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-[var(--border-subtle)]"
                  >
                    <td className="py-3 pr-4">
                      <Link href={`/team/${session.profileId}`} className="font-semibold text-[var(--text-primary)]">
                        {session.profileName}
                      </Link>
                      {workersWithGaps.has(session.profileId) ? (
                        <span
                          className="ml-1.5 inline-block h-2 w-2 rounded-full"
                          style={{ background: "#f59e0b" }}
                          title={t("overview.travelGaps")}
                        />
                      ) : null}
                      <span
                        className="ml-2 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                        style={{
                          background: "rgba(191, 162, 52, 0.12)",
                          color: "var(--brand-yellow)",
                        }}
                      >
                        {session.profileRole}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Link href={`/projects/${session.projectId}`} className="text-[var(--text-primary)]">
                        {session.projectName}
                      </Link>
                      {session.projectAddress ? (
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{session.projectAddress}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      {formatEventTime(session.clockInTime)}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap font-semibold" style={{ color: hoursColor(session.todayMinutes) }}>
                      {formatDurationCompact(session.todayMinutes)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                        style={{ color: GPS_STATUS_COLOR[session.gpsStatus] }}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: GPS_STATUS_COLOR[session.gpsStatus] }}
                        />
                        {gpsStatusLabel[session.gpsStatus]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {(() => {
                        const fresh =
                          freshnessByProfileId.get(session.profileId) ??
                          ({
                            status: "no_signal",
                            ageMs: null,
                            lastUpdateAt: null,
                          } as GpsFreshness);
                        const tooltip = fresh.lastUpdateAt
                          ? t("gpsFresh.tooltipUpdated").replace(
                              "{age}",
                              formatGpsAge(fresh.ageMs),
                            )
                          : t("gpsFresh.tooltipNever");
                        return (
                          <span
                            title={tooltip}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                            style={{ color: GPS_FRESHNESS_COLOR[fresh.status] }}
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: GPS_FRESHNESS_COLOR[fresh.status] }}
                            />
                            {gpsFreshnessLabel[fresh.status]}
                            {fresh.ageMs !== null ? (
                              <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
                                {formatGpsAge(fresh.ageMs)}
                              </span>
                            ) : null}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 pr-4">
                      {(() => {
                        const review =
                          shiftReviewByProfileId.get(session.profileId) ??
                          ({
                            status: "normal",
                            reasons: [],
                            durationMinutes: session.todayMinutes,
                            isOpen: true,
                          } as ShiftReview);
                        if (review.status === "normal") {
                          return (
                            <span
                              className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                              style={{ color: "var(--text-muted)" }}
                            >
                              {t("shiftReview.normal")}
                            </span>
                          );
                        }
                        const reasonLabels = review.reasons
                          .map((r) => shiftReviewLabel[r])
                          .join(", ");
                        const tooltip = t("shiftReview.tooltipReasons").replace(
                          "{list}",
                          reasonLabels,
                        );
                        return (
                          <span
                            title={tooltip}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                            style={{ color: SHIFT_REVIEW_COLOR[review.status] }}
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: SHIFT_REVIEW_COLOR[review.status] }}
                            />
                            {shiftReviewLabel[review.status]}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3">
                      <ForceCheckoutButton
                        orgId={data.org.id}
                        managerId={data.manager.id}
                        profileId={session.profileId}
                        projectId={session.projectId}
                        workerName={session.profileName}
                        projectName={session.projectName}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Travel gaps ──
          Severity per detectTransferGaps: warning > 30m, critical > 90m.
          The card's outer color stays amber so the section title is
          consistent regardless of the worst-case row inside, but each
          row is tinted red when it crosses the critical threshold. */}
      <section
        className="rounded-[var(--radius-lg)] border p-4"
        style={{
          background: "rgba(245, 158, 11, 0.06)",
          borderColor: "rgba(245, 158, 11, 0.25)",
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h2 className="text-lg font-bold" style={{ color: "#f59e0b" }}>{t("overview.travelGaps")}</h2>
        </div>
        <div className="mt-4 space-y-2">
          {travelGaps.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)]">
              {t("overview.noGaps")}
            </div>
          ) : (
            travelGaps.map((gap) => {
              const isCritical = gap.severity === "critical";
              const rowBg = isCritical
                ? "rgba(212, 81, 94, 0.10)"
                : "rgba(245, 158, 11, 0.08)";
              const pillBg = isCritical
                ? "rgba(212, 81, 94, 0.16)"
                : "rgba(245, 158, 11, 0.18)";
              const pillColor = TRANSFER_GAP_COLOR[gap.severity];
              return (
                <div
                  key={gap.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5"
                  style={{ background: rowBg }}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Link href={`/team/${gap.profileId}`} className="font-semibold text-[var(--text-primary)]">
                      {gap.workerName}
                    </Link>
                    <span className="text-[var(--text-muted)]">&mdash;</span>
                    <span className="text-[var(--text-secondary)]">
                      {t("overview.gapFrom")} <span className="font-medium text-[var(--text-primary)]">{gap.fromProject}</span>
                    </span>
                    <span className="text-[var(--text-secondary)]">→</span>
                    <span className="text-[var(--text-secondary)]">
                      {t("overview.gapTo")} <span className="font-medium text-[var(--text-primary)]">{gap.toProject}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">
                      {formatEventTime(gap.outTime)} - {formatEventTime(gap.inTime)}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.1em]"
                      style={{ background: pillBg, color: pillColor }}
                    >
                      {isCritical
                        ? t("overview.gapCriticalLabel")
                        : t("overview.gapWarningLabel")}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold"
                      style={{ background: pillBg, color: pillColor }}
                    >
                      {formatDurationCompact(gap.gapMinutes)} {t("overview.gapDuration")}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── Unified event feed (last 15) ── */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("feed.title")}</h2>
          <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.fullTimeline")}
          </Link>
        </div>
        <div className="mt-4">
          <EventFeed events={recentFeed} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.liveCrew")}</h2>
            <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
              {t("overview.openTeam")}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {liveProfiles.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("overview.nobodyClockedIn")}
              </div>
            ) : (
              liveProfiles.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/team/${profile.id}`}
                  className="block rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{profile.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        {profile.role}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-[var(--brand-yellow)]">
                      {profile.currentSessionMinutes === null
                        ? t("common.live")
                        : formatDurationCompact(profile.currentSessionMinutes)}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[var(--text-secondary)]">
                    {profile.currentProjectName ?? t("common.projectNotResolved")}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.urgentQueue")}</h2>
            <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
              {t("overview.openTimeline")}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {urgentTasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("overview.noOpenTasks")}
              </div>
            ) : (
              urgentTasks.map((task) => {
                const effectiveStatus = getEffectiveTaskStatus(task);
                return (
                  <div
                    key={task.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {task.project_id ? (
                            <Link href={`/projects/${task.project_id}`} className="text-[var(--brand-yellow)]">
                              {t("common.openProject")}
                            </Link>
                          ) : (
                            t("common.generalTask")
                          )}
                          {" • "}
                          {effectiveStatus}
                        </div>
                      </div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--brand-yellow)]">
                        {task.priority}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.projectLoad")}</h2>
          <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openProjects")}
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {busiestProjects.map((project) => {
            // Project workload severity:
            //   • >=24h shift on this project → critical/red border + chip
            //   • >=16h shift (and not extreme)   → warning/amber chip
            // The "longestShift" detail comes from the same aggregation
            // pass so the card surfaces the worker name + duration of
            // the worst shift without leaving Overview.
            const isCritical = project.extremeShiftCount > 0;
            const isWarning = !isCritical && project.longShiftCount > 0;
            const borderColor = isCritical
              ? "rgba(212, 81, 94, 0.45)"
              : isWarning
                ? "rgba(245, 158, 11, 0.35)"
                : "var(--border-default)";
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-[var(--radius-md)] border p-3"
                style={{ borderColor }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{project.name}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {project.address ?? t("common.noAddress")}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[var(--text-secondary)]">
                    <div>{project.onSiteWorkerCount} {t("common.live").toLowerCase()}</div>
                    <div>{project.assignedWorkerCount} {t("overview.assigned")}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                  <span className="font-mono">{formatDurationCompact(project.weekMinutes)} {t("common.thisWeek").toLowerCase()}</span>
                  <span className="font-mono">{project.openTaskCount} {t("overview.openTasks")}</span>
                </div>
                {(isCritical || isWarning) && project.longestShift ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                      style={
                        isCritical
                          ? { background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }
                          : { background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }
                      }
                    >
                      {isCritical ? t("shiftReview.needsReview") : t("shiftReview.longShift")}
                    </span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {project.longestShift.workerName} · {formatDurationCompact(project.longestShift.durationMinutes)}
                    </span>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
