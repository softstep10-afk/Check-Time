import { SettingsPage } from "@/components/manager/SettingsPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";

export default async function SettingsRoutePage() {
  const data = await getManagerWorkspaceData();

  return (
    <SettingsPage
      orgId={data.org.id}
      orgName={data.org.name}
      orgSlug={data.org.slug}
      managerName={data.manager.name}
      crewCount={data.profiles.length}
      activeProjectCount={data.projects.filter((project) => project.status === "active").length}
    />
  );
}
