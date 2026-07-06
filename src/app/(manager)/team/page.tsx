import { Suspense } from "react";
import { TeamPage } from "@/components/manager/TeamPage";
import { getTeamPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProfileSummaries } from "@/lib/manager-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import { createClient } from "@/lib/supabase/server";
import TeamLoading from "./loading";

// F5 must reflect newly added/edited workers and live shift state.
export const revalidate = 15;

// The shell (manager layout chrome) paints immediately; the workspace query
// batch streams into this Suspense boundary, reusing the route skeleton so the
// user never waits on a blank screen. Data/computation are unchanged — only when
// they reach the browser.
export default function TeamRoutePage() {
  return (
    <Suspense fallback={<TeamLoading />}>
      <TeamRouteContent />
    </Suspense>
  );
}

async function TeamRouteContent() {
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
  const profileSummaries = buildProfileSummaries(
    data,
    sessions,
  ).filter((profile) => !profile.deleted_at);

  return (
    <TeamPage
      initialProfiles={profileSummaries}
      hasAdminProvisioning={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      hasFinanceAccess={managerHasFinanceAccess}
      managerId={data.manager.id}
      managerRole={data.manager.role}
    />
  );
}
