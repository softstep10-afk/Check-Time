import type { UserRole } from "@/types/database";

export type MaterialDriverProfileLike = {
  id?: string | null;
  role?: UserRole | string | null;
};

export type MaterialDriverPermissionOptions = {
  configuredDriverProfileIds?: Iterable<string> | null;
};

function normalizeProfileId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function parseMaterialDriverProfileIds(
  value: string | readonly string[] | null | undefined,
): ReadonlySet<string> {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,;]+/)
      : [];
  const ids = new Set<string>();
  for (const raw of rawValues) {
    const normalized = normalizeProfileId(raw);
    if (normalized) {
      ids.add(normalized);
    }
  }
  return ids;
}

function isConfiguredMaterialDriverProfile(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  const profileId = normalizeProfileId(profile?.id ?? null);
  if (!profileId || !options.configuredDriverProfileIds) {
    return false;
  }

  for (const configuredId of options.configuredDriverProfileIds) {
    if (normalizeProfileId(configuredId) === profileId) {
      return true;
    }
  }
  return false;
}

export function isMaterialDriverProfile(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  return profile?.role === "driver" || isConfiguredMaterialDriverProfile(profile, options);
}

export function canUseDriverMaterialView(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  return isMaterialDriverProfile(profile, options);
}

export function shouldFilterWorkerTasksToMaterials(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  return isMaterialDriverProfile(profile, options);
}

export function filterMaterialDriverProfiles<T extends MaterialDriverProfileLike>(
  profiles: readonly T[],
  options: MaterialDriverPermissionOptions = {},
): T[] {
  return profiles.filter((profile) => isMaterialDriverProfile(profile, options));
}

export function isEligibleMaterialTaker(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  if (!profile) return false;
  if (isMaterialDriverProfile(profile, options)) return true;
  return profile.role === "worker";
}

export function canSeeOpenMaterialTask(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  return isEligibleMaterialTaker(profile, options);
}

export function canClaimOpenMaterialTask(
  profile: MaterialDriverProfileLike | null | undefined,
  options: MaterialDriverPermissionOptions = {},
): boolean {
  return isEligibleMaterialTaker(profile, options);
}

export function filterMaterialTakerProfiles<T extends MaterialDriverProfileLike>(
  profiles: readonly T[],
  options: MaterialDriverPermissionOptions = {},
): T[] {
  return profiles.filter((profile) => isEligibleMaterialTaker(profile, options));
}
