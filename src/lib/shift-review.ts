/**
 * Shift review status — a single, prioritized "is this shift suspicious?"
 * verdict for the manager-facing surfaces (Overview, Project Detail, Team
 * Member Page).
 *
 * The derivation is read-only: it consumes existing session, GPS freshness,
 * and time_event/video_status data and produces a status + reasons array.
 * It does NOT write to the DB, change paid hours, auto-close shifts, or
 * synthesize fake checkout events. The intent is purely UI clarity so a
 * worker who clocked in, left site, and forgot to clock out is no longer
 * indistinguishable from someone actively on shift.
 *
 * Status priority (highest first):
 *   needs_review > video_missing > gps_lost > no_gps > gps_stale > long_shift > normal
 *
 * `needs_review` is a composite: a long-running open shift AND lost/missing
 * GPS. That combination is the strongest "go check on this person" signal.
 * Closed shifts can still be actionable when their source facts are not
 * payroll-safe, such as a missing checkout video or a 12h+ duration.
 */
import type { GpsFreshness } from "@/lib/gps-freshness";

export type ShiftReviewStatus =
  | "normal"
  | "long_shift"
  | "gps_stale"
  | "gps_lost"
  | "no_gps"
  | "needs_review"
  | "video_missing";

export type ShiftReviewReason = ShiftReviewStatus;

export interface ShiftReview {
  status: ShiftReviewStatus;
  reasons: ShiftReviewReason[];
  durationMinutes: number;
  isOpen: boolean;
}

export interface ShiftReviewAck {
  status: ShiftReviewStatus;
  reviewedAt: string;
  reviewedBy: string | null;
  reviewedEventId: string | null;
}

export function getShiftReviewAck(metadata: unknown): ShiftReviewAck | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).shift_review_ack;
  if (!raw || typeof raw !== "object") return null;
  const ack = raw as Record<string, unknown>;
  const status = typeof ack.status === "string" ? ack.status : "";
  const reviewedAt = typeof ack.reviewed_at === "string" ? ack.reviewed_at : "";
  if (!reviewedAt) return null;
  return {
    status: (status || "normal") as ShiftReviewStatus,
    reviewedAt,
    reviewedBy: typeof ack.reviewed_by === "string" ? ack.reviewed_by : null,
    reviewedEventId: typeof ack.reviewed_event_id === "string" ? ack.reviewed_event_id : null,
  };
}

export function isShiftReviewAcknowledged(metadata: unknown): boolean {
  return getShiftReviewAck(metadata) !== null;
}

export function buildShiftReviewAckEventIds(
  events: Array<{ event_type: string; metadata: unknown }>,
): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.event_type !== "adjust") continue;
    const ack = getShiftReviewAck(event.metadata);
    if (ack?.reviewedEventId) ids.add(ack.reviewedEventId);
  }
  return ids;
}

/**
 * Active shift becomes "long" at 12h. The Phase-1 product brief calls
 * anything over a normal workday a hint to follow up; 12h is the same
 * threshold gps-freshness already uses to promote `lost` to `needs_review`,
 * so the two signals stay aligned.
 */
export const LONG_SHIFT_MINUTES = 12 * 60;

/**
 * Visual closed-shift warning threshold (16h). Closed shifts at or above
 * this length are highlighted amber in manager review surfaces — long
 * enough to plausibly be a forgotten checkout but not yet automatic
 * "needs_review" red. LONG_SHIFT_MINUTES (12h) is intentionally lower
 * because that one is coupled to gps-freshness in the open-shift
 * promotion logic; this constant is purely for closed-shift display.
 */
export const WARN_SHIFT_MINUTES = 16 * 60;

/**
 * Beyond 24h a shift is no longer "someone worked overtime" — it's
 * almost certainly a forgotten clock-out, a corrupted clock_out event,
 * or a real incident the owner has to look at by hand. We promote
 * those to `needs_review` so the Overview chip turns red and they
 * sort to the top of the closed-shift alerts. The amber `long_shift`
 * still exists for the 12–24h window where overtime is plausible but
 * worth a glance.
 */
export const EXTREME_SHIFT_MINUTES = 24 * 60;

export type ShiftSeverity = "ok" | "warning" | "critical";

/**
 * Visual severity for a closed shift's duration. Used by the Overview
 * closed-shift alerts band and the Team Member shift list to color-code
 * rows without going through the full deriveShiftReview composite. Per
 * the manager visibility spec:
 *   > 24h         → critical (red)
 *   > 16h, ≤ 24h  → warning  (amber)
 *   otherwise     → ok       (no escalation)
 */
export function shiftDurationSeverity(durationMinutes: number): ShiftSeverity {
  if (durationMinutes >= EXTREME_SHIFT_MINUTES) return "critical";
  if (durationMinutes >= WARN_SHIFT_MINUTES) return "warning";
  return "ok";
}

export function deriveShiftReview(args: {
  isOpen: boolean;
  durationMinutes: number;
  /** True if the original clock_in event recorded a gps_point. */
  hadGpsAtClockIn: boolean;
  /** GPS freshness object from deriveGpsFreshness. Only used while open. */
  gpsFreshness: GpsFreshness | null;
  /** profiles.require_video for this worker. */
  requireVideo: boolean;
  /** time_events.video_status from the closing clock_out / auto_out event. */
  videoStatus: "not_required" | "pending" | "uploaded" | "verified";
}): ShiftReview {
  const reasons: ShiftReviewReason[] = [];

  if (args.isOpen) {
    // GPS picture — pick at most one GPS-related reason.
    if (!args.hadGpsAtClockIn) {
      reasons.push("no_gps");
    } else {
      const status = args.gpsFreshness?.status;
      if (status === "lost" || status === "needs_review" || status === "no_signal") {
        // `no_signal` while the original event had a gps_point means we lost
        // touch — treat as lost rather than no_gps so the manager sees it
        // as "device went dark" not "consent was off."
        reasons.push("gps_lost");
      } else if (status === "stale") {
        reasons.push("gps_stale");
      }
    }

    if (args.durationMinutes >= LONG_SHIFT_MINUTES) {
      reasons.push("long_shift");
    }
  } else {
    // Closed sessions still feed payroll. Surface the facts that require
    // manager review before pay: missing GPS at clock-in, missing checkout
    // proof, and unusually long duration. GPS freshness is intentionally
    // active-only because live GPS pings stop after checkout.
    if (!args.hadGpsAtClockIn) {
      reasons.push("no_gps");
    }
    if (args.requireVideo && args.videoStatus === "pending") {
      reasons.push("video_missing");
    }
    if (args.durationMinutes >= WARN_SHIFT_MINUTES) {
      reasons.push("long_shift");
    }
  }

  const has = (r: ShiftReviewStatus) => reasons.includes(r);

  // Extreme-duration shifts (>=24h) are escalated to `needs_review`
  // regardless of GPS / video reasons because at that point the duration
  // alone is the dominant problem — e.g. a 144h "shift" caused by a
  // forgotten clock-out. The reasons array still carries `long_shift`
  // (and any other facts) so the per-shift tooltip stays informative.
  const isExtreme = args.durationMinutes >= EXTREME_SHIFT_MINUTES;

  let status: ShiftReviewStatus;
  if (isExtreme) {
    status = "needs_review";
  } else if (has("long_shift") && (has("gps_lost") || has("no_gps"))) {
    status = "needs_review";
  } else if (has("video_missing")) {
    status = "video_missing";
  } else if (has("gps_lost")) {
    status = "gps_lost";
  } else if (has("no_gps")) {
    status = "no_gps";
  } else if (has("gps_stale")) {
    status = "gps_stale";
  } else if (has("long_shift")) {
    status = "long_shift";
  } else {
    status = "normal";
  }

  return {
    status,
    reasons,
    durationMinutes: args.durationMinutes,
    isOpen: args.isOpen,
  };
}

export const SHIFT_REVIEW_COLOR: Record<ShiftReviewStatus, string> = {
  normal: "var(--green)",
  long_shift: "#f59e0b",
  gps_stale: "#fb923c",
  gps_lost: "var(--red)",
  no_gps: "var(--text-muted)",
  needs_review: "var(--red)",
  video_missing: "#fb923c",
};

/** True if the manager should be visually alerted to this shift. */
export function isShiftActionable(review: ShiftReview): boolean {
  return review.status !== "normal";
}
