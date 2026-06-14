import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { hasFinanceAccess } from "@/lib/finance-access";
import { PROFILE_WITH_RATE_SELECT, type SafeProfile } from "@/lib/profile-selects";
import type { Profile, UserRole } from "@/types/database";

export const PROFILE_RATE_ACCESS_DENIED = "profile_rate_access_denied";

export type ProfileWithRate = SafeProfile & Pick<Profile, "hourly_rate">;

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
) {
  if (!access.allowed) {
    throw new Error(PROFILE_RATE_ACCESS_DENIED);
  }

  let query = supabase
    .from("profiles")
    .select(PROFILE_WITH_RATE_SELECT)
    .returns<Profile[]>();

  if (options.orderByName) {
    query = query.order("name", { ascending: true });
  }

  return query;
}
