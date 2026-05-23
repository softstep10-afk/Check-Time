import "server-only";

import {
  canDeleteMediaEverywhere,
  parseMediaDeleteProfileIds,
  type MediaDeleteActorProfile,
} from "@/lib/media-delete-permissions";

export function getConfiguredMediaDeleteProfileIds(
  env?: { MEDIA_DELETE_PROFILE_IDS?: string },
): ReadonlySet<string> {
  const source = env ?? (process.env as Record<string, string | undefined>);
  return parseMediaDeleteProfileIds(source.MEDIA_DELETE_PROFILE_IDS);
}

export function canDeleteMediaEverywhereServer(
  profile: MediaDeleteActorProfile | null | undefined,
): boolean {
  return canDeleteMediaEverywhere(profile, {
    allowedProfileIds: getConfiguredMediaDeleteProfileIds(),
  });
}
