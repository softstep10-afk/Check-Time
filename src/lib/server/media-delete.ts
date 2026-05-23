import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { canDeleteMediaEverywhere } from "@/lib/media-delete-permissions";
import type { Profile } from "@/types/database";

type MediaDeleteActor = Pick<Profile, "id" | "name" | "role" | "org_id">;

type MediaDeleteRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  storage_path: string;
  media_type: string;
  deleted_at: string | null;
};

export type MediaDeleteResult =
  | { ok: true; mediaId: string; deletedAt: string; alreadyDeleted: boolean }
  | { ok: false; status: number; error: string };

export async function softDeleteMediaForActor({
  adminClient,
  actorProfile,
  mediaId,
  allowedProfileIds,
  now = () => new Date(),
}: {
  adminClient: Pick<SupabaseClient, "from">;
  actorProfile: MediaDeleteActor;
  mediaId: string;
  allowedProfileIds?: Iterable<string> | null;
  now?: () => Date;
}): Promise<MediaDeleteResult> {
  if (!canDeleteMediaEverywhere(actorProfile, { allowedProfileIds })) {
    return { ok: false, status: 403, error: "Only Andrey and Sergey can delete media." };
  }

  const { data: media, error: mediaError } = await adminClient
    .from("media")
    .select("id, org_id, project_id, storage_path, media_type, deleted_at")
    .eq("id", mediaId)
    .maybeSingle<MediaDeleteRow>();

  if (mediaError) {
    return { ok: false, status: 500, error: mediaError.message };
  }

  if (!media || media.org_id !== actorProfile.org_id) {
    return { ok: false, status: 404, error: "Media not found." };
  }

  if (media.deleted_at) {
    return { ok: true, mediaId: media.id, deletedAt: media.deleted_at, alreadyDeleted: true };
  }

  const deletedAt = now().toISOString();
  const { error: updateError } = await adminClient
    .from("media")
    .update({ deleted_at: deletedAt })
    .eq("id", media.id)
    .eq("org_id", actorProfile.org_id);

  if (updateError) {
    return { ok: false, status: 500, error: updateError.message };
  }

  return { ok: true, mediaId: media.id, deletedAt, alreadyDeleted: false };
}
