import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeByEndpoint } from "@/lib/notifications/subscriptions";

// Revoke THIS device's push subscription for the calling worker. Auth-gated,
// service-role write. Push notifications Phase 1.

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

    const body = (await request.json().catch(() => ({}))) as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || !body.endpoint) {
      return NextResponse.json({ error: "Missing endpoint." }, { status: 400 });
    }

    const revoked = await revokeByEndpoint(user.id, body.endpoint);
    return NextResponse.json({ ok: true, revoked });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
