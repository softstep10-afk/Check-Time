import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendNotificationToProfile } from "@/lib/notifications/send";

// Send a test push to the CALLER only — the owner's smoke tool for verifying the
// end-to-end pipe (subscribe → VAPID → push service → SW → notification). Auth-
// gated; never targets anyone but the calling profile. Push Phase 1, no triggers.

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const result = await sendNotificationToProfile(user.id, {
      title: "Check-Time",
      body: "Test notification — push is working.",
      url: "/clock",
      tag: "push-test",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
