/**
 * Media playback selection — manager-side helper that decides whether to
 * play the original uploaded file or a browser-compatible transcoded copy.
 *
 * Storage model (no migration required):
 *   media.metadata is a JSONB column that already exists. This module
 *   reads the following optional keys from that blob:
 *
 *     metadata.playback_path        — Supabase Storage path of an H.264/MP4
 *                                     copy in the same bucket as the original.
 *     metadata.playback_mime_type   — typically "video/mp4"
 *     metadata.mux_playback_id      — Mux playback ID; NOT a Storage path.
 *                                     Consumed by a future Mux signed-URL
 *                                     minting layer, not by `path` here.
 *     metadata.transcoding_status   — "pending" | "ready" | "failed" | "not_needed"
 *     metadata.transcoding_error    — human-readable error when status === "failed"
 *
 * Read order:
 *   1. If a Storage-path playback copy exists and status is ready, the
 *      manager Open button serves that path through the 'media' bucket.
 *   2. Otherwise the original `storage_path` is used (current behavior).
 *   3. The Download button always pulls the original file regardless of
 *      transcoding state — auditing and the manager's "save it for later"
 *      workflow must never lose access to the file the worker captured.
 *
 * IMPORTANT: a Mux playback ID must NEVER be written into playback_path.
 * Doing so causes the Open button to sign a Mux ID through Supabase
 * Storage, which fails. Mux IDs live in the separate mux_playback_id
 * field and are surfaced through the `muxPlaybackId` return field below
 * for callers that know how to mint a signed Mux URL.
 *
 * The helper is intentionally tolerant: any missing or malformed metadata
 * field falls through to "use the original," so partial pipeline failures
 * never break manager playback that already worked.
 */

export type TranscodingStatus =
  | "pending"
  | "ready"
  | "failed"
  | "not_needed";

export interface MediaPlaybackInfo {
  /** Storage path the manager Open button should sign and serve. */
  path: string;
  /** MIME type of `path` — null when unknown. */
  mimeType: string | null;
  /**
   * True when `path` points at a transcoded MP4/H.264 copy.
   * False when `path` is the original uploaded file.
   */
  isPlaybackVersion: boolean;
  /** Pipeline state for the playback copy, or null if absent. */
  transcodingStatus: TranscodingStatus | null;
  /** Human-readable error from a failed transcode attempt, or null. */
  transcodingError: string | null;
  /**
   * Mux playback ID, when present. Never a Supabase Storage path —
   * callers must mint a Mux signed URL (or use Mux's player SDK) to
   * actually stream this. UI surfaces that don't yet implement Mux
   * signing should ignore this and continue serving `path`.
   */
  muxPlaybackId: string | null;
}

interface MediaLike {
  storage_path: string;
  mime_type: string | null;
  metadata: Record<string, unknown> | null | undefined;
}

const VALID_STATUSES: TranscodingStatus[] = [
  "pending",
  "ready",
  "failed",
  "not_needed",
];

function readString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStatus(meta: Record<string, unknown> | null | undefined): TranscodingStatus | null {
  const raw = readString(meta, "transcoding_status");
  if (!raw) return null;
  return VALID_STATUSES.includes(raw as TranscodingStatus)
    ? (raw as TranscodingStatus)
    : null;
}

export function selectMediaPlayback(media: MediaLike): MediaPlaybackInfo {
  const meta = media.metadata ?? null;
  const playbackPath = readString(meta, "playback_path");
  const playbackMime = readString(meta, "playback_mime_type");
  const muxPlaybackId = readString(meta, "mux_playback_id");
  const status = readStatus(meta);
  const error = readString(meta, "transcoding_error");

  if (playbackPath && status === "ready") {
    return {
      path: playbackPath,
      mimeType: playbackMime ?? "video/mp4",
      isPlaybackVersion: true,
      transcodingStatus: "ready",
      transcodingError: null,
      muxPlaybackId,
    };
  }

  return {
    path: media.storage_path,
    mimeType: media.mime_type,
    isPlaybackVersion: false,
    transcodingStatus: status,
    transcodingError: error,
    muxPlaybackId,
  };
}

/**
 * True when the original is a video the browser may not be able to decode
 * inline — currently HEVC `.mov` from iPhone cameras, which Chrome / Edge
 * / Firefox / Android can't decode. Used by the UI to decide whether to
 * show the "If the video appears black, tap Download" hint.
 */
export function isBrowserUnsafeVideo(media: MediaLike): boolean {
  const mime = media.mime_type?.toLowerCase() ?? "";
  if (mime === "video/quicktime" || mime === "video/x-h265" || mime === "video/h265") {
    return true;
  }
  const path = media.storage_path.toLowerCase();
  return path.endsWith(".mov");
}
