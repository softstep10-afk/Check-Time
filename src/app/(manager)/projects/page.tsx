import { ProjectsPage } from "@/components/manager/ProjectsPage";
import { getProjectsPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProjectSummaries } from "@/lib/manager-utils";

export const revalidate = 30;

export default async function ProjectsRoutePage() {
  const data = await getProjectsPageData();
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions);

  return (
    <ProjectsPage
      orgId={data.manager.org_id}
      initialProjects={projectSummaries}
    />
  );
}
