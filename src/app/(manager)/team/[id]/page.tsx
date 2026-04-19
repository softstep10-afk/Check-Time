import { notFound } from "next/navigation";
import { TeamMemberPage } from "@/components/manager/TeamMemberPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
} from "@/lib/manager-utils";

export default async function TeamMemberRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const projectSummaries = buildProjectSummaries(data, sessions);
  const profile = profileSummaries.find((item) => item.id === id);

  if (!profile) {
    notFound();
  }

  const assignments = data.assignments.filter((assignment) => assignment.profile_id === id);
  const tasks = data.tasks.filter((task) => task.assigned_to === id && !task.deleted_at).slice(0, 20);
  const workerSessions = sessions.filter((session) => session.profileId === id).slice(0, 20);

  // Closed store visits in the last 7 days, newest first.
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const workerStoreVisits = data.storeVisits
    .filter(
      (visit) =>
        visit.worker_id === id &&
        Boolean(visit.exited_at) &&
        new Date(visit.entered_at).getTime() >= sevenDaysAgo,
    )
    .slice(0, 20);

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
    />
  );
}
