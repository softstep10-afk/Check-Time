import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/types/database";

/**
 * Roles that always have finance-access. No capability row is consulted
 * for these — owner and admin bypass the per-user toggle entirely.
 *
 * Mirrors the receipt-row branch of the public.media SELECT policy in
 * migration 00022_finance_access.sql. Keep the two definitions in sync.
 */
export const ALWAYS_FINANCE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "owner",
  "admin",
]);

/**
 * Resolve finance-access for a given profile.
 *
 *   true  iff role ∈ {owner, admin}
 *         OR user_capabilities has (user_id=profile.id,
 *            capability='finance_access', granted=true).
 *
 * Tolerates the user_capabilities table being absent (returns role-only
 * result), matching the same fallback used by fetchUserCapabilities()
 * in capabilities.ts.
 */
export async function hasFinanceAccess(
  supabase: SupabaseClient,
  profile: { id: string; role: UserRole },
): Promise<boolean> {
  if (ALWAYS_FINANCE_ROLES.has(profile.role)) return true;

  const { data, error } = await supabase
    .from("user_capabilities")
    .select("granted")
    .eq("user_id", profile.id)
    .eq("capability", "finance_access")
    .maybeSingle<{ granted: boolean }>();

  if (error) return false;
  return data?.granted === true;
}

/**
 * Synchronous variant for when the caller already has the capability
 * map in hand (e.g. fetchUserCapabilities() was already called for this
 * user). Same semantics as the async version.
 */
export function hasFinanceAccessSync(
  profile: { role: UserRole },
  capabilities: { finance_access?: boolean } | null | undefined,
): boolean {
  if (ALWAYS_FINANCE_ROLES.has(profile.role)) return true;
  return capabilities?.finance_access === true;
}

/**
 * Batch-fetch the set of user IDs (in the caller's org, per the
 * user_capabilities_select_same_org RLS policy) that have an explicit
 * finance_access grant. Used by the team-page route to hydrate the
 * roster's optimistic toggle state.
 *
 * Does NOT include owner/admin profiles — those are computed from
 * role at render time via ALWAYS_FINANCE_ROLES.
 *
 * Tolerates the table being absent: returns an empty set on error so
 * the team page still renders cleanly pre-migration.
 */
export async function fetchFinanceAccessUserIds(
  supabase: SupabaseClient,
): Promise<ReadonlySet<string>> {
  const { data, error } = await supabase
    .from("user_capabilities")
    .select("user_id")
    .eq("capability", "finance_access")
    .eq("granted", true);

  if (error || !data) return new Set();
  return new Set(
    (data as Array<{ user_id: string }>).map((row) => row.user_id),
  );
}
