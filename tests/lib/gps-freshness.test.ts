import { describe, expect, it } from "vitest";
import { deriveGpsFreshness, formatGpsAge } from "@/lib/gps-freshness";

const NOW = new Date("2026-04-29T12:00:00Z");

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe("deriveGpsFreshness", () => {
  it("returns no_signal when there is no last update", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: null,
      shiftStartAt: ago(60_000),
      now: NOW,
    });
    expect(result.status).toBe("no_signal");
    expect(result.ageMs).toBeNull();
    expect(result.lastUpdateAt).toBeNull();
  });

  it("returns no_signal when the last update timestamp is unparseable", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: "not-a-date",
      shiftStartAt: ago(60_000),
      now: NOW,
    });
    expect(result.status).toBe("no_signal");
  });

  it("classifies updates under 2 minutes old as fresh", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(30_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("fresh");
    expect(result.ageMs).toBe(30_000);
  });

  it("classifies the 2-minute boundary as delayed", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(2 * 60_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("delayed");
  });

  it("classifies updates between 2 and 5 minutes as delayed", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(4 * 60_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("delayed");
  });

  it("classifies the 5-minute boundary as stale", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(5 * 60_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("stale");
  });

  it("classifies updates between 5 and 15 minutes as stale", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(10 * 60_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("stale");
  });

  it("classifies the 15-minute boundary as lost", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(15 * 60_000),
      shiftStartAt: ago(60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("lost");
  });

  it("classifies long-gap updates on a short shift as lost", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(60 * 60_000),
      shiftStartAt: ago(2 * 60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("lost");
  });

  it("promotes lost to needs_review when the shift is older than 12 hours", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(60 * 60_000),
      shiftStartAt: ago(13 * 60 * 60_000),
      now: NOW,
    });
    expect(result.status).toBe("needs_review");
  });

  it("does not promote fresh or delayed shifts even if very long", () => {
    const fresh = deriveGpsFreshness({
      lastUpdateAt: ago(30_000),
      shiftStartAt: ago(20 * 60 * 60_000),
      now: NOW,
    });
    expect(fresh.status).toBe("fresh");

    const delayed = deriveGpsFreshness({
      lastUpdateAt: ago(3 * 60_000),
      shiftStartAt: ago(20 * 60 * 60_000),
      now: NOW,
    });
    expect(delayed.status).toBe("delayed");
  });

  it("clamps negative age (last update in the future) to zero", () => {
    const future = new Date(NOW.getTime() + 10_000).toISOString();
    const result = deriveGpsFreshness({
      lastUpdateAt: future,
      shiftStartAt: ago(60_000),
      now: NOW,
    });
    expect(result.ageMs).toBe(0);
    expect(result.status).toBe("fresh");
  });

  it("returns lost (not needs_review) when shiftStartAt is missing", () => {
    const result = deriveGpsFreshness({
      lastUpdateAt: ago(60 * 60_000),
      shiftStartAt: null,
      now: NOW,
    });
    expect(result.status).toBe("lost");
  });
});

describe("formatGpsAge", () => {
  it("renders em dash for null", () => {
    expect(formatGpsAge(null)).toBe("—");
  });

  it("renders seconds under a minute", () => {
    expect(formatGpsAge(45_000)).toBe("45s");
  });

  it("renders minutes under an hour", () => {
    expect(formatGpsAge(15 * 60_000)).toBe("15m");
  });

  it("renders hours under a day", () => {
    expect(formatGpsAge(3 * 60 * 60_000)).toBe("3h");
  });

  it("renders days for very old updates", () => {
    expect(formatGpsAge(2 * 24 * 60 * 60_000)).toBe("2d");
  });
});
