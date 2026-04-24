import { TeamPage } from "@/components/manager/TeamPage";
import { getTeamPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProfileSummaries } from "@/lib/manager-utils";

export const revalidate = 30;

export default async function TeamRoutePage() {
  const data = await getTeamPageData();
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
