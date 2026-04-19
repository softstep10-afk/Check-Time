import { verify } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/types/database";

type PinProfile = {
  id: string;
  role: UserRole;
  pin_hash: string | null;
  is_active: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";

    if (!/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: "Enter a valid 4 to 6 digit PIN." },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        {
          error:
            "PIN login needs SUPABASE_SERVICE_ROLE_KEY on the server before sessions can be issued.",
        },
        { status: 503 },
      );
    }

    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, role, pin_hash, is_active")
      .eq("is_active", true)
      .not("pin_hash", "is", null)
      .returns<PinProfile[]>();

    if (profilesError) {
      return NextResponse.json(
        { error: profilesError.message },
        { status: 500 },
      );
    }

    let matchedProfile: PinProfile | null = null;

    for (const profile of profiles ?? []) {
      if (!profile.pin_hash) {
        continue;
      }

      const matches = await verify(profile.pin_hash, pin);
      if (matches) {
        matchedProfile = profile;
        break;
      }
    }

    if (!matchedProfile) {
      return NextResponse.json(
        { error: "PIN not recognized." },
        { status: 401 },
      );
    }

    const { data: authUserResult, error: authUserError } =
      await adminClient.auth.admin.getUserById(matchedProfile.id);

    if (authUserError || !authUserResult.user?.email) {
      return NextResponse.json(
        { error: authUserError?.message ?? "Account email is missing." },
        { status: 500 },
      );
    }

    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email: authUserResult.user.email,
      });

    if (linkError || !linkData.properties.email_otp) {
      return NextResponse.json(
        { error: linkError?.message ?? "Could not generate a login token." },
        { status: 500 },
      );
    }

    const { data: sessionData, error: sessionError } =
      await adminClient.auth.verifyOtp({
        email: authUserResult.user.email,
        token: linkData.properties.email_otp,
        type: "email",
      });

    if (sessionError || !sessionData.session) {
      return NextResponse.json(
        { error: sessionError?.message ?? "Could not start a session." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      role: matchedProfile.role,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
