import { redirect } from "next/navigation";
import { TeamMemberPage } from "@/components/manager/TeamMemberPage";
import { getTeamPageData } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  detectTransferGaps,
} from "@/lib/manager-utils";
import { deriveGpsFreshness } from "@/lib/gps-freshness";
import { deriveShiftReview, type ShiftReview } from "@/lib/shift-review";
import type { Media } from "@/types/database";

// F5 must reflect the worker's latest shifts, tasks, and media.
export const revalidate = 0;

export default async function TeamMemberRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTeamPageData();
  const sessions = buildManagerSessions(data);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const projectSummaries = buildProjectSummaries(data, sessions);
  const profile = profileSummaries.find((item) => item.id === id);

  if (!profile) {
    // Soft redirect instead of 404 so clicking a stale worker link
    // just sends the manager back to the roster rather than hitting
    // Next's default not-found shell.
    redirect("/team");
  }

  const assignments = data.assignments.filter((assignment) => assignment.profile_id === id);
  const tasks = data.tasks.filter((task) => task.assigned_to === id && !task.deleted_at).slice(0, 20);
  const allWorkerSessions = sessions.filter((session) => session.profileId === id);
  const workerSessions = allWorkerSessions.slice(0, 20);

  // Build clock_in event lookup (events come from getTeamPageData — last 14 days).
  const clockInById = new Map<string, (typeof data.timeEvents)[number]>();
  for (const e of data.timeEvents) {
    if (e.event_type === "clock_in") clockInById.set(e.id, e);
  }
  const hasGpsBySessionId: Record<string, boolean> = {};
  for (const s of workerSessions) {
    hasGpsBySessionId[s.id] = clockInById.get(s.clockInEventId)?.gps_point != null;
  }

  // Current Mon-Sun window — same convention as buildProfileSummaries.weekMinutes.
  const nowDate = new Date();
  const dow = nowDate.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStartDate = new Date(nowDate);
  weekStartDate.setDate(nowDate.getDate() + mondayOffset);
  weekStartDate.setHours(0, 0, 0, 0);
  const weekStartIso = weekStartDate.toISOString();

  let weekGpsMinutes = 0;
  let weekNoGpsMinutes = 0;
  const dailyMap = new Map<string, number>();
  for (const s of allWorkerSessions) {
    if (s.clockInTime < weekStartIso) continue;
    const day = s.clockInTime.slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + s.durationMinutes);
    const hasGps = clockInById.get(s.clockInEventId)?.gps_point != null;
    if (hasGps) weekGpsMinutes += s.durationMinutes;
    else weekNoGpsMinutes += s.durationMinutes;
  }
  const dailyTotals = [...dailyMap.entries()]
    .map(([date, minutes]) => ({
      date,
      minutes,
      otLevel:
        minutes > 13 * 60
          ? ("critical" as const)
          : minutes > 11 * 60
            ? ("warning" as const)
            : ("ok" as const),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // Closed store visits in the last 7 days, newest first.
  // Date.now() is fine here — server component, runs once per request.
  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const workerStoreVisits = data.storeVisits
    .filter(
      (visit) =>
        visit.worker_id === id &&
        Boolean(visit.exited_at) &&
        new Date(visit.entered_at).getTime() >= sevenDaysAgo,
    )
    .slice(0, 20);

  // Worker's recent journal entries (newest first), enriched with project name.
  // getTeamPageData skips media on purpose — query just this worker's rows
  // inline so the detail page still renders the journal without a broad
  // org-wide fetch.
  const projectsById = new Map(data.projects.map((p) => [p.id, p.name]));
  const supabase = await createClient();
  const { data: workerMediaRows } = await supabase
    .from("media")
    .select("*")
    .eq("uploaded_by", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<Media[]>();
  const workerMedia = (workerMediaRows ?? []).map((m) => ({
    ...m,
    projectName: m.project_id ? projectsById.get(m.project_id) ?? null : null,
  }));

  // Project-transfer gaps for this worker — read-only manager review
  // signal. Scope to the same 7-day window the rest of the page uses
  // so a worker with no recent activity doesn't show stale alerts.
  const transferGaps = detectTransferGaps({
    timeEvents: data.timeEvents,
    projects: data.projects,
    profiles: data.profiles,
    profileId: id,
    sinceIso: new Date(sevenDaysAgo).toISOString(),
  });

  // Worker adjustments — every event_type='adjust' row for this worker
  // shaped for the deriveWorkerHourBuckets helper. Surfaces the
  // "Period closed, hours paid" reset (Vasya regression) as a paid /
  // closed bucket so the manager can see it instead of staring at a
  // 0m current-week and wondering where the hours went.
  const workerAdjustments = data.timeEvents
    .filter((event) => event.event_type === "adjust" && event.profile_id === id)
    .map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      const minutes = Number(meta.adjustMinutes ?? 0);
      return {
        eventTime: event.event_time,
        minutes: Number.isFinite(minutes) ? minutes : 0,
        reason: typeof meta.reason === "string" ? meta.reason : "",
        kind: typeof meta.kind === "string" ? meta.kind : null,
      };
    });

  // Migration 00018 — current exclusion rows for this worker. Empty when
  // the worker is in 'list' mode or the migration hasn't run yet.
  const { data: exclusionRows } = await supabase
    .from("project_exclusions")
    .select("project_id")
    .eq("profile_id", id);
  const excludedProjectIds = new Set<string>(
    ((exclusionRows ?? []) as Array<{ project_id: string }>).map((row) => row.project_id),
  );

  // Shift review for this worker's currently-open session (if any). Pulls
  // the same worker_live_locations freshness signal Overview uses, scoped
  // to one worker. Read-only — does not write to time_events, change paid
  // hours, or auto-close the shift.
  const openSession = allWorkerSessions.find((session) => session.isOpen) ?? null;
  let currentShiftReview: ShiftReview | null = null;
  if (openSession) {
    let lastUpdateAt: string | null = null;
    try {
      const { data: liveRows } = await supabase
        .from("worker_live_locations")
        .select("recorded_at")
        .eq("worker_id", id)
        .order("recorded_at", { ascending: false })
        .limit(1);
      const row = (liveRows ?? []) as Array<{ recorded_at: string }>;
      lastUpdateAt = row[0]?.recorded_at ?? null;
    } catch {
      // Table missing or RLS hiccup — leave lastUpdateAt null so the
      // freshness derivation falls through to "no_signal" gracefully.
    }
    const freshness = deriveGpsFreshness({
      lastUpdateAt,
      shiftStartAt: openSession.clockInTime,
    });
    const clockInEvent = clockInById.get(openSession.clockInEventId);
    currentShiftReview = deriveShiftReview({
      isOpen: true,
      durationMinutes: openSession.durationMinutes,
      hadGpsAtClockIn: clockInEvent?.gps_point != null,
      gpsFreshness: freshness,
      requireVideo: profile.require_video,
      videoStatus: "not_required",
    });
  }

  return (
    <TeamMemberPage
      orgId={data.manager.org_id}
      managerId={data.manager.id}
      profile={profile}
      projects={projectSummaries}
      assignments={assignments}
      tasks={tasks}
      sessions={workerSessions}
      storeVisits={workerStoreVisits}
      media={workerMedia}
      hasGpsBySessionId={hasGpsBySessionId}
      weekGpsMinutes={weekGpsMinutes}
      weekNoGpsMinutes={weekNoGpsMinutes}
      dailyTotals={dailyTotals}
      excludedProjectIds={[...excludedProjectIds]}
      currentShiftReview={currentShiftReview}
      transferGaps={transferGaps}
      workerAdjustments={workerAdjustments}
    />
  );
}
