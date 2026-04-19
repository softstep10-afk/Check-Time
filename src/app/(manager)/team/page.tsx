import { TeamPage } from "@/components/manager/TeamPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { buildManagerSessions, buildProfileSummaries } from "@/lib/manager-utils";

export default async function TeamRoutePage() {
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);
  const profileSummaries = buildProfileSummaries(data, sessions).filter(
    (profile) => !profile.deleted_at,
  );

  return (
    <TeamPage
      initialProfiles={profileSummaries}
      hasAdminProvisioning={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      managerId={data.manager.id}
    />
  );
}
