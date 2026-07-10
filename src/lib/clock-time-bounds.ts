// Step 3 — server-side eventTime bounds for worker clock-in / clock-out
// (external-audit HIGH-D #5). safeIso only validates that a timestamp parses,
// not that it is sane. Without bounds the official routes accept backdated,
// future, or arbitrarily-long shifts straight into time_events (payroll).
//
// Pure + testable: no I/O, no Date.now(). The routes pass epoch ms; on a
// violation they reject with 422 (never silently clamp) so a real problem
// surfaces.

/** Clock-skew tolerance: an event may be at most this far in the FUTURE. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** ONLINE freshness: a live (non-queued) event may be at most this far in the past. */
export const ONLINE_MAX_AGE_MS = 5 * 60 * 1000;
/** OFFLINE replay: a queued event may be at most this far in the past. */
export const OFFLINE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Maximum shift length (clock-out only). */
export const MAX_SHIFT_MS = 24 * 60 * 60 * 1000;

export type ClockTimeRejectReason =
  | "future"
  | "stale_online"
  | "stale_offline"
  | "max_shift"
  | "not_after_clock_in";

export type ClockTimeCheck = { ok: true } | { ok: false; reason: ClockTimeRejectReason };

const REJECTION_MESSAGE: Record<ClockTimeRejectReason, string> = {
  future: "Clock time cannot be in the future.",
  stale_online: "Clock time is too far in the past. Try again.",
  stale_offline: "This offline entry is too old to sync.",
  max_shift: "Shift exceeds the 24-hour maximum.",
  not_after_clock_in: "Clock-out must be after clock-in.",
};

/** Safe, fixed client message for a rejection reason (no sensitive data). */
export function clockTimeRejectionMessage(reason: ClockTimeRejectReason): string {
  return REJECTION_MESSAGE[reason];
}

/**
 * Bounds for a single clock event's requested time:
 *  - NOT-FUTURE: reject later than now + FUTURE_TOLERANCE_MS (both directions).
 *  - ONLINE FRESHNESS: when not queued, reject older than ONLINE_MAX_AGE_MS.
 *  - OFFLINE REPLAY: when queued, reject older than OFFLINE_MAX_AGE_MS.
 */
export function checkClockEventTime(params: {
  eventTimeMs: number;
  nowMs: number;
  offlineQueued: boolean;
}): ClockTimeCheck {
  const { eventTimeMs, nowMs, offlineQueued } = params;

  if (eventTimeMs > nowMs + FUTURE_TOLERANCE_MS) return { ok: false, reason: "future" };

  if (offlineQueued) {
    if (eventTimeMs < nowMs - OFFLINE_MAX_AGE_MS) return { ok: false, reason: "stale_offline" };
  } else if (eventTimeMs < nowMs - ONLINE_MAX_AGE_MS) {
    return { ok: false, reason: "stale_online" };
  }

  return { ok: true };
}

/**
 * Clock-out-only checks against the matching clock_in, run on the FINAL
 * event time (after any fallback-to-now):
 *  - MAX SHIFT: reject if clockOut − clockIn > MAX_SHIFT_MS.
 *  - re-assert clockOut > clockIn and not-future.
 */
export function checkClockOutAgainstClockIn(params: {
  clockOutMs: number;
  clockInMs: number;
  nowMs: number;
}): ClockTimeCheck {
  const { clockOutMs, clockInMs, nowMs } = params;

  if (clockOutMs - clockInMs > MAX_SHIFT_MS) return { ok: false, reason: "max_shift" };
  if (!(clockOutMs > clockInMs)) return { ok: false, reason: "not_after_clock_in" };
  if (clockOutMs > nowMs + FUTURE_TOLERANCE_MS) return { ok: false, reason: "future" };

  return { ok: true };
}
