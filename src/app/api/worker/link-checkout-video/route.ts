import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CHECKOUT_LINK_WINDOW_MS,
  selectLinkableMediaIds,
  startOfTodayIso,
  validateClockOutEvent,
  type CandidateMediaRow,
  type ClockOutEventLite,
} from "@/lib/checkout-link";

export const runtime = "nodejs";

/**
 * POST /api/worker/link-checkout-video
 *
 * Body: { timeEventId: string }
 *
 * Stamps the worker's "before you leave" videos with the time_event_id
 * of the clock_out row that just closed their shift. The worker's
 * RLS-scoped Supabase client cannot perform this UPDATE (no worker-safe
 * UPDATE policy on public.media), so this route runs through the
 * service-role admin client after re-validating that:
 *
 *   1. the caller is authenticated;
 *   2. the time_event row belongs to the caller;
 *   3. the time_event is a clock_out, not a clock_in / break;
 *   4. the time_event_time is inside CHECKOUT_LINK_WINDOW_MS of now;
 *   5. each candidate media row is the caller's own video, for the same
 *      project + org, marked is_checkout=true, currently unlinked, and
 *      created within the today-window.
 *
 * The UPDATE only writes time_event_id. Storage paths, captions, and
 * every other field on the media row are left untouched — the original
 * video file is never modified or moved. We re-state every predicate
 * inside the service-role UPDATE so a malicious or stale request body
 * cannot widen the blast radius beyond what the validation pass found.
 *
 * An audit_log row is written for every successful invocation so a
 * manager can confirm which media got attached to which shift, even
 * though the work itself was service-role.
 *
 * Best-effort: the WorkerShell.clockOut caller never aborts a
 * successful clock-out on a non-2xx response from this endpoint. The
 * worst-case outcome of a failed link is an orphaned but non-destructive
 * media row that a future retry can sweep up — never a duplicated or
 * lost video.
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
    const timeEventId =
      typeof body?.timeEventId === "string" ? body.timeEventId : "";
    if (!timeEventId) {
      return NextResponse.json(
        { error: "timeEventId required" },
        { status: 400 },
      );
    }

    // Step 1 — read the time_event through the user-scoped client. RLS
    // already prevents reading other workers' events, but we re-check
    // ownership in code so the failure mode is an explicit 403/404.
    const eventResult = await supabase
      .from("time_events")
      .select("id, profile_id, project_id, org_id, event_type, event_time")
      .eq("id", timeEventId)
      .maybeSingle<ClockOutEventLite>();

    if (eventResult.error) {
      return NextResponse.json(
        { error: eventResult.error.message },
        { status: 500 },
      );
    }

    const validation = validateClockOutEvent(eventResult.data, user.id);
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status },
      );
    }
    const event = eventResult.data!;

    // Step 2 — admin client narrowly performs the UPDATE. Service role
    // bypasses RLS, but the predicates here repeat exactly the same
    // constraints validateClockOutEvent + selectLinkableMediaIds enforce.
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Service role not configured" },
        { status: 503 },
      );
    }

    const windowStartIso = startOfTodayIso();
    const candidatesResult = await admin
      .from("media")
      .select("id, uploaded_by, project_id, org_id, media_type, is_checkout, time_event_id, created_at")
      .eq("uploaded_by", user.id)
      .eq("project_id", event.project_id)
      .eq("org_id", event.org_id)
      .eq("media_type", "video")
      .eq("is_checkout", true)
      .is("time_event_id", null)
      .gte("created_at", windowStartIso)
      .returns<CandidateMediaRow[]>();

    if (candidatesResult.error) {
      return NextResponse.json(
        { error: candidatesResult.error.message },
        { status: 500 },
      );
    }

    const ids = selectLinkableMediaIds(candidatesResult.data ?? [], {
      callerProfileId: user.id,
      projectId: event.project_id,
      orgId: event.org_id,
      windowStartIso,
    });

    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        linked: 0,
        mediaIds: [] as string[],
      });
    }

    // Update only time_event_id — never touch storage_path, mime_type,
    // caption, metadata, or any field that could mutate the original
    // video. Predicates re-asserted inside the UPDATE so a concurrent
    // writer flipping time_event_id between the read and the write
    // cannot produce a double-stamp.
    const updateResult = await admin
      .from("media")
      .update({ time_event_id: event.id })
      .in("id", ids)
      .eq("uploaded_by", user.id)
      .eq("project_id", event.project_id)
      .eq("org_id", event.org_id)
      .eq("media_type", "video")
      .eq("is_checkout", true)
      .is("time_event_id", null)
      .select("id");

    if (updateResult.error) {
      return NextResponse.json(
        { error: updateResult.error.message },
        { status: 500 },
      );
    }

    const linkedIds = (updateResult.data ?? []).map(
      (row: { id: string }) => row.id,
    );

    // Profile-driven audit row. We use the admin client both because
    // the worker's session has audit_log_insert_self anyway and because
    // we want the audit to land even if the caller's session expires
    // mid-call. Best-effort: a failed audit insert is logged but never
    // overrides the linking response.
    try {
      const profileLookup = await admin
        .from("profiles")
        .select("name, role")
        .eq("id", user.id)
        .maybeSingle<{ name: string; role: string }>();
      const actorName = profileLookup.data?.name ?? "Worker";
      const actorRole = profileLookup.data?.role ?? "worker";
      const auditResult = await admin.from("audit_log").insert({
        org_id: event.org_id,
        actor_id: user.id,
        actor_name: actorName,
        actor_role: actorRole,
        action: "checkout_video_linked",
        target_type: "time_event",
        target_id: event.id,
        before_data: null,
        after_data: {
          time_event_id: event.id,
          project_id: event.project_id,
          media_ids: linkedIds,
          window_ms: CHECKOUT_LINK_WINDOW_MS,
        },
      });
      if (auditResult.error) {
        console.warn(
          "[link-checkout-video] audit insert failed:",
          auditResult.error.message,
        );
      }
    } catch (auditErr) {
      console.warn("[link-checkout-video] audit insert threw:", auditErr);
    }

    return NextResponse.json({
      ok: true,
      linked: linkedIds.length,
      mediaIds: linkedIds,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
