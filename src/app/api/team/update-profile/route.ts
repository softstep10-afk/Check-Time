import { NextRequest, NextResponse } from "next/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import { requireManagerContext } from "@/lib/manager-data";
import {
  canManageTeamMember,
  canUpdateTeamRole,
  isTeamProfileRole,
} from "@/lib/role-permissions";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertProfileRate } from "@/lib/profile-rates";
import type { Profile, UserRole } from "@/types/database";

type TargetProfile = Pick<
  Profile,
  "id" | "org_id" | "role" | "settings" | "deleted_at"
>;

function readSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile: actor } = await requireManagerContext(supabase);

    const body = (await request.json()) as Record<string, unknown>;
    const profileIdResult = readRequiredUuid(body.profileId, "profile id");
    if (!profileIdResult.ok) {
      return NextResponse.json(
        { error: profileIdResult.error },
        { status: profileIdResult.status },
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Updating team profiles is temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data: targetProfile, error: targetError } = await adminClient
      .from("profiles")
      .select("id, org_id, role, settings, deleted_at")
      .eq("id", profileIdResult.value)
      .maybeSingle<TargetProfile>();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }

    if (!targetProfile || targetProfile.org_id !== actor.org_id || targetProfile.deleted_at) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    if (!canManageTeamMember(actor.role, targetProfile.role)) {
      return NextResponse.json(
        { error: "Only owner/admin can update owner/admin team members." },
        { status: 403 },
      );
    }

    const nextRole: UserRole = isTeamProfileRole(body.role)
      ? body.role
      : targetProfile.role;

    if (!canUpdateTeamRole(actor.role, targetProfile.role, nextRole)) {
      return NextResponse.json(
        {
          error:
            nextRole === "driver" || targetProfile.role === "driver"
              ? "Only owner/admin can assign the driver role."
              : "Only owner/admin can change team member roles.",
        },
        { status: 403 },
      );
    }

    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    const roleIsOwnerAdmin = nextRole === "owner" || nextRole === "admin";
    const canSetFinancials = await hasFinanceAccess(supabase, {
      id: actor.id,
      role: actor.role,
    });
    const hourlyRateRaw =
      typeof body.hourlyRate === "string" ? body.hourlyRate.trim() : "";
    const hourlyRate =
      canSetFinancials && !roleIsOwnerAdmin && hourlyRateRaw
        ? Number.parseFloat(hourlyRateRaw)
        : null;

    if (hourlyRateRaw && (!canSetFinancials || roleIsOwnerAdmin)) {
      return NextResponse.json(
        { error: "Finance access is required to set hourly rates." },
        { status: 403 },
      );
    }

    if (hourlyRateRaw && (hourlyRate === null || !Number.isFinite(hourlyRate))) {
      return NextResponse.json(
        { error: "Hourly rate must be a valid number." },
        { status: 400 },
      );
    }

    const updates: Record<string, unknown> = {
      role: nextRole,
      require_video: roleIsOwnerAdmin ? false : Boolean(body.requireVideo),
      is_active: Boolean(body.isActive),
      settings:
        "settings" in body
          ? readSettings(body.settings)
          : readSettings(targetProfile.settings),
    };

    if (name) updates.name = name;

    const { data: updated, error: updateError } = await adminClient
      .from("profiles")
      .update(updates)
      .eq("id", targetProfile.id)
      .eq("org_id", actor.org_id)
      .select("id, role, require_video, is_active")
      .single<Pick<Profile, "id" | "role" | "require_video" | "is_active">>();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json(
        { error: "Profile update did not persist." },
        { status: 500 },
      );
    }

    if (canSetFinancials && !roleIsOwnerAdmin) {
      const { error: rateError } = await upsertProfileRate(adminClient, {
        profileId: targetProfile.id,
        orgId: actor.org_id,
        hourlyRate,
      });

      if (rateError) {
        return NextResponse.json({ error: rateError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true, profile: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
