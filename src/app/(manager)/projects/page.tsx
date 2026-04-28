import { ProjectsPage } from "@/components/manager/ProjectsPage";
import { getProjectsPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProjectSummaries } from "@/lib/manager-utils";

// F5 must reflect newly created/edited/deleted projects immediately.
export const revalidate = 0;

export default async function ProjectsRoutePage() {
  const data = await getProjectsPageData();
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions);

  return (
    <ProjectsPage
      initialProjects={projectSummaries}
    />
  );
}
