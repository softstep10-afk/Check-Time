import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMuxSignature } from "@/lib/mux-webhook";

export const runtime = "nodejs";

/**
 * POST /api/media/mux-webhook
 *
 * Receives Mux webhook deliveries and flips the matching media row's
 * transcoding_status. Verified via the `Mux-Signature` HMAC-SHA256
 * scheme using MUX_WEBHOOK_SECRET (stored in Vercel; created by Andrew
 * in the Mux dashboard before deploy).
 *
 * Events handled:
 *   • video.asset.ready    → metadata.transcoding_status = 'ready',
 *                            clears any prior transcoding_error.
 *   • video.asset.errored  → metadata.transcoding_status = 'failed',
 *                            metadata.transcoding_error = error text.
 *
 * Every other event type returns 200 so Mux does not retry it.
 *
 * Looks up the row by `metadata->>mux_asset_id` (set by the write-side
 * route /api/media/transcode). If no row matches we still ack 200 — a
 * stale event for a deleted media row should not turn into a Mux retry
 * loop.
 *
 * Auth model: there is no user session on a webhook call, so this route
 * uses the service-role admin client both to read and to update.
 */

interface MuxAssetData {
  id?: string;
  errors?: Array<{ messages?: string[] }>;
}

interface MuxWebhookPayload {
  type?: string;
  data?: MuxAssetData;
}

export async function POST(request: NextRequest) {
  // Read the raw body BEFORE parsing — verifyMuxSignature needs the exact
  // bytes Mux signed, and request.json() consumes the body buffer.
  const rawBody = await request.text();
  const sigHeader = request.headers.get("Mux-Signature");
  const secret = process.env.MUX_WEBHOOK_SECRET ?? null;

  const verified = verifyMuxSignature({
    rawBody,
    header: sigHeader,
    secret,
  });
  if (!verified.ok) {
    return NextResponse.json(
      { error: "Unauthorized", reason: verified.error },
      { status: 401 },
    );
  }

  let payload: MuxWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MuxWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = payload?.type;
  const assetId = payload?.data?.id;

  // Ack 200 for every event we don't act on, so Mux doesn't retry.
  if (
    eventType !== "video.asset.ready" &&
    eventType !== "video.asset.errored"
  ) {
    return NextResponse.json({ ok: true, ignored: eventType ?? "unknown" });
  }

  if (!assetId) {
    return NextResponse.json({ ok: true, skipped: "no_asset_id" });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "service_role_not_configured" },
      { status: 503 },
    );
  }

  const { data: row, error: lookupError } = await admin
    .from("media")
    .select("id, org_id, metadata")
    .eq("metadata->>mux_asset_id", assetId)
    .maybeSingle<{
      id: string;
      org_id: string;
      metadata: Record<string, unknown> | null;
    }>();

  if (lookupError) {
    return NextResponse.json(
      { error: lookupError.message },
      { status: 500 },
    );
  }
  if (!row) {
    // No matching media row — likely a stale event for a deleted upload.
    // Ack 200 so Mux doesn't keep retrying.
    return NextResponse.json({ ok: true, skipped: "no_match", assetId });
  }

  const existing = row.metadata ?? {};
  const nextMetadata: Record<string, unknown> = { ...existing };

  if (eventType === "video.asset.ready") {
    nextMetadata.transcoding_status = "ready";
    delete nextMetadata.transcoding_error;
  } else {
    nextMetadata.transcoding_status = "failed";
    const errorTexts = payload?.data?.errors
      ?.map((e) => (e.messages ?? []).join("; "))
      .filter((text) => text.length > 0)
      .join(" | ");
    nextMetadata.transcoding_error = (
      errorTexts && errorTexts.length > 0
        ? errorTexts
        : "Mux reported errored asset."
    ).slice(0, 500);
  }

  const { error: updateError } = await admin
    .from("media")
    .update({ metadata: nextMetadata })
    .eq("id", row.id)
    .eq("org_id", row.org_id);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    mediaId: row.id,
    status: nextMetadata.transcoding_status,
  });
}
