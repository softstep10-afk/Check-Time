import { describe, expect, it } from "vitest";
import {
  deriveWorkerHourBuckets,
  isPaidOrClosedAdjustment,
} from "@/lib/worker-hour-summary";

// Pinned wall clock so the bucket boundaries are deterministic in CI.
// Wednesday, 2026-04-08 14:00 local. The worker's "current week" is
// Mon 2026-04-06 → Sun 2026-04-12.
const NOW = new Date("2026-04-08T14:00:00.000Z");

function session(clockInTime: string, durationMinutes: number, clockOutTime: string | null = null) {
  return { clockInTime, durationMinutes, clockOutTime };
}

function adjustment(eventTime: string, minutes: number, reason: string, kind?: string) {
  return { eventTime, minutes, reason, kind: kind ?? null };
}

describe("isPaidOrClosedAdjustment", () => {
  it("recognises canonical kind = reset_to_zero", () => {
    expect(
      isPaidOrClosedAdjustment({
        eventTime: "2026-04-01T00:00:00Z",
        minutes: -60,
        reason: "x",
        kind: "reset_to_zero",
      }),
    ).toBe(true);
  });

  it("recognises the localised English reason text", () => {
    expect(
      isPaidOrClosedAdjustment({
        eventTime: "2026-04-01T00:00:00Z",
        minutes: -3014,
        reason: "Period closed, hours paid",
      }),
    ).toBe(true);
  });

  it("recognises the localised Russian reason text", () => {
    expect(
      isPaidOrClosedAdjustment({
        eventTime: "2026-04-01T00:00:00Z",
        minutes: -3014,
        reason: "Период закрыт, часы оплачены",
      }),
    ).toBe(true);
  });

  it("does NOT flag unrelated bonus / penalty notes", () => {
    expect(
      isPaidOrClosedAdjustment({
        eventTime: "2026-04-01T00:00:00Z",
        minutes: 60,
        reason: "Bonus for finishing the deck early",
      }),
    ).toBe(false);
  });
});

describe("deriveWorkerHourBuckets", () => {
  it("returns all-zero buckets when there are no sessions or adjustments", () => {
    const result = deriveWorkerHourBuckets({
      sessions: [],
      adjustments: [],
      now: NOW,
    });
    expect(result.todayMinutes).toBe(0);
    expect(result.yesterdayMinutes).toBe(0);
    expect(result.currentWeekMinutes).toBe(0);
    expect(result.previousWeekMinutes).toBe(0);
    expect(result.currentMonthMinutes).toBe(0);
    expect(result.totalWorkedMinutes).toBe(0);
    expect(result.paidOrClosedMinutes).toBe(0);
    expect(result.unpaidMinutes).toBe(0);
  });

  it("buckets sessions into today / yesterday / current week / previous week / month", () => {
    const sessions = [
      // Today 2026-04-08
      session("2026-04-08T08:00:00.000Z", 240),
      // Yesterday 2026-04-07
      session("2026-04-07T07:00:00.000Z", 480),
      // Earlier this week 2026-04-06 (Monday)
      session("2026-04-06T07:00:00.000Z", 360),
      // Previous week 2026-04-02 (Thursday)
      session("2026-04-02T07:00:00.000Z", 480),
      // Earlier in current month 2026-04-01
      session("2026-04-01T07:00:00.000Z", 480),
      // Last month 2026-03-15
      session("2026-03-15T07:00:00.000Z", 600),
    ];
    const result = deriveWorkerHourBuckets({
      sessions,
      adjustments: [],
      now: NOW,
    });
    expect(result.todayMinutes).toBe(240);
    expect(result.yesterdayMinutes).toBe(480);
    // current week = today (240) + yesterday (480) + monday (360) = 1080
    expect(result.currentWeekMinutes).toBe(1080);
    // previous week = thursday 4-02 (480) + 4-01 wednesday (480) = 960
    expect(result.previousWeekMinutes).toBe(960);
    // april sessions only (excludes 2026-03-15)
    expect(result.currentMonthMinutes).toBe(240 + 480 + 360 + 480 + 480);
    expect(result.totalWorkedMinutes).toBe(240 + 480 + 360 + 480 + 480 + 600);
  });

  it("subtracts paid/closed adjustments from total to compute unpaid", () => {
    // Vasya regression scenario: 3000 minutes worked, a -3000 minute
    // reset_to_zero adjustment marked the period as paid. UI must show
    // worked=3000, paid/closed=3000, unpaid=0 — not "data missing".
    const result = deriveWorkerHourBuckets({
      sessions: [session("2026-03-15T07:00:00.000Z", 3000)],
      adjustments: [
        adjustment("2026-04-01T00:00:00Z", -3000, "Period closed, hours paid", "reset_to_zero"),
      ],
      now: NOW,
    });
    expect(result.totalWorkedMinutes).toBe(3000);
    expect(result.paidOrClosedMinutes).toBe(3000);
    expect(result.unpaidMinutes).toBe(0);
    expect(result.adjustmentsTotalMinutes).toBe(-3000);
  });

  it("clamps unpaid at 0 when adjustments exceed worked hours", () => {
    const result = deriveWorkerHourBuckets({
      sessions: [session("2026-03-15T07:00:00.000Z", 1200)],
      adjustments: [
        adjustment("2026-04-01T00:00:00Z", -2400, "Period closed, hours paid", "reset_to_zero"),
      ],
      now: NOW,
    });
    expect(result.unpaidMinutes).toBe(0);
  });

  it("does not roll non-reset adjustments into the paid/closed bucket", () => {
    const result = deriveWorkerHourBuckets({
      sessions: [session("2026-04-08T08:00:00.000Z", 240)],
      adjustments: [adjustment("2026-04-08T09:00:00Z", 30, "Bonus")],
      now: NOW,
    });
    expect(result.paidOrClosedMinutes).toBe(0);
    expect(result.adjustmentsTotalMinutes).toBe(30);
    expect(result.unpaidMinutes).toBe(240);
  });

  it("treats Sunday as the last day of the current week, not the next one", () => {
    // Sunday 2026-04-12 14:00 — the active week is still Mon 2026-04-06 → Sun 2026-04-12.
    const sundayNow = new Date("2026-04-12T14:00:00.000Z");
    const sessions = [
      session("2026-04-06T07:00:00.000Z", 480), // Monday — same week as Sunday
      session("2026-04-05T07:00:00.000Z", 480), // Previous Sunday — last week
    ];
    const result = deriveWorkerHourBuckets({
      sessions,
      adjustments: [],
      now: sundayNow,
    });
    expect(result.currentWeekMinutes).toBe(480);
    expect(result.previousWeekMinutes).toBe(480);
  });
});
