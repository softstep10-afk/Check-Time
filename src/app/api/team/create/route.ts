import { hash } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasFinanceAccess } from "@/lib/finance-access";
import { requireManagerContext } from "@/lib/manager-data";
import { canCreateTeamRole } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { buildTeamMemberEmail, isValidTeamPasscode } from "@/lib/team-member-provisioning";
import type { UserRole } from "@/types/database";

const allowedRoles: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "sales",
  "subcontractor",
  "manager",
  "admin",
];

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && allowedRoles.includes(value as UserRole);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Creating team members is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";
    const role = isUserRole(body.role) ? body.role : "worker";
    const requireVideo = Boolean(body.requireVideo);
    const hourlyRateRaw =
      typeof body.hourlyRate === "string" ? body.hourlyRate.trim() : "";

    if (!canCreateTeamRole(profile.role, role)) {
      return NextResponse.json(
        { error: "Only owner/admin can create admin team members." },
        { status: 403 },
      );
    }

    const canSetFinancials = await hasFinanceAccess(supabase, {
      id: profile.id,
      role: profile.role,
    });

    if (!canSetFinancials && hourlyRateRaw.length > 0) {
      return NextResponse.json(
        { error: "Finance access is required to set hourly rates." },
        { status: 403 },
      );
    }

    const hourlyRate =
      canSetFinancials && hourlyRateRaw.length > 0
        ? Number.parseFloat(hourlyRateRaw)
        : null;

    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }

    // PIN users still need a Supabase Auth email internally.
    const email = buildTeamMemberEmail(rawEmail, name);

    if (!isValidTeamPasscode(pin)) {
      return NextResponse.json(
        { error: "Login code must be 4 to 12 letters or digits." },
        { status: 400 },
      );
    }

    if (hourlyRate !== null && !Number.isFinite(hourlyRate)) {
      return NextResponse.json(
        { error: "Hourly rate must be a valid number." },
        { status: 400 },
      );
    }

    const password = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const pinHash = await hash(pin);
    const { data: userResult, error: createUserError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          name,
        },
      });

    if (createUserError || !userResult.user) {
      return NextResponse.json(
        { error: createUserError?.message ?? "Could not create auth user." },
        { status: 500 },
      );
    }

    const { error: profileInsertError } = await adminClient.from("profiles").insert({
      id: userResult.user.id,
      org_id: profile.org_id,
      name,
      role,
      pin_hash: pinHash,
      require_video: requireVideo,
      hourly_rate: hourlyRate,
      is_active: true,
      language: "en",
      color: "#BFA234",
      settings: {},
    });

    if (profileInsertError) {
      await adminClient.auth.admin.deleteUser(userResult.user.id);

      if (
        profileInsertError.message.includes("user_role") &&
        profileInsertError.message.includes("sales")
      ) {
        return NextResponse.json(
          {
            error:
              "The sales role is not enabled in Supabase yet. Run migration 00027_sales_role.sql, then create this user again.",
          },
          { status: 500 },
        );
      }

      return NextResponse.json(
        { error: profileInsertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, name, pin });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
