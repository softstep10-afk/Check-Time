import { verify } from "@node-rs/argon2";
import { NextRequest, NextResponse } from "next/server";
import {
  buildPinLoginRateLimitKey,
  checkGlobalPinLoginRateLimit,
  checkPinLoginRateLimit,
  clearPinLoginRateLimit,
  recordGlobalPinLoginFailure,
  recordPinLoginFailure,
} from "@/lib/pin-login-rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { readTrustedClientIp } from "@/lib/server/request-ip";
import { isValidTeamPasscode } from "@/lib/team-member-provisioning";
import type { UserRole } from "@/types/database";

type PinProfile = {
  id: string;
  name: string | null;
  role: UserRole;
  pin_hash: string | null;
  is_active: boolean;
};

function tooManyAttemptsResponse(retryAfterSeconds?: number): NextResponse {
  return NextResponse.json(
    {
      error: "Too many login attempts. Try again later.",
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: retryAfterSeconds
        ? { "Retry-After": String(retryAfterSeconds) }
        : undefined,
    },
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
      ipAddress: readTrustedClientIp(request),
    });

    // Global endpoint circuit-breaker first (a single cheap lookup that IP
    // rotation cannot evade), then the per-client bucket.
    const globalLimit = await checkGlobalPinLoginRateLimit(adminClient);
    if (!globalLimit.allowed) {
      return tooManyAttemptsResponse(globalLimit.retryAfterSeconds);
    }
    const rateLimit = await checkPinLoginRateLimit(adminClient, rateLimitKey);
    if (!rateLimit.allowed) {
      return tooManyAttemptsResponse(rateLimit.retryAfterSeconds);
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
      // Count the miss against both the caller's bucket and the global ceiling.
      await recordPinLoginFailure(adminClient, rateLimitKey);
      await recordGlobalPinLoginFailure(adminClient);
      return NextResponse.json(
        { error: "PIN not recognized." },
        { status: 401 },
      );
    }

    // Clear only the caller's bucket on success; the global ceiling is never
    // cleared by a success (it decays with its own window) so it can't be reset.
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
