import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeStoragePath } from "@/lib/task-attachments";
import type { Media } from "@/types/database";

export const runtime = "nodejs";

/**
 * POST /api/media/transcode
 *
 * Body: { mediaId: string }
 *
 * Fire-and-forget kickoff that:
 *   1. Authenticates the caller (their session must see the media row).
 *   2. Reads the media row.
 *   3. Skips non-video uploads.
 *   4. Generates a 24-hour signed URL for the original file so Mux can
 *      pull it from Supabase Storage.
 *   5. Calls the Mux REST API to create an asset with playback_policy=signed.
 *   6. Writes the resulting playback ID into media.metadata.mux_playback_id
 *      and sets transcoding_status='pending'. The webhook route (separate
 *      task) is responsible for flipping status to 'ready' once Mux
 *      finishes encoding.
 *
 * The caller is expected to fire-and-forget this endpoint after the
 * media row insert completes.
 *
 * NOTE: mux_playback_id is a Mux identifier, NOT a Supabase Storage path.
 * It must never be written into metadata.playback_path — selectMediaPlayback
 * treats playback_path as a Storage path and signs it through the 'media'
 * bucket. Conflating the two breaks the manager Open button. A future task
 * that mints Mux signed playback URLs should consume mux_playback_id
 * directly via the Mux JWT signing key, separate from selectMediaPlayback.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      mediaId?: unknown;
    } | null;
    const mediaId = typeof body?.mediaId === "string" ? body.mediaId : "";
    if (!mediaId) {
      return NextResponse.json(
        { error: "mediaId is required." },
        { status: 400 },
      );
    }

    const muxTokenId = process.env.MUX_TOKEN_ID;
    const muxTokenSecret = process.env.MUX_TOKEN_SECRET;
    if (!muxTokenId || !muxTokenSecret) {
      return NextResponse.json(
        { error: "Mux credentials not configured." },
        { status: 503 },
      );
    }

    // Read the row through the user's RLS-scoped client so we cannot
    // accidentally transcode a video the caller isn't allowed to see.
    const mediaResult = await supabase
      .from("media")
      .select("id, org_id, media_type, storage_path, metadata")
      .eq("id", mediaId)
      .maybeSingle<Pick<Media, "id" | "org_id" | "media_type" | "storage_path" | "metadata">>();

    if (mediaResult.error) {
      return NextResponse.json(
        { error: mediaResult.error.message },
        { status: 500 },
      );
    }
    if (!mediaResult.data) {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }

    const media = mediaResult.data;
    if (media.media_type !== "video") {
      return NextResponse.json({ ok: true, skipped: "not_video" });
    }

    // Idempotency: if a Mux asset was already created, don't create a
    // second one. The webhook is responsible for flipping status; do
    // not re-kickoff while pending or already ready.
    const existingMetadata =
      (media.metadata as Record<string, unknown> | null) ?? {};
    const existingStatus = existingMetadata.transcoding_status;
    const existingMuxAsset = existingMetadata.mux_asset_id;
    if (
      existingMuxAsset ||
      existingStatus === "pending" ||
      existingStatus === "ready"
    ) {
      return NextResponse.json({ ok: true, skipped: "already_processing" });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Service role not configured." },
        { status: 503 },
      );
    }

    // 24-hour signed URL — Mux ingests within seconds normally, but
    // longer TTL covers retries / queue backpressure on Mux's side.
    const normalizedPath = normalizeStoragePath(media.storage_path);
    const { data: signedData, error: signError } = await admin.storage
      .from("media")
      .createSignedUrl(normalizedPath, 24 * 60 * 60);
    if (signError || !signedData?.signedUrl) {
      return NextResponse.json(
        {
          error: signError?.message ?? "Could not sign source URL.",
        },
        { status: 500 },
      );
    }

    // Mux REST API — HTTP Basic Auth using token ID + secret.
    // Signed playback policy keeps the resulting asset behind a JWT;
    // the webhook task is responsible for minting playback URLs.
    const basicAuth = Buffer.from(`${muxTokenId}:${muxTokenSecret}`).toString(
      "base64",
    );
    const muxResp = await fetch("https://api.mux.com/video/v1/assets", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [{ url: signedData.signedUrl }],
        playback_policy: ["signed"],
        encoding_tier: "baseline",
      }),
    });

    if (!muxResp.ok) {
      const errorText = await muxResp.text();
      // Persist the failure so the manager UI can show "Preview unavailable".
      await admin
        .from("media")
        .update({
          metadata: {
            ...existingMetadata,
            transcoding_status: "failed",
            transcoding_error: errorText.slice(0, 500),
          },
        })
        .eq("id", mediaId)
        .eq("org_id", media.org_id);
      return NextResponse.json(
        { error: "Mux create asset failed", detail: errorText },
        { status: muxResp.status },
      );
    }

    const muxJson = (await muxResp.json()) as {
      data?: {
        id?: string;
        playback_ids?: Array<{ id: string; policy: string }>;
      };
    };
    const assetId = muxJson.data?.id;
    const playbackId = muxJson.data?.playback_ids?.[0]?.id;
    if (!assetId || !playbackId) {
      return NextResponse.json(
        { error: "Mux response missing IDs." },
        { status: 502 },
      );
    }

    const { error: updateError } = await admin
      .from("media")
      .update({
        metadata: {
          ...existingMetadata,
          mux_asset_id: assetId,
          mux_playback_id: playbackId,
          transcoding_status: "pending",
        },
      })
      .eq("id", mediaId)
      .eq("org_id", media.org_id);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      assetId,
      playbackId,
      status: "pending",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
