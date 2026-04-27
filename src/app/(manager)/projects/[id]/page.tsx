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
    />
  );
}
