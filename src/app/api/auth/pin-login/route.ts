import { verify } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import {
  buildPinLoginRateLimitKey,
  checkPinLoginRateLimit,
  clearPinLoginRateLimit,
  recordPinLoginFailure,
} from "@/lib/pin-login-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { isValidTeamPasscode } from "@/lib/team-member-provisioning";
import type { UserRole } from "@/types/database";

type PinProfile = {
  id: string;
  name: string | null;
  role: UserRole;
  pin_hash: string | null;
  is_active: boolean;
};

function readClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown";
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const pin = typeof body.pin === "string" ? body.pin.trim() : "";

    if (!isValidTeamPasscode(pin)) {
      return NextResponse.json(
        { error: "Enter a valid 4 to 12 character login code." },
        { status: 400 },
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "PIN login is temporarily unavailable." },
        { status: 503 },
      );
    }

    const rateLimitKey = buildPinLoginRateLimitKey({
      ipAddress: readClientIp(request),
      userAgent: request.headers.get("user-agent") ?? "unknown",
    });
    const rateLimit = await checkPinLoginRateLimit(adminClient, rateLimitKey);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many login attempts. Try again later.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: rateLimit.retryAfterSeconds
            ? { "Retry-After": String(rateLimit.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    const { data: profiles, error: profilesError } = await adminClient
      .from("profiles")
      .select("id, name, role, pin_hash, is_active")
      .eq("is_active", true)
      .not("pin_hash", "is", null)
      .returns<PinProfile[]>();

    if (profilesError) {
      return NextResponse.json(
        { error: "PIN login is temporarily unavailable." },
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
      await recordPinLoginFailure(adminClient, rateLimitKey);
      return NextResponse.json(
        { error: "PIN not recognized." },
        { status: 401 },
      );
    }

    await clearPinLoginRateLimit(adminClient, rateLimitKey);

    const { data: authUserResult, error: authUserError } =
      await adminClient.auth.admin.getUserById(matchedProfile.id);

    if (authUserError || !authUserResult.user?.email) {
      return NextResponse.json(
        { error: "PIN login is temporarily unavailable." },
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
        { error: "Could not generate a login token." },
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
        { error: "Could not start a session." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      name: matchedProfile.name?.trim() || null,
      role: matchedProfile.role,
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeClientErrorMessage(error) },
      { status: 500 },
    );
  }
}
