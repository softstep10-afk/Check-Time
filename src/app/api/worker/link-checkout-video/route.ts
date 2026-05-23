import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { runLinkCheckoutVideo } from "@/lib/checkout-link-server";

export const runtime = "nodejs";

/**
 * POST /api/worker/link-checkout-video
 *
 * Body: { timeEventId: string }
 *
 * Stamps the worker's "before you leave" videos with the time_event_id
 * of the clock_out row that just closed their shift. The worker's
 * RLS-scoped Supabase client cannot perform this UPDATE — the live
 * public.media table has SELECT/INSERT policies but zero UPDATE
 * policies, so a worker-client UPDATE silently affects zero rows.
 * This route runs through the service-role admin client after
 * re-validating that the time_event belongs to the caller and is a
 * recent clock_out.
 *
 * The route itself is intentionally thin: the orchestration lives in
 * runLinkCheckoutVideo so the security predicates can be unit-tested
 * end-to-end without booting Next.js.
 *
 * Best-effort: WorkerShell.clockOut never aborts a successful clock-out
 * on a non-2xx response. The worst-case outcome of a failed link is an
 * orphaned but non-destructive media row that a future retry can sweep
 * up — never a duplicated or lost video.
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
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
