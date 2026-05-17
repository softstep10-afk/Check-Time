import { TeamPage } from "@/components/manager/TeamPage";
import { getTeamPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProfileSummaries } from "@/lib/manager-utils";
import {
  ALWAYS_FINANCE_ROLES,
  fetchFinanceAccessUserIds,
  hasFinanceAccess,
} from "@/lib/finance-access";
import { createClient } from "@/lib/supabase/server";

// F5 must reflect newly added/edited workers and live shift state.
export const revalidate = 15;

export default async function TeamRoutePage() {
  const data = await getTeamPageData();
  const sessions = buildManagerSessions(data);
  // user_capabilities is scoped to the actor's org via RLS, so an
  // unauthenticated request (preview/AUTH_BYPASS) gets an empty set —
  // owner/admin are still resolved via role inside buildProfileSummaries.
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const financeAccessUserIds = await fetchFinanceAccessUserIds(supabase);
  const profileSummaries = buildProfileSummaries(
    data,
    sessions,
    financeAccessUserIds,
  ).filter((profile) => !profile.deleted_at);

  return (
    <TeamPage
      initialProfiles={profileSummaries}
      hasAdminProvisioning={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      hasFinanceAccess={managerHasFinanceAccess}
      canManageFinanceAccess={ALWAYS_FINANCE_ROLES.has(data.manager.role)}
      managerId={data.manager.id}
    />
  );
}
