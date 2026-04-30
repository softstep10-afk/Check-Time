/**
 * GPS freshness — how recently a clocked-in worker's device pinged its
 * location to public.worker_live_locations.
 *
 * The worker side throttles `watchPosition` to one row every 20s
 * (src/lib/hooks/useGpsTracking.ts:5 — THROTTLE_MS). So in steady state
 * we expect a ping at least every ~20-40s while the app is foregrounded
 * and the worker has consented to GPS. Longer gaps usually mean either:
 *   a) the worker backgrounded / closed the app
 *   b) the device lost GPS / network
 *   c) consent was revoked mid-shift
 * From the manager's perspective these are indistinguishable, so the
 * status set is intentionally about *what the manager should do* rather
 * than *why GPS stopped*.
 */

export type GpsFreshnessStatus =
  | "fresh"          // <2 min — actively pinging
  | "delayed"        // 2-5 min — brief gap, probably fine
  | "stale"          // 5-15 min — worth a check
  | "lost"           // >15 min — app likely closed / GPS off
  | "needs_review"   // shift older than 12h AND lost — flag for manager
  | "no_signal";     // no row in worker_live_locations at all (consent off, etc.)

export const GPS_FRESHNESS_COLOR: Record<GpsFreshnessStatus, string> = {
  fresh: "var(--green)",
  delayed: "#f59e0b",
  stale: "#fb923c",
  lost: "var(--red)",
  needs_review: "var(--red)",
  no_signal: "var(--text-muted)",
};

const FRESH_LIMIT_MS = 2 * 60 * 1000;     //  2m
const DELAYED_LIMIT_MS = 5 * 60 * 1000;   //  5m
const STALE_LIMIT_MS = 15 * 60 * 1000;    // 15m
const NEEDS_REVIEW_SHIFT_MS = 12 * 60 * 60 * 1000; // 12h

export interface GpsFreshness {
  status: GpsFreshnessStatus;
  /** Milliseconds since the most recent worker_live_locations ping, or null. */
  ageMs: number | null;
  /** ISO timestamp of the most recent ping, or null. */
  lastUpdateAt: string | null;
}

export function deriveGpsFreshness(args: {
  /** ISO timestamp of the most recent worker_live_locations row. */
  lastUpdateAt: string | null;
  /** ISO timestamp of the open clock_in event for this shift. */
  shiftStartAt: string | null;
  /** Defaults to Date.now(). Pass to make tests deterministic. */
  now?: Date;
}): GpsFreshness {
  const now = (args.now ?? new Date()).getTime();

  if (!args.lastUpdateAt) {
    return { status: "no_signal", ageMs: null, lastUpdateAt: null };
  }

  const lastMs = new Date(args.lastUpdateAt).getTime();
  if (!Number.isFinite(lastMs)) {
    return { status: "no_signal", ageMs: null, lastUpdateAt: null };
  }

  const ageMs = Math.max(0, now - lastMs);

  let status: GpsFreshnessStatus;
  if (ageMs < FRESH_LIMIT_MS) status = "fresh";
  else if (ageMs < DELAYED_LIMIT_MS) status = "delayed";
  else if (ageMs < STALE_LIMIT_MS) status = "stale";
  else status = "lost";

  // Promote `lost` to `needs_review` for long-running open shifts so the
  // manager has an explicit "go check on this person" signal.
  if (status === "lost" && args.shiftStartAt) {
    const shiftMs = new Date(args.shiftStartAt).getTime();
    if (Number.isFinite(shiftMs) && now - shiftMs > NEEDS_REVIEW_SHIFT_MS) {
      status = "needs_review";
    }
  }

  return { status, ageMs, lastUpdateAt: args.lastUpdateAt };
}

/**
 * Compact human label like "1m ago", "12m ago", "3h ago", "—".
 * Manager surfaces show this next to the status badge.
 */
export function formatGpsAge(ageMs: number | null): string {
  if (ageMs === null) return "—";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
