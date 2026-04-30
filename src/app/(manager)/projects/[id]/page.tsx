import { notFound } from "next/navigation";
import { ProjectDetailPage } from "@/components/manager/ProjectDetailPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  isManagerRole,
} from "@/lib/manager-utils";
import { deriveWorkerGpsStatus, type WorkerGpsStatus } from "@/lib/gps-status";
import { deriveGpsFreshness, type GpsFreshness } from "@/lib/gps-freshness";
import { deriveShiftReview, type ShiftReview } from "@/lib/shift-review";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const project = projectSummaries.find((item) => item.id === id);

  if (!project) {
    notFound();
  }

  const assignments = data.assignments.filter((assignment) => assignment.project_id === id);
  const assignedIds = new Set(assignments.map((assignment) => assignment.profile_id));
  const assignedProfiles = profileSummaries.filter((profile) => assignedIds.has(profile.id));
  const availableProfiles = profileSummaries.filter((profile) => {
    return !assignedIds.has(profile.id) && profile.is_active && !isManagerRole(profile.role);
  });
  const tasks = data.tasks.filter((task) => task.project_id === id && !task.deleted_at).slice(0, 24);
  const media = data.media.filter((item) => item.project_id === id).slice(0, 18);
  const projectSessions = sessions.filter((session) => session.projectId === id).slice(0, 18);

  const clockInEventById = new Map(
    data.timeEvents
      .filter((e) => e.event_type === "clock_in")
      .map((e) => [e.id, e]),
  );
  const gpsStatusByProfileId: Record<string, WorkerGpsStatus> = {};
  for (const session of sessions) {
    if (!session.isOpen || session.projectId !== id) continue;
    const clockInEvent = clockInEventById.get(session.clockInEventId);
    gpsStatusByProfileId[session.profileId] = deriveWorkerGpsStatus({
      clockInGpsPoint: clockInEvent?.gps_point,
      projectSitePoint: project.site_point,
      projectRadiusM:
        (project as { gps_radius_m?: number | null }).gps_radius_m ??
        project.radius_m,
    });
  }

  // GPS freshness — query latest worker_live_locations.recorded_at for
  // each worker currently clocked in to THIS project. Empty for projects
  // with nobody on site. Wrapped in try/catch so a missing table or RLS
  // hiccup doesn't 500 the page.
  const supabase = await createClient();
  const onSiteProfileIds = sessions
    .filter((s) => s.isOpen && s.projectId === id)
    .map((s) => s.profileId);
  const freshnessByProfileId: Record<string, GpsFreshness> = {};
  if (onSiteProfileIds.length > 0) {
    try {
      const { data: liveRows } = await supabase
        .from("worker_live_locations")
        .select("worker_id, recorded_at")
        .in("worker_id", onSiteProfileIds)
        .order("recorded_at", { ascending: false })
        .limit(onSiteProfileIds.length * 5);
      const seen = new Set<string>();
      const lastByWorker = new Map<string, string>();
      for (const row of (liveRows ?? []) as Array<{ worker_id: string; recorded_at: string }>) {
        if (seen.has(row.worker_id)) continue;
        seen.add(row.worker_id);
        lastByWorker.set(row.worker_id, row.recorded_at);
      }
      for (const session of sessions) {
        if (!session.isOpen || session.projectId !== id) continue;
        freshnessByProfileId[session.profileId] = deriveGpsFreshness({
          lastUpdateAt: lastByWorker.get(session.profileId) ?? null,
          shiftStartAt: session.clockInTime,
        });
      }
    } catch {
      // Leave map empty — UI shows "no_signal" gracefully.
    }
  }

  // Shift review — same read-only verdict pattern used on Overview, scoped
  // to workers currently clocked in to THIS project. No payroll, no
  // time_events writes, no auto-close. Only displays the manager-facing
  // status badge so a forgotten checkout doesn't masquerade as a normal
  // active shift on the project page.
  const profilesByIdForReview = new Map(data.profiles.map((p) => [p.id, p]));
  const shiftReviewByProfileId: Record<string, ShiftReview> = {};
  for (const session of sessions) {
    if (!session.isOpen || session.projectId !== id) continue;
    const clockInEvent = clockInEventById.get(session.clockInEventId);
    const profile = profilesByIdForReview.get(session.profileId);
    shiftReviewByProfileId[session.profileId] = deriveShiftReview({
      isOpen: true,
      durationMinutes: session.durationMinutes,
      hadGpsAtClockIn: clockInEvent?.gps_point != null,
      gpsFreshness: freshnessByProfileId[session.profileId] ?? null,
      requireVideo: profile?.require_video ?? false,
      videoStatus: "not_required",
    });
  }

  // Safety acknowledgements count for THIS project, today (worker local
  // midnight is not knowable server-side; use UTC midnight as the cutoff
  // — same convention used elsewhere when counting "today" rows).
  // The query is wrapped so that a pre-migration deploy (table missing)
  // returns 0 instead of crashing the page.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  let safetyAcksToday = 0;
  try {
    const { count, error } = await supabase
      .from("safety_acknowledgements")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .gte("acknowledged_at", todayStart.toISOString());
    if (!error && typeof count === "number") {
      safetyAcksToday = count;
    }
  } catch {
    // Table may not exist yet (migration 00019 not applied); fall through.
  }

  return (
    <ProjectDetailPage
      orgId={data.manager.org_id}
      managerId={data.manager.id}
      project={project}
      assignedProfiles={assignedProfiles}
      availableProfiles={availableProfiles}
      assignments={assignments}
      tasks={tasks}
      media={media}
      sessions={projectSessions}
      gpsStatusByProfileId={gpsStatusByProfileId}
      gpsFreshnessByProfileId={freshnessByProfileId}
      shiftReviewByProfileId={shiftReviewByProfileId}
      safetyAcksToday={safetyAcksToday}
    />
  );
}
