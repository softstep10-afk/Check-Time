import { describe, expect, it } from "vitest";
import {
  EXTREME_SHIFT_MINUTES,
  WARN_SHIFT_MINUTES,
  deriveShiftReview,
  buildShiftReviewAckByEventId,
  buildShiftReviewAckEventIds,
  getShiftReviewAck,
  isShiftActionable,
  isShiftReviewRiskActive,
  shiftDurationSeverity,
} from "@/lib/shift-review";
import type { GpsFreshness } from "@/lib/gps-freshness";

function fresh(status: GpsFreshness["status"]): GpsFreshness {
  return {
    status,
    ageMs: status === "fresh" ? 30_000 : status === "delayed" ? 3 * 60_000 : 60 * 60_000,
    lastUpdateAt: status === "no_signal" ? null : "2026-04-29T11:00:00Z",
  };
}

describe("deriveShiftReview — open shifts", () => {
  it("returns normal for a short shift with fresh GPS", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("fresh"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("normal");
    expect(r.reasons).toEqual([]);
  });

  it("flags gps_stale when freshness is stale and shift is short", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 120,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("stale"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("gps_stale");
  });

  it("flags gps_lost when freshness is lost and shift is short", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 4 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("lost"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("gps_lost");
  });

  it("flags no_gps when the clock_in event had no gps_point", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 4 * 60,
      hadGpsAtClockIn: false,
      gpsFreshness: fresh("no_signal"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("no_gps");
    expect(r.reasons).toContain("no_gps");
  });

  it("does not flag no_gps on driver time projects where GPS is not required", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 4 * 60,
      hadGpsAtClockIn: false,
      gpsWarningSuppressed: true,
      gpsFreshness: fresh("no_signal"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("normal");
    expect(r.reasons).not.toContain("no_gps");
  });

  it("treats freshness=no_signal with prior GPS as gps_lost", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("no_signal"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("gps_lost");
  });

  it("flags long_shift after 12h with fresh GPS", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 13 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("fresh"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("long_shift");
  });

  it("does not flag long_shift before 12h", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 11 * 60 + 59,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("fresh"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("normal");
  });

  it("promotes long_shift + gps_lost to needs_review", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 13 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("lost"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toContain("gps_lost");
    expect(r.reasons).toContain("long_shift");
  });

  it("promotes long_shift + no_gps to needs_review", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 14 * 60,
      hadGpsAtClockIn: false,
      gpsFreshness: fresh("no_signal"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("needs_review");
  });

  it("still flags long open driver time shifts without showing no_gps", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 14 * 60,
      hadGpsAtClockIn: false,
      gpsWarningSuppressed: true,
      gpsFreshness: fresh("no_signal"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("long_shift");
    expect(r.reasons).toEqual(["long_shift"]);
  });

  it("does not promote long_shift + gps_stale to needs_review", () => {
    const r = deriveShiftReview({
      isOpen: true,
      durationMinutes: 13 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: fresh("stale"),
      requireVideo: false,
      videoStatus: "not_required",
    });
    // gps_stale is a softer signal — long_shift wins on its own (not needs_review)
    // and reasons still list both.
    expect(r.status).toBe("gps_stale");
    expect(r.reasons).toContain("long_shift");
  });
});

describe("deriveShiftReview — closed shifts", () => {
  it("returns normal for a clean closed shift", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 8 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: true,
      videoStatus: "uploaded",
    });
    expect(r.status).toBe("normal");
  });

  it("flags video_missing when require_video is true and video_status pending", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 8 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: true,
      videoStatus: "pending",
    });
    expect(r.status).toBe("video_missing");
  });

  it("does not flag video_missing when require_video is false", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 8 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "pending",
    });
    expect(r.status).toBe("normal");
  });

  it("flags closed long shifts because payroll needs review before pay", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 18 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("long_shift");
    expect(r.reasons).toContain("long_shift");
  });

  it("flags closed no-GPS shifts because payroll needs review before pay", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 4 * 60,
      hadGpsAtClockIn: false,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("no_gps");
    expect(r.reasons).toContain("no_gps");
  });

  it("does not flag closed driver time shifts only because GPS was intentionally unavailable", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 4 * 60,
      hadGpsAtClockIn: false,
      gpsWarningSuppressed: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("normal");
    expect(r.reasons).not.toContain("no_gps");
  });

  it("promotes closed no-GPS long shifts to needs_review", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 18 * 60,
      hadGpsAtClockIn: false,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toContain("no_gps");
    expect(r.reasons).toContain("long_shift");
  });

  it("keeps video_missing as the top closed-shift status while preserving long_shift as a reason", () => {
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 18 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: true,
      videoStatus: "pending",
    });
    expect(r.status).toBe("video_missing");
    expect(r.reasons).toContain("video_missing");
    expect(r.reasons).toContain("long_shift");
  });

  it("promotes a closed extreme shift (>=24h) to needs_review even with no other reasons", () => {
    // The Vasiliy / Dom / 144h regression: a closed shift this long is
    // indistinguishable from a forgotten clock-out and must surface in
    // the Overview's red alerts band — not just appear quietly in the
    // worker profile.
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 144 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toContain("long_shift");
  });

  it("also promotes a closed extreme shift when checkout video is missing", () => {
    // video_missing alone normally wins over long_shift, but at extreme
    // duration the duration is the dominant problem and the row should
    // render red, not amber.
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: 30 * 60,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: true,
      videoStatus: "pending",
    });
    expect(r.status).toBe("needs_review");
    expect(r.reasons).toContain("video_missing");
    expect(r.reasons).toContain("long_shift");
  });

  it("keeps amber long_shift between 16h and the extreme threshold", () => {
    // Just below the extreme cutoff: still long_shift, NOT needs_review.
    const r = deriveShiftReview({
      isOpen: false,
      durationMinutes: EXTREME_SHIFT_MINUTES - 1,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    expect(r.status).toBe("long_shift");
  });
});

describe("shiftDurationSeverity", () => {
  // Visual severity bands for closed shifts per the manager visibility
  // spec: warning > 16h, critical > 24h. Below 16h is "ok" (no chip).
  it("returns ok for short shifts", () => {
    expect(shiftDurationSeverity(8 * 60)).toBe("ok");
    expect(shiftDurationSeverity(WARN_SHIFT_MINUTES - 1)).toBe("ok");
  });
  it("returns warning at the 16h threshold and below 24h", () => {
    expect(shiftDurationSeverity(WARN_SHIFT_MINUTES)).toBe("warning");
    expect(shiftDurationSeverity(20 * 60)).toBe("warning");
    expect(shiftDurationSeverity(EXTREME_SHIFT_MINUTES - 1)).toBe("warning");
  });
  it("returns critical at and beyond 24h", () => {
    expect(shiftDurationSeverity(EXTREME_SHIFT_MINUTES)).toBe("critical");
    // Vasia's 144h shift — must be critical, not warning.
    expect(shiftDurationSeverity(144 * 60)).toBe("critical");
  });
});

describe("isShiftActionable", () => {
  it("is false for normal shifts", () => {
    expect(
      isShiftActionable({
        status: "normal",
        reasons: [],
        durationMinutes: 60,
        isOpen: true,
      }),
    ).toBe(false);
  });

  it("is true for any non-normal status", () => {
    for (const status of [
      "long_shift",
      "gps_stale",
      "gps_lost",
      "no_gps",
      "needs_review",
      "video_missing",
    ] as const) {
      expect(
        isShiftActionable({ status, reasons: [status], durationMinutes: 0, isOpen: true }),
      ).toBe(true);
    }
  });
});

describe("shift review acknowledgement metadata", () => {
  it("reads append-only acknowledgement metadata", () => {
    expect(
      getShiftReviewAck({
        shift_review_ack: {
          status: "needs_review",
          reviewed_event_id: "clock-out-1",
          reviewed_at: "2026-05-13T10:00:00Z",
          reviewed_by: "manager-1",
        },
      }),
    ).toEqual({
      status: "needs_review",
      reviewedEventId: "clock-out-1",
      reviewedAt: "2026-05-13T10:00:00Z",
      reviewedBy: "manager-1",
      reviewed: true,
    });
  });

  it("builds a set of reviewed clock-out event ids from adjust events only", () => {
    const ids = buildShiftReviewAckEventIds([
      {
        event_type: "clock_out",
        metadata: {
          shift_review_ack: {
            reviewed_event_id: "should-not-count",
            reviewed_at: "2026-05-13T10:00:00Z",
          },
        },
      },
      {
        event_type: "adjust",
        metadata: {
          shift_review_ack: {
            status: "long_shift",
            reviewed_event_id: "clock-out-2",
            reviewed_at: "2026-05-13T10:05:00Z",
            reviewed_by: "manager-1",
          },
        },
      },
    ]);

    expect([...ids]).toEqual(["clock-out-2"]);
  });

  it("uses the latest append-only review state for reviewed event ids", () => {
    const events = [
      {
        event_type: "adjust",
        event_time: "2026-05-13T10:00:00Z",
        metadata: {
          shift_review_ack: {
            status: "long_shift",
            reviewed_event_id: "clock-out-3",
            reviewed_at: "2026-05-13T10:00:00Z",
            reviewed_by: "manager-1",
            reviewed: true,
            review_state: "reviewed",
          },
        },
      },
      {
        event_type: "adjust",
        event_time: "2026-05-13T10:15:00Z",
        metadata: {
          shift_review_ack: {
            status: "long_shift",
            reviewed_event_id: "clock-out-3",
            reviewed_at: "2026-05-13T10:15:00Z",
            reviewed_by: "manager-1",
            reviewed: false,
            review_state: "needs_review",
          },
        },
      },
    ];

    const ackById = buildShiftReviewAckByEventId(events);

    expect(ackById.get("clock-out-3")?.reviewed).toBe(false);
    expect(buildShiftReviewAckEventIds(events).has("clock-out-3")).toBe(false);
  });

  it("keeps an unreviewed suspicious closed shift in the active risk queue", () => {
    const review = deriveShiftReview({
      isOpen: false,
      durationMinutes: EXTREME_SHIFT_MINUTES + 30,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });

    expect(review.status).toBe("needs_review");
    expect(isShiftReviewRiskActive(review, null)).toBe(true);
  });

  it("removes a reviewed suspicious closed shift from the active risk queue", () => {
    const review = deriveShiftReview({
      isOpen: false,
      durationMinutes: EXTREME_SHIFT_MINUTES + 30,
      hadGpsAtClockIn: true,
      gpsFreshness: null,
      requireVideo: false,
      videoStatus: "not_required",
    });
    const ack = getShiftReviewAck({
      shift_review_ack: {
        status: "needs_review",
        reviewed_event_id: "clock-out-4",
        reviewed_at: "2026-05-13T10:00:00Z",
        reviewed_by: "manager-1",
        reviewed: true,
        review_state: "reviewed",
      },
    });

    expect(review.status).toBe("needs_review");
    expect(isShiftReviewRiskActive(review, ack)).toBe(false);
  });
});
