import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertSubscription } from "@/lib/notifications/subscriptions";
import type { BrowserPushSubscription } from "@/lib/notifications/types";

// Store/refresh THIS device's push subscription for the calling worker. Auth-gated;
// the subscription is written with the service role (no client table access).
// Push notifications Phase 1 — infra only, no production triggers.

function asSubscription(value: unknown): BrowserPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const sub = value as { endpoint?: unknown; keys?: unknown };
  const keys = sub.keys as { p256dh?: unknown; auth?: unknown } | undefined;
  if (
    typeof sub.endpoint !== "string" ||
    !sub.endpoint ||
    typeof keys?.p256dh !== "string" ||
    typeof keys?.auth !== "string"
  ) {
    return null;
  }
  return { endpoint: sub.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { subscription?: unknown };
    const subscription = asSubscription(body.subscription);
    if (!subscription) {
      return NextResponse.json({ error: "Invalid push subscription." }, { status: 400 });
    }

    const stored = await upsertSubscription({
      profileId: user.id,
      subscription,
      userAgent: request.headers.get("user-agent")?.slice(0, 400) ?? null,
    });

    // `stored: false` means the table isn't applied yet (or no service key) —
    // still a 200 so the client treats it as subscribed; the lib logged the no-op.
    return NextResponse.json({ ok: true, stored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
