import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import {
  LINK_CHECKIN_AUDIT_ACTION,
  runLinkCheckoutVideo,
} from "@/lib/checkout-link-server";

export const runtime = "nodejs";

/**
 * POST /api/worker/link-checkin-video
 *
 * Body: { timeEventId: string }
 *
 * Sister of /api/worker/link-checkout-video. Same orchestration —
 * predicate-narrowed UPDATE under the service-role admin client, audit
 * row, time_events.video_status flip — but for the START-of-shift video
 * (a "before work" upload). The only differences from the checkout
 * surface are:
 *
 *   • expectedEventType is "clock_in" instead of "clock_out".
 *   • candidate media must have is_checkout=false. A clock_in video is
 *     proof of arrival, not proof of departure; conflating the two flags
 *     would let a checkout video accidentally back-fill a clock_in.
 *   • the audit_log row uses LINK_CHECKIN_AUDIT_ACTION so an auditor
 *     reading the table can split the surfaces by `action`.
 *
 * The route stays thin on purpose: every predicate lives in
 * runLinkCheckoutVideo so a regression on either surface fails
 * the existing unit tests rather than a security review.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      timeEventId?: unknown;
    } | null;
    const timeEventId = readRequiredUuid(body?.timeEventId, "time event id");
    if (!timeEventId.ok) {
      return NextResponse.json({ error: timeEventId.error }, { status: timeEventId.status });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Video linking is temporarily unavailable." },
        { status: 503 },
      );
    }

    const outcome = await runLinkCheckoutVideo({
      userId: user.id,
      timeEventId: timeEventId.value,
      supabase,
      admin,
      expectedEventType: "clock_in",
      isCheckoutMatch: false,
      auditAction: LINK_CHECKIN_AUDIT_ACTION,
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
