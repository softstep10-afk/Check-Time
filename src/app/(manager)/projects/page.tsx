import { ProjectsPage } from "@/components/manager/ProjectsPage";
import { getActiveOperationalProjects } from "@/lib/archive-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getProjectsPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProjectSummaries } from "@/lib/manager-utils";
import { createClient } from "@/lib/supabase/server";

// F5 must reflect newly created/edited/deleted projects immediately.
export const revalidate = 0;

export default async function ProjectsRoutePage() {
  const data = await getProjectsPageData();
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials: managerHasFinanceAccess,
  });
  const activeProjectSummaries = getActiveOperationalProjects(projectSummaries);

  return (
    <ProjectsPage
      initialProjects={activeProjectSummaries}
      hasFinanceAccess={managerHasFinanceAccess}
    />
  );
}
