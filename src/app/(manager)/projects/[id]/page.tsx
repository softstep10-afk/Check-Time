import { notFound } from "next/navigation";
import { ProjectDetailPage } from "@/components/manager/ProjectDetailPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  isManagerRole,
} from "@/lib/manager-utils";

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
    />
  );
}
