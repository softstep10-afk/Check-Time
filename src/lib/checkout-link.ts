/**
 * Pure helpers for the checkout-video → clock_out linking flow.
 *
 * Background: the worker's "before you leave" video is uploaded BEFORE
 * the clock_out time_events row exists, so it is inserted with
 * time_event_id = null. After clock_out succeeds, the row needs to be
 * stamped so the manager-side shift-review query can resolve checkout
 * proof through the time_event.
 *
 * The actual UPDATE cannot run from the worker's RLS-scoped Supabase
 * client because public.media has SELECT and INSERT policies but NO
 * worker-safe UPDATE policy — the write would silently affect zero rows.
 * The /api/worker/link-checkout-video route runs the update with the
 * service-role admin client, after re-validating that the requested
 * time_event belongs to the caller and is a recent clock_out.
 *
 * The helpers below contain the validation + candidate-selection logic
 * so it can be unit-tested without spinning up Supabase.
 */

export interface ClockOutEventLite {
  id: string;
  profile_id: string;
  project_id: string;
  org_id: string;
  event_type: string;
  event_time: string;
}

export interface CandidateMediaRow {
  id: string;
  uploaded_by: string;
  project_id: string;
  org_id: string;
  media_type: string;
  is_checkout: boolean;
  time_event_id: string | null;
  created_at: string;
}

export type ValidateResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * Window of acceptable skew between "now" (server clock when the route
 * fires) and the time_event's event_time. 24 hours is generous on
 * purpose: it covers a worker who clock_out's late at night and an
 * offline event drain that finally syncs the next morning, but rejects
 * an event from yesterday-the-week-before being weaponized to attach
 * fresh media to a long-closed shift.
 */
export const CHECKOUT_LINK_WINDOW_MS = 24 * 60 * 60 * 1000;

export function validateClockOutEvent(
  event: ClockOutEventLite | null | undefined,
  callerProfileId: string,
  nowMs: number = Date.now(),
): ValidateResult {
  if (!event) {
    return { ok: false, status: 404, error: "time_event not found" };
  }
  if (event.profile_id !== callerProfileId) {
    return { ok: false, status: 403, error: "Not your shift" };
  }
  if (event.event_type !== "clock_out") {
    return { ok: false, status: 400, error: "time_event is not a clock_out" };
  }
  const eventMs = new Date(event.event_time).getTime();
  if (!Number.isFinite(eventMs)) {
    return { ok: false, status: 400, error: "Invalid event_time" };
  }
  if (Math.abs(nowMs - eventMs) > CHECKOUT_LINK_WINDOW_MS) {
    return { ok: false, status: 400, error: "time_event outside 24h window" };
  }
  return { ok: true };
}

export interface SelectLinkableOpts {
  /** auth.uid() of the worker making the request. */
  callerProfileId: string;
  /** project_id of the validated clock_out event. */
  projectId: string;
  /** org_id of the validated clock_out event. */
  orgId: string;
  /** Lower bound on media.created_at — usually start of "today" in UTC. */
  windowStartIso: string;
}

/**
 * Filters a list of candidate media rows down to the ones that may be
 * linked to the clock_out event. Mirrors the predicates the SQL query
 * uses, so tests on these pure helpers verify the same constraints the
 * route applies.
 *
 *   • uploaded_by must match the caller — never link someone else's video.
 *   • project_id and org_id must match the clock_out event.
 *   • media_type must be video — checkout proof cannot be a photo/PDF row.
 *   • is_checkout must be true — journal/photo uploads are off-limits.
 *   • time_event_id must be null — never overwrite an existing link.
 *   • created_at must be inside the window — old orphans stay orphans.
 */
export function selectLinkableMediaIds(
  rows: CandidateMediaRow[],
  opts: SelectLinkableOpts,
): string[] {
  const windowStart = new Date(opts.windowStartIso).getTime();
  if (!Number.isFinite(windowStart)) return [];

  return rows
    .filter((r) => {
      if (r.uploaded_by !== opts.callerProfileId) return false;
      if (r.project_id !== opts.projectId) return false;
      if (r.org_id !== opts.orgId) return false;
      if (r.media_type !== "video") return false;
      if (r.is_checkout !== true) return false;
      if (r.time_event_id != null) return false;
      const createdMs = new Date(r.created_at).getTime();
      if (!Number.isFinite(createdMs)) return false;
      if (createdMs < windowStart) return false;
      return true;
    })
    .map((r) => r.id);
}

/**
 * Returns an ISO timestamp at the start of "today" for the host's wall
 * clock. Used by both the route and tests so the window boundary is
 * the same in both contexts.
 */
export function startOfTodayIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
