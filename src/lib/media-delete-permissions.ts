import type { UserRole } from "@/types/database";

export type MediaDeleteActorProfile = {
  id?: string | null;
  name?: string | null;
  role?: UserRole | string | null;
};

const MEDIA_DELETE_NAME_KEYS = new Set([
  "andrei",
  "andrey",
  "andrew",
  "андрей",
  "sergei",
  "sergey",
  "сергей",
]);

function normalizeAllowedId(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return trimmed || null;
}

export function normalizeMediaDeleteName(value: string | null | undefined): string | null {
  if (!value) return null;
  const firstToken = value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .find(Boolean);
  if (!firstToken) return null;
  return firstToken.replace(/[^\p{L}-]/gu, "");
}

export function parseMediaDeleteProfileIds(value: string | null | undefined): ReadonlySet<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(/[,\s]+/)
      .map(normalizeAllowedId)
      .filter((entry): entry is string => Boolean(entry)),
  );
}

export function canDeleteMediaEverywhere(
  profile: MediaDeleteActorProfile | null | undefined,
  options: { allowedProfileIds?: Iterable<string> | null } = {},
): boolean {
  if (!profile) return false;

  const allowedProfileIds = new Set(
    Array.from(options.allowedProfileIds ?? [])
      .map(normalizeAllowedId)
      .filter((entry): entry is string => Boolean(entry)),
  );
  const profileId = typeof profile.id === "string" ? normalizeAllowedId(profile.id) : null;
  if (profileId && allowedProfileIds.has(profileId)) {
    return true;
  }

  if (profile.role !== "owner" && profile.role !== "admin") {
    return false;
  }

  const nameKey = normalizeMediaDeleteName(profile.name);
  return Boolean(nameKey && MEDIA_DELETE_NAME_KEYS.has(nameKey));
}
