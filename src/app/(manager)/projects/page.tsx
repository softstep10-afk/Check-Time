import { ProjectsPage } from "@/components/manager/ProjectsPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { buildManagerSessions, buildProjectSummaries } from "@/lib/manager-utils";

export default async function ProjectsRoutePage() {
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions);

  return (
    <ProjectsPage
      orgId={data.manager.org_id}
      initialProjects={projectSummaries}
    />
  );
}
