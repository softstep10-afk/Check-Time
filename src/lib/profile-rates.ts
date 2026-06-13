import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { hasFinanceAccess } from "@/lib/finance-access";
import type { SafeProfile } from "@/lib/profile-selects";
import type { Profile, UserRole } from "@/types/database";

export const PROFILE_RATE_ACCESS_DENIED = "profile_rate_access_denied";
export const PROFILE_RATES_RPC = "get_profile_rates_for_finance";

export type ProfileWithRate = SafeProfile & Pick<Profile, "hourly_rate">;
export type ProfileRateQueryResult = {
  data: Profile[] | null;
  error: PostgrestError | null;
};

export interface ProfileRateAccess {
  actorId: string;
  actorRole: UserRole;
  allowed: boolean;
}

export async function resolveProfileRateAccess(
  supabase: SupabaseClient,
  actor: { id: string; role: UserRole },
): Promise<ProfileRateAccess> {
  return {
    actorId: actor.id,
    actorRole: actor.role,
    allowed: await hasFinanceAccess(supabase, actor),
  };
}

export async function loadProfilesWithRatesForFinance(
  supabase: SupabaseClient,
  access: ProfileRateAccess,
  options: { orderByName?: boolean } = {},
): Promise<ProfileRateQueryResult> {
  if (!access.allowed) {
    throw new Error(PROFILE_RATE_ACCESS_DENIED);
  }

  let query = supabase.rpc(PROFILE_RATES_RPC);

  if (options.orderByName) {
    query = query.order("name", { ascending: true });
  }

  const { data, error } = await query;

  return {
    data: (data ?? null) as Profile[] | null,
    error,
  };
}
