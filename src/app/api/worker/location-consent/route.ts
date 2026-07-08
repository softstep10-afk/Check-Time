import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readTrustedClientIp } from "@/lib/server/request-ip";
import { GPS_CONSENT_VERSION } from "@/lib/gps-consent";
import { safeClientErrorMessage } from "@/lib/safe-log";

// Server-stamped GPS location consent (external-audit HIGH-B / #8).
//
// worker_location_consents is a WA-legal, append-only record. The browser must
// NOT be trusted to build the row. Here the client may supply ONLY the two
// things it legitimately owns — signedName and the granted/denied decision —
// and the server stamps every trusted field:
//   - worker_id / org_id : from the authenticated profile (NEVER the body)
//   - consent_version    : the GPS_CONSENT_VERSION server constant
//   - user_agent         : the request UA header
//   - ip_address         : the trusted request IP (spoofing-resistant helper)
//   - signed_at          : the DB default now()
// The insert goes through the service-role admin client; append-only (never
// updates). Once this is live the direct wlc_insert_self RLS path is revoked so
// this route is the only write channel.
export const runtime = "nodejs";

const SIGNED_NAME_MAX = 200;
const USER_AGENT_MAX = 1024;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    }

    // Server-derived identity — the client never supplies worker_id / org_id.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("id", user.id)
      .maybeSingle<{ id: string; org_id: string }>();

    if (profileError || !profile) {
      return NextResponse.json(
        { ok: false, error: profileError ? safeClientErrorMessage(profileError) : "Profile not found." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    // Accept ONLY signedName + granted. Any consent_version / worker_id / org_id
    // / consented / signed_at / ip_address present in the body is deliberately
    // ignored — the server stamps the trusted fields below.
    if (typeof body.granted !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "granted (boolean) is required." },
        { status: 400 },
      );
    }
    const granted = body.granted;

    const signedName = typeof body.signedName === "string" ? body.signedName.trim() : "";
    if (!signedName) {
      return NextResponse.json({ ok: false, error: "signedName is required." }, { status: 400 });
    }
    if (signedName.length > SIGNED_NAME_MAX) {
      return NextResponse.json({ ok: false, error: "signedName is too long." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { ok: false, error: "Consent write is temporarily unavailable." },
        { status: 503 },
      );
    }

    const userAgent = request.headers.get("user-agent")?.slice(0, USER_AGENT_MAX) ?? null;
    const ipAddress = readTrustedClientIp(request);

    // Append-only insert. signed_at uses the DB default now(); consent_version
    // is the server constant regardless of anything the client sent.
    const { error: insertError } = await admin.from("worker_location_consents").insert({
      org_id: profile.org_id,
      worker_id: profile.id,
      signed_name: signedName,
      consented: granted,
      consent_version: GPS_CONSENT_VERSION,
      user_agent: userAgent,
      ip_address: ipAddress,
    });

    if (insertError) {
      return NextResponse.json({ ok: false, error: safeClientErrorMessage(insertError) }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: safeClientErrorMessage(error) }, { status: 500 });
  }
}
