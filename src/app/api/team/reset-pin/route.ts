import { hash } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManagerContext } from "@/lib/manager-data";
import { canManageTeamMember } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/database";

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

    const { data: targetProfile, error: targetProfileError } = await adminClient
      .from("profiles")
      .select("id, org_id, role")
      .eq("id", profileId)
      .eq("org_id", manager.org_id)
      .maybeSingle<{ id: string; org_id: string; role: UserRole }>();

    if (targetProfileError) {
      return NextResponse.json({ error: targetProfileError.message }, { status: 500 });
    }

    if (!targetProfile) {
      return NextResponse.json({ error: "Team member not found." }, { status: 404 });
    }

    if (!canManageTeamMember(manager.role, targetProfile.role)) {
      return NextResponse.json(
        { error: "Only owner/admin can reset owner/admin PINs." },
        { status: 403 },
      );
    }

    // Generate a new random 4-digit PIN
    const newPin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await hash(newPin);

    const { error } = await adminClient
      .from("profiles")
      .update({ pin_hash: pinHash })
      .eq("id", targetProfile.id)
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
