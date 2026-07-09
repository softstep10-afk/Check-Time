import { describe, expect, it } from "vitest";
import {
  FUTURE_TOLERANCE_MS,
  ONLINE_MAX_AGE_MS,
  OFFLINE_MAX_AGE_MS,
  MAX_SHIFT_MS,
  checkClockEventTime,
  checkClockOutAgainstClockIn,
  clockTimeRejectionMessage,
} from "@/lib/clock-time-bounds";

const NOW = 1_700_000_000_000; // fixed epoch ms

describe("checkClockEventTime — not-future (both online and offline)", () => {
  it("accepts exactly at the future tolerance boundary", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW + FUTURE_TOLERANCE_MS, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: true });
  });
  it("rejects one ms past the future tolerance", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW + FUTURE_TOLERANCE_MS + 1, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: false, reason: "future" });
    // future wins even for a queued event
    expect(checkClockEventTime({ eventTimeMs: NOW + FUTURE_TOLERANCE_MS + 1, nowMs: NOW, offlineQueued: true }))
      .toEqual({ ok: false, reason: "future" });
  });
});

describe("checkClockEventTime — online freshness", () => {
  it("accepts exactly at the online age boundary", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW - ONLINE_MAX_AGE_MS, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: true });
  });
  it("rejects older than the online window", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW - ONLINE_MAX_AGE_MS - 1, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: false, reason: "stale_online" });
  });
  it("a now-ish event is accepted", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW - 1000, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: true });
  });
});

describe("checkClockEventTime — offline replay window", () => {
  it("accepts an event up to 12h old when queued", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW - OFFLINE_MAX_AGE_MS, nowMs: NOW, offlineQueued: true }))
      .toEqual({ ok: true });
  });
  it("rejects older than 12h when queued", () => {
    expect(checkClockEventTime({ eventTimeMs: NOW - OFFLINE_MAX_AGE_MS - 1, nowMs: NOW, offlineQueued: true }))
      .toEqual({ ok: false, reason: "stale_offline" });
  });
  it("the same 2h-old event is stale ONLINE but fine OFFLINE", () => {
    const twoHoursOld = NOW - 2 * 60 * 60 * 1000;
    expect(checkClockEventTime({ eventTimeMs: twoHoursOld, nowMs: NOW, offlineQueued: false }))
      .toEqual({ ok: false, reason: "stale_online" });
    expect(checkClockEventTime({ eventTimeMs: twoHoursOld, nowMs: NOW, offlineQueued: true }))
      .toEqual({ ok: true });
  });
});

describe("checkClockOutAgainstClockIn — max shift + re-assert", () => {
  const clockIn = NOW - 8 * 60 * 60 * 1000; // 8h ago

  it("accepts a normal shift within 24h", () => {
    expect(checkClockOutAgainstClockIn({ clockOutMs: NOW, clockInMs: clockIn, nowMs: NOW }))
      .toEqual({ ok: true });
  });
  it("accepts exactly at the 24h boundary", () => {
    const cin = NOW - MAX_SHIFT_MS;
    expect(checkClockOutAgainstClockIn({ clockOutMs: NOW, clockInMs: cin, nowMs: NOW }))
      .toEqual({ ok: true });
  });
  it("rejects a shift longer than 24h", () => {
    const cin = NOW - MAX_SHIFT_MS - 1;
    expect(checkClockOutAgainstClockIn({ clockOutMs: NOW, clockInMs: cin, nowMs: NOW }))
      .toEqual({ ok: false, reason: "max_shift" });
  });
  it("rejects a clock-out at or before the clock-in", () => {
    expect(checkClockOutAgainstClockIn({ clockOutMs: clockIn, clockInMs: clockIn, nowMs: NOW }))
      .toEqual({ ok: false, reason: "not_after_clock_in" });
  });
  it("rejects a clock-out in the future", () => {
    expect(checkClockOutAgainstClockIn({ clockOutMs: NOW + FUTURE_TOLERANCE_MS + 1, clockInMs: clockIn, nowMs: NOW }))
      .toEqual({ ok: false, reason: "future" });
  });
});

describe("clockTimeRejectionMessage", () => {
  it("returns a safe, non-empty message for each reason", () => {
    for (const reason of ["future", "stale_online", "stale_offline", "max_shift", "not_after_clock_in"] as const) {
      const msg = clockTimeRejectionMessage(reason);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
