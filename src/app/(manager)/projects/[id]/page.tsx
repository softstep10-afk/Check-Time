import { notFound, redirect } from "next/navigation";
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
import {
  collectTaskReferencedMediaIds,
  mergeMediaWithTaskReferences,
} from "@/lib/task-media-hydration";
import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { hasFinanceAccess } from "@/lib/finance-access";
import { canDeleteMediaEverywhereServer } from "@/lib/server/media-delete-permissions";
import { readMaterialDriverProfileIdsFromEnv } from "@/lib/server/material-driver-config";
import type { Media } from "@/types/database";

export default async function ProjectDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getManagerWorkspaceData();
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials: managerHasFinanceAccess,
  });
  const profileSummaries = buildProfileSummaries(data, sessions);
  const project = projectSummaries.find((item) => item.id === id);

  if (!project) {
    notFound();
  }
  if (project.status === "archived") {
    redirect(`/archive/projects/${project.id}`);
  }

  const assignments = data.assignments.filter((assignment) => assignment.project_id === id);
  const assignedIds = new Set(assignments.map((assignment) => assignment.profile_id));
  const assignedProfiles = profileSummaries.filter((profile) => assignedIds.has(profile.id));
  const availableProfiles = profileSummaries.filter((profile) => {
    return !assignedIds.has(profile.id) && profile.is_active && !isManagerRole(profile.role);
  });
  const configuredMaterialDriverIds = [...readMaterialDriverProfileIdsFromEnv()];
  const tasks = data.tasks.filter((task) => task.project_id === id && !task.deleted_at).slice(0, 24);
  const completionProfileIds = new Set(
    tasks
      .map((task) => getTaskCompletionAudit(task).completedById)
      .filter((profileId): profileId is string => Boolean(profileId)),
  );
  const completionProfiles = profileSummaries.filter((profile) =>
    completionProfileIds.has(profile.id),
  );
  const projectSessions = sessions.filter((session) => session.projectId === id).slice(0, 18);
  const projectMediaRows = data.media.filter((item) => item.project_id === id);
  const clockOutEventIds = new Set(
    projectSessions
      .map((session) => session.clockOutEventId)
      .filter((eventId): eventId is string => Boolean(eventId)),
  );
  const checkoutEvidenceMedia = projectMediaRows.filter((item) => {
    if (item.deleted_at) return false;
    if (!item.is_checkout) return false;
    if (item.media_type !== "video") return false;
    if (item.time_event_id && clockOutEventIds.has(item.time_event_id)) {
      return true;
    }

    if (item.time_event_id !== null) return false;
    const createdMs = new Date(item.created_at).getTime();
    if (!Number.isFinite(createdMs)) return false;

    return projectSessions.some((session) => {
      if (!session.clockOutTime) return false;
      if (item.uploaded_by !== session.profileId) return false;
      const clockInMs = new Date(session.clockInTime).getTime();
      const clockOutMs = new Date(session.clockOutTime).getTime();
      if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs)) {
        return false;
      }
      return createdMs >= clockInMs && createdMs <= clockOutMs + 24 * 60 * 60 * 1000;
    });
  });
  const taskReferencedMediaIds = collectTaskReferencedMediaIds(tasks);
  const knownMediaIds = new Set(data.media.map((item) => item.id));
  const missingTaskMediaIds = taskReferencedMediaIds.filter((mediaId) => !knownMediaIds.has(mediaId));
  let missingTaskMediaRows: Media[] = [];
  if (missingTaskMediaIds.length > 0) {
    const { data: referencedMedia, error: referencedMediaError } = await supabase
      .from("media")
      .select("*")
      .in("id", missingTaskMediaIds)
      .eq("project_id", id)
      .returns<Media[]>();
    if (referencedMediaError) {
      throw new Error(`Task media query failed: ${referencedMediaError.message}`);
    }
    missingTaskMediaRows = referencedMedia ?? [];
  }

  const media = mergeMediaWithTaskReferences(
    [...projectMediaRows.slice(0, 18), ...checkoutEvidenceMedia],
    [...data.media, ...missingTaskMediaRows],
    taskReferencedMediaIds,
  ).sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );

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
      managerName={data.manager.name}
      managerRole={data.manager.role}
      project={project}
      assignedProfiles={assignedProfiles}
      availableProfiles={availableProfiles}
      completionProfiles={completionProfiles}
      assignments={assignments}
      tasks={tasks}
      media={media}
      sessions={projectSessions}
      gpsStatusByProfileId={gpsStatusByProfileId}
      gpsFreshnessByProfileId={freshnessByProfileId}
      shiftReviewByProfileId={shiftReviewByProfileId}
      safetyAcksToday={safetyAcksToday}
      hasFinanceAccess={managerHasFinanceAccess}
      canDeleteMedia={canDeleteMediaEverywhereServer(data.manager)}
      configuredMaterialDriverIds={configuredMaterialDriverIds}
    />
  );
}
