import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, ProfileRate } from "@/types/database";

export const PROFILE_SELECT_WITHOUT_RATE = [
  "id",
  "org_id",
  "name",
  "role",
  "color",
  "is_active",
  "require_video",
  "language",
  "settings",
  "last_clock_in",
  "current_project",
  "notif_mode",
  "project_access_mode",
  "deleted_at",
  "created_at",
  "updated_at",
].join(", ");

export type ProfileWithoutRate = Omit<Profile, "hourly_rate" | "pin_hash">;
export type ProfileRateValue = Pick<ProfileRate, "profile_id" | "hourly_rate">;
export type LegacyProfileRateValue = Pick<Profile, "id" | "hourly_rate">;

function normalizeHourlyRate(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function withNullProfileRate(profile: ProfileWithoutRate): Profile {
  return {
    ...profile,
    pin_hash: null,
    hourly_rate: null,
  };
}

export function profilesWithoutRates(profiles: ProfileWithoutRate[]): Profile[] {
  return profiles.map(withNullProfileRate);
}

export function applyProfileRates(
  profiles: Profile[],
  rates: ProfileRateValue[],
  legacyRates: LegacyProfileRateValue[] = [],
): Profile[] {
  const ratesByProfileId = new Map(
    rates.map((row) => [row.profile_id, normalizeHourlyRate(row.hourly_rate)]),
  );
  const legacyRatesByProfileId = new Map(
    legacyRates.map((row) => [row.id, normalizeHourlyRate(row.hourly_rate)]),
  );

  return profiles.map((profile) => ({
    ...profile,
    hourly_rate: ratesByProfileId.has(profile.id)
      ? ratesByProfileId.get(profile.id) ?? null
      : legacyRatesByProfileId.get(profile.id) ?? null,
  }));
}

export function buildProfileRateUpsert(args: {
  profileId: string;
  orgId: string;
  hourlyRate: number | null;
  updatedAt: string;
}) {
  return {
    profile_id: args.profileId,
    org_id: args.orgId,
    hourly_rate: args.hourlyRate,
    updated_at: args.updatedAt,
  };
}

export async function upsertProfileRate(
  supabase: SupabaseClient,
  args: {
    profileId: string;
    orgId: string;
    hourlyRate: number | null;
  },
) {
  return supabase
    .from("profile_rates")
    .upsert(
      buildProfileRateUpsert({
        ...args,
        updatedAt: new Date().toISOString(),
      }),
      { onConflict: "profile_id" },
    );
}

export async function hydrateProfilesWithRates(
  supabase: SupabaseClient,
  profileRows: ProfileWithoutRate[],
  canReadRates: boolean,
): Promise<Profile[]> {
  const profiles = profilesWithoutRates(profileRows);
  if (!canReadRates || profiles.length === 0) {
    return profiles;
  }

  const profileIds = profiles.map((profile) => profile.id);
  const { data: rateRows, error: rateError } = await supabase
    .from("profile_rates")
    .select("profile_id, hourly_rate")
    .in("profile_id", profileIds)
    .returns<ProfileRateValue[]>();

  if (rateError) {
    throw new Error(`Profile rates query failed: ${rateError.message}`);
  }

  const rates = rateRows ?? [];
  const rateProfileIds = new Set(rates.map((row) => row.profile_id));
  const missingProfileIds = profileIds.filter((profileId) => !rateProfileIds.has(profileId));

  if (missingProfileIds.length === 0) {
    return applyProfileRates(profiles, rates);
  }

  const { data: legacyRows, error: legacyError } = await supabase
    .from("profiles")
    .select("id, hourly_rate")
    .in("id", missingProfileIds)
    .returns<LegacyProfileRateValue[]>();

  if (legacyError) {
    throw new Error(`Legacy profile rates query failed: ${legacyError.message}`);
  }

  return applyProfileRates(profiles, rates, legacyRows ?? []);
}
