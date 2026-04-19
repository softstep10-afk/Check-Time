import { hash } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManagerContext } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile: manager } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Resetting PINs needs SUPABASE_SERVICE_ROLE_KEY on the server." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const profileId = typeof body.profileId === "string" ? body.profileId : "";

    if (!profileId) {
      return NextResponse.json({ error: "Profile ID is required." }, { status: 400 });
    }

    // Generate a new random 4-digit PIN
    const newPin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await hash(newPin);

    const { error } = await adminClient
      .from("profiles")
      .update({ pin_hash: pinHash })
      .eq("id", profileId)
      .eq("org_id", manager.org_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, pin: newPin });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
