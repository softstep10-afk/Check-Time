export const DEFAULT_ORG_NAME = "NW Build Pro";

export function getDisplayOrgName(name: string | null | undefined): string {
  const trimmed = name?.trim();

  if (!trimmed) {
    return DEFAULT_ORG_NAME;
  }

  const normalized = trimmed.toLowerCase().replace(/’/g, "'");
  const legacyOwnerNames = new Set(["andrew", "andrew's crew", "andrews crew"]);

  return legacyOwnerNames.has(normalized) ? DEFAULT_ORG_NAME : trimmed;
}
