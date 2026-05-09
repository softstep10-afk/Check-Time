import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHECKOUT_LINK_WINDOW_MS,
  checkoutMediaWindowStartIso,
  selectLinkableMediaIds,
  validateClockOutEvent,
  type CandidateMediaRow,
  type ClockOutEventLite,
  type LinkableEventType,
} from "@/lib/checkout-link";

/**
 * Orchestration for /api/worker/link-checkout-video extracted into a
 * pure async function so the full happy path and every error branch
 * can be unit-tested without booting Next.js, mocking next/headers, or
 * standing up a real Supabase. The route itself becomes a thin shell
 * that does auth + body parsing + response shaping.
 *
 * The contract this function enforces is the security boundary of the
 * checkout-link feature:
 *
 *   • the time_event row must be a clock_out belonging to userId and
 *     within CHECKOUT_LINK_WINDOW_MS of `now` (seven days, so a
 *     forgotten multi-day shift can still be repaired from Journal);
 *   • proof media is filtered by uploaded_by, project, org,
 *     media_type=video, is_checkout=true, created_at >= start of today;
 *   • orphan proof rows are stamped when time_event_id IS NULL;
 *   • already-linked proof rows for the same event also count so a
 *     post-checkout Journal upload can clear video_status=pending;
 *   • the UPDATE re-asserts every predicate so a TOCTOU race or a
 *     malicious second writer cannot widen the blast radius;
 *   • only `time_event_id` is written — never storage_path, mime_type,
 *     metadata, caption, or any field that could mutate the original
 *     video;
 *   • a successful link writes one audit_log row; an audit-write
 *     failure is logged but never overrides the success of the link.
 */

export const LINK_CHECKOUT_AUDIT_ACTION = "checkout_video_linked";
export const LINK_CHECKIN_AUDIT_ACTION = "checkin_video_linked";

/**
 * Use the real SupabaseClient type so the route call site type-checks
 * directly against `await createClient()` / `createAdminClient()`. The
 * test suite passes a structural mock cast to LinkSupabaseClient at
 * the boundary.
 */
export type LinkSupabaseClient = SupabaseClient;

export interface LinkCheckoutVideoInput {
  /** auth.uid() of the caller — already extracted from the user-scoped client. */
  userId: string;
  /** Body-supplied clock_out event id to attach orphan media to. */
  timeEventId: string;
  /** User-scoped Supabase client (RLS) for the time_events read. */
  supabase: LinkSupabaseClient;
  /** Service-role admin client for the media UPDATE + audit insert. */
  admin: LinkSupabaseClient;
  /** Injectable clock so tests can assert the 24h window edges. */
  now?: number;
  /** Injectable today-window start so tests can drive boundaries. */
  windowStartIso?: string;
  /**
   * Optional. Defaults to "clock_out" so every existing call site keeps
   * its current behavior. Pass "clock_in" to plumb the same orchestration
   * for the start-of-shift "before work" video.
   */
  expectedEventType?: LinkableEventType;
  /**
   * Optional. Defaults to true (the historical checkout media flag).
   * Pass false for clock_in flows where the upload is_checkout=false —
   * a worker's pre-shift video is not a checkout proof.
   */
  isCheckoutMatch?: boolean;
  /**
   * Optional override for the audit_log action string. Defaults to
   * LINK_CHECKOUT_AUDIT_ACTION; the clock_in route passes
   * LINK_CHECKIN_AUDIT_ACTION so an auditor can trivially distinguish
   * the two surfaces in audit_log.
   */
  auditAction?: string;
}

export type LinkCheckoutVideoOutcome =
  | {
      ok: true;
      status: 200;
      body: { ok: true; linked: number; mediaIds: string[] };
    }
  | { ok: false; status: number; body: { error: string } };

export async function runLinkCheckoutVideo(
  input: LinkCheckoutVideoInput,
): Promise<LinkCheckoutVideoOutcome> {
  const {
    userId,
    timeEventId,
    supabase,
    admin,
    now = Date.now(),
    windowStartIso,
    expectedEventType = "clock_out",
    isCheckoutMatch = true,
    auditAction = LINK_CHECKOUT_AUDIT_ACTION,
  } = input;

  // Step 1 — read the time_event through the user-scoped client so RLS
  // is in front of the read. We re-check ownership in code anyway so a
  // future RLS regression cannot widen this surface.
  const eventResult = await supabase
    .from("time_events")
    .select("id, profile_id, project_id, org_id, event_type, event_time")
    .eq("id", timeEventId)
    .maybeSingle();

  if (eventResult.error) {
    return {
      ok: false,
      status: 500,
      body: { error: eventResult.error.message },
    };
  }

  const event = eventResult.data as ClockOutEventLite | null | undefined;
  const validation = validateClockOutEvent(event, userId, now, [expectedEventType]);
  if (!validation.ok) {
    return {
      ok: false,
      status: validation.status,
      body: { error: validation.error },
    };
  }
  // validateClockOutEvent guarantees event is non-null when ok=true.
  const safeEvent = event as ClockOutEventLite;
  const mediaWindowStartIso =
    windowStartIso ?? checkoutMediaWindowStartIso(safeEvent.event_time);

  // Step 2 — pull candidates through admin (so the read is consistent
  // with what we'll later UPDATE). Predicates here mirror the SELECT
  // policy a worker-safe RLS UPDATE would have to enforce, plus the
  // repair-window narrowing.
  const candidatesResult = await admin
    .from("media")
    .select(
      "id, uploaded_by, project_id, org_id, media_type, is_checkout, time_event_id, created_at",
    )
    .eq("uploaded_by", userId)
    .eq("project_id", safeEvent.project_id)
    .eq("org_id", safeEvent.org_id)
    .eq("media_type", "video")
    .eq("is_checkout", isCheckoutMatch)
    .gte("created_at", mediaWindowStartIso);

  if (candidatesResult.error) {
    return {
      ok: false,
      status: 500,
      body: { error: candidatesResult.error.message },
    };
  }

  const candidates = (candidatesResult.data ?? []) as CandidateMediaRow[];
  const ids = selectLinkableMediaIds(candidates, {
    callerProfileId: userId,
    projectId: safeEvent.project_id,
    orgId: safeEvent.org_id,
    windowStartIso: mediaWindowStartIso,
    isCheckoutMatch,
  });
  const alreadyLinkedIds = candidates
    .filter((row) => {
      if (row.uploaded_by !== userId) return false;
      if (row.project_id !== safeEvent.project_id) return false;
      if (row.org_id !== safeEvent.org_id) return false;
      if (row.media_type !== "video") return false;
      if (row.is_checkout !== isCheckoutMatch) return false;
      if (row.time_event_id !== safeEvent.id) return false;
      const createdMs = new Date(row.created_at).getTime();
      const windowStartMs = new Date(mediaWindowStartIso).getTime();
      if (!Number.isFinite(createdMs) || !Number.isFinite(windowStartMs)) return false;
      return createdMs >= windowStartMs;
    })
    .map((row) => row.id);

  if (ids.length === 0 && alreadyLinkedIds.length === 0) {
    return {
      ok: true,
      status: 200,
      body: { ok: true, linked: 0, mediaIds: [] },
    };
  }

  // Step 3 — narrow UPDATE. Every predicate is re-asserted so a
  // concurrent flip of time_event_id between the read and the write
  // produces zero rows rather than a double-stamp. Only time_event_id
  // is written; the original video file is never touched.
  let linkedIds: string[] = [];
  if (ids.length > 0) {
    const updateResult = await admin
      .from("media")
      .update({ time_event_id: safeEvent.id })
      .in("id", ids)
      .eq("uploaded_by", userId)
      .eq("project_id", safeEvent.project_id)
      .eq("org_id", safeEvent.org_id)
      .eq("media_type", "video")
      .eq("is_checkout", isCheckoutMatch)
      .is("time_event_id", null)
      .select("id");

    if (updateResult.error) {
      return {
        ok: false,
        status: 500,
        body: { error: updateResult.error.message },
      };
    }

    linkedIds = ((updateResult.data ?? []) as Array<{ id: string }>).map(
      (row) => row.id,
    );
  }
  const proofIds = Array.from(new Set([...linkedIds, ...alreadyLinkedIds]));

  // Step 3b — flip time_events.video_status from 'pending' to 'uploaded'
  // for the same event so the manager-side shift-review surface (which
  // reads video_status directly) reflects the just-linked checkout
  // video. Without this, "video_missing" stays stuck on the manager's
  // dashboard even though the audit chain is intact.
  //
  // Predicate-narrowed: the .eq("video_status", "pending") clause means
  // we never downgrade 'verified' (a manager already reviewed it) and
  // never overwrite 'not_required' (the worker didn't have to upload at
  // all). The .eq("profile_id", userId) is a defense-in-depth re-check
  // already enforced by validateClockOutEvent.
  //
  // Best-effort: a failed flip is logged but never demotes the link.
  // Skipped entirely when no proof media exists, because then there's
  // nothing for the manager to actually view yet.
  if (proofIds.length > 0) {
    try {
      const statusResult = await admin
        .from("time_events")
        .update({ video_status: "uploaded" })
        .eq("id", safeEvent.id)
        .eq("profile_id", userId)
        .eq("video_status", "pending");
      if (statusResult?.error) {
        console.warn(
          "[link-checkout-video] video_status flip failed:",
          statusResult.error.message,
        );
      }
    } catch (statusErr) {
      console.warn("[link-checkout-video] video_status flip threw:", statusErr);
    }
  }

  // Step 4 — audit. Best-effort: a failed audit insert never demotes a
  // successful link. We do the lookup + insert here (not in the route)
  // so route-level tests cover the audit shape too.
  try {
    const profileLookup = await admin
      .from("profiles")
      .select("name, role")
      .eq("id", userId)
      .maybeSingle();
    const actorName =
      (profileLookup.data as { name?: string } | null)?.name ?? "Worker";
    const actorRole =
      (profileLookup.data as { role?: string } | null)?.role ?? "worker";
    const auditResult = await admin.from("audit_log").insert({
      org_id: safeEvent.org_id,
      actor_id: userId,
      actor_name: actorName,
      actor_role: actorRole,
      action: auditAction,
      target_type: "time_event",
      target_id: safeEvent.id,
      before_data: null,
      after_data: {
        time_event_id: safeEvent.id,
        project_id: safeEvent.project_id,
        media_ids: proofIds,
        window_ms: CHECKOUT_LINK_WINDOW_MS,
        media_window_start: mediaWindowStartIso,
        event_type: expectedEventType,
      },
    });
    if (auditResult?.error) {
      console.warn(
        "[link-checkout-video] audit insert failed:",
        auditResult.error.message,
      );
    }
  } catch (auditErr) {
    console.warn("[link-checkout-video] audit insert threw:", auditErr);
  }

  return {
    ok: true,
    status: 200,
    body: { ok: true, linked: linkedIds.length, mediaIds: proofIds },
  };
}
