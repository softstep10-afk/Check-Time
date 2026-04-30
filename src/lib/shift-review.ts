/**
 * Shift review status — a single, prioritized "is this active shift suspicious?"
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

/**
 * Active shift becomes "long" at 12h. The Phase-1 product brief calls
 * anything over a normal workday a hint to follow up; 12h is the same
 * threshold gps-freshness already uses to promote `lost` to `needs_review`,
 * so the two signals stay aligned.
 */
export const LONG_SHIFT_MINUTES = 12 * 60;

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
    // Closed sessions: only flag if the worker should have uploaded a
    // checkout video and didn't. Other historical anomalies (very long
    // duration that was actually worked, GPS lost mid-shift but recovered,
    // etc.) are not surfaced for closed shifts to avoid noise.
    if (args.requireVideo && args.videoStatus === "pending") {
      reasons.push("video_missing");
    }
  }

  const has = (r: ShiftReviewStatus) => reasons.includes(r);

  let status: ShiftReviewStatus;
  if (has("long_shift") && (has("gps_lost") || has("no_gps"))) {
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
