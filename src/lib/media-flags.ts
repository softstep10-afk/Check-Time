import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Anonymous note left on a media row by any assigned worker.
 *
 * Workers see this shape via the public.media_flags_public view (no
 * author columns). Managers also see flaggedBy + reviewedBy via the
 * raw public.media_flags table.
 */
export interface MediaFlagPublic {
  id: string;
  mediaId: string;
  note: string;
  flaggedAt: string;
  reviewedAt: string | null;
  reviewedNote: string | null;
  isReviewed: boolean;
}

export interface MediaFlagFull extends MediaFlagPublic {
  flaggedBy: string | null;
  flaggedByName: string | null;
  reviewedBy: string | null;
  reviewedByName: string | null;
}

function isMissingTable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /relation .* does not exist/i.test(error.message ?? "");
}

/**
 * Worker-facing read: anonymous notes for one media id, newest first.
 *
 * Uses the public view so author columns are physically absent — workers
 * literally cannot see who flagged the media. Returns an empty list when
 * the migration hasn't been applied so the gallery still renders.
 */
export async function fetchMediaFlagsAnon(
  supabase: SupabaseClient,
  mediaId: string,
): Promise<MediaFlagPublic[]> {
  const { data, error } = await supabase
    .from("media_flags_public")
    .select("id, media_id, note, flagged_at, reviewed_at, reviewed_note, is_reviewed")
    .eq("media_id", mediaId)
    .order("flagged_at", { ascending: false });

  if (error || !data) return [];

  return (data as Array<{
    id: string;
    media_id: string;
    note: string;
    flagged_at: string;
    reviewed_at: string | null;
    reviewed_note: string | null;
    is_reviewed: boolean;
  }>).map((row) => ({
    id: row.id,
    mediaId: row.media_id,
    note: row.note,
    flaggedAt: row.flagged_at,
    reviewedAt: row.reviewed_at,
    reviewedNote: row.reviewed_note,
    isReviewed: row.is_reviewed,
  }));
}

/**
 * Manager-facing read: includes flagged_by / reviewed_by + joined names.
 * Falls back to anonymous shape when the table or join can't be read
 * (e.g. before the migration runs).
 */
export async function fetchMediaFlagsFull(
  supabase: SupabaseClient,
  mediaId: string,
): Promise<MediaFlagFull[]> {
  const { data, error } = await supabase
    .from("media_flags")
    .select(
      "id, media_id, note, flagged_at, reviewed_at, reviewed_note, flagged_by, reviewed_by, " +
        "flagger:profiles!media_flags_flagged_by_fkey(name), " +
        "reviewer:profiles!media_flags_reviewed_by_fkey(name)",
    )
    .eq("media_id", mediaId)
    .order("flagged_at", { ascending: false });

  if (error || !data) {
    // Manager's row-level read failed — fall back to the anon view so the
    // modal at least shows the notes (without author).
    const anon = await fetchMediaFlagsAnon(supabase, mediaId);
    return anon.map((flag) => ({
      ...flag,
      flaggedBy: null,
      flaggedByName: null,
      reviewedBy: null,
      reviewedByName: null,
    }));
  }

  return (data as unknown as Array<{
    id: string;
    media_id: string;
    note: string;
    flagged_at: string;
    reviewed_at: string | null;
    reviewed_note: string | null;
    flagged_by: string | null;
    reviewed_by: string | null;
    flagger: { name: string } | null;
    reviewer: { name: string } | null;
  }>).map((row) => ({
    id: row.id,
    mediaId: row.media_id,
    note: row.note,
    flaggedAt: row.flagged_at,
    reviewedAt: row.reviewed_at,
    reviewedNote: row.reviewed_note,
    isReviewed: row.reviewed_at !== null,
    flaggedBy: row.flagged_by,
    flaggedByName: row.flagger?.name ?? null,
    reviewedBy: row.reviewed_by,
    reviewedByName: row.reviewer?.name ?? null,
  }));
}

/**
 * Bulk "any open flag?" probe for a list of media ids — used by gallery
 * components to render the 🚩 indicator without N round-trips.
 *
 * Returns a Set of media ids that have at least one unreviewed flag.
 * Empty set on missing-table or query failure.
 */
export async function fetchOpenFlagMediaIds(
  supabase: SupabaseClient,
  mediaIds: string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("media_flags_public")
    .select("media_id")
    .in("media_id", mediaIds)
    .is("reviewed_at", null);

  if (error || !data) return new Set();

  return new Set((data as Array<{ media_id: string }>).map((row) => row.media_id));
}

export async function insertMediaFlag(
  supabase: SupabaseClient,
  args: { mediaId: string; flaggedBy: string; note: string },
): Promise<{ ok: true; flag: MediaFlagPublic } | { ok: false; missingTable?: boolean; message?: string }> {
  const { data, error } = await supabase
    .from("media_flags")
    .insert({
      media_id: args.mediaId,
      flagged_by: args.flaggedBy,
      note: args.note,
    })
    .select("id, media_id, note, flagged_at, reviewed_at, reviewed_note")
    .single();

  if (error) {
    if (isMissingTable(error)) return { ok: false, missingTable: true };
    return { ok: false, message: error.message };
  }

  const row = data as {
    id: string;
    media_id: string;
    note: string;
    flagged_at: string;
    reviewed_at: string | null;
    reviewed_note: string | null;
  };
  return {
    ok: true,
    flag: {
      id: row.id,
      mediaId: row.media_id,
      note: row.note,
      flaggedAt: row.flagged_at,
      reviewedAt: row.reviewed_at,
      reviewedNote: row.reviewed_note,
      isReviewed: false,
    },
  };
}

export async function reviewMediaFlag(
  supabase: SupabaseClient,
  args: { flagId: string; reviewedBy: string; reviewedNote?: string | null },
): Promise<{ ok: true } | { ok: false; missingTable?: boolean; message?: string }> {
  const { error } = await supabase
    .from("media_flags")
    .update({
      reviewed_at: new Date().toISOString(),
      reviewed_by: args.reviewedBy,
      reviewed_note: args.reviewedNote ?? null,
    })
    .eq("id", args.flagId);

  if (error) {
    if (isMissingTable(error)) return { ok: false, missingTable: true };
    return { ok: false, message: error.message };
  }
  return { ok: true };
}
