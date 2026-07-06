import { Suspense } from "react";
import { SettingsPage } from "@/components/manager/SettingsPage";
import { getDisplayOrgName } from "@/lib/brand";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import SettingsLoading from "./loading";

// The manager layout chrome paints immediately; the workspace query batch streams
// into this Suspense boundary. Data/computation unchanged — only delivery timing.
export default function SettingsRoutePage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsRouteContent />
    </Suspense>
  );
}

async function SettingsRouteContent() {
  const data = await getManagerWorkspaceData();

  return (
    <SettingsPage
      orgId={data.org.id}
      orgName={getDisplayOrgName(data.org.name)}
      orgSlug={data.org.slug}
      managerName={data.manager.name}
      crewCount={data.profiles.length}
      activeProjectCount={data.projects.filter((project) => project.status === "active").length}
    />
  );
}
