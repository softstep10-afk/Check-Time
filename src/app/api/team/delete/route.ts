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
        { error: "Removing team members is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    const deleteAuthUser = Boolean(body.deleteAuthUser);

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
        { error: "Only owner/admin can remove owner/admin team members." },
        { status: 403 },
      );
    }

    // Soft-delete the profile (set deleted_at + deactivate)
    const { error: profileError } = await adminClient
      .from("profiles")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", targetProfile.id)
      .eq("org_id", manager.org_id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    // Optionally delete the auth user
    if (deleteAuthUser) {
      const { error: authError } = await adminClient.auth.admin.deleteUser(targetProfile.id);
      if (authError) {
        return NextResponse.json(
          { error: `Profile deactivated but auth user removal failed: ${authError.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
