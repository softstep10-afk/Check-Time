import { describe, expect, it } from "vitest";
import {
  evaluateShiftGeofence,
  shouldAppendGeoEvent,
  type GeoFence,
  type LatestLivePoint,
} from "@/lib/geofence/evaluate";
import { DEFAULT_GEOFENCE_THRESHOLDS } from "@/lib/geofence/config";

// A fence centred on a job site with a tight 50 m radius and the default
// 25 m accuracy buffer → effective allowed distance ~75 m for a 0-accuracy fix.
const SITE: GeoFence = { center: { lat: 47.6062, lng: -122.3321 }, radiusM: 50 };
const NOW = 1_700_000_000_000; // fixed epoch ms; no Date.now() in tests

function pointNearSite(overrides: Partial<LatestLivePoint> = {}): LatestLivePoint {
  return {
    lat: SITE.center.lat,
    lng: SITE.center.lng,
    recordedAtMs: NOW, // fresh
    accuracy: 0,
    ...overrides,
  };
}

// ~1 deg latitude ≈ 111_320 m, so this offset is a known distance north.
function pointMetresNorth(meters: number, overrides: Partial<LatestLivePoint> = {}): LatestLivePoint {
  return pointNearSite({ lat: SITE.center.lat + meters / 111_320, ...overrides });
}

describe("evaluateShiftGeofence", () => {
  it("reports in_zone for a fresh point at the site", () => {
    const result = evaluateShiftGeofence({
      point: pointNearSite(),
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toMatchObject({ kind: "event", status: "in_zone", distanceM: 0 });
  });

  it("reports in_zone just inside the buffered radius (boundary, inclusive)", () => {
    // 70 m out, allowed = 50 + max(0, 25) = 75 m → inside.
    const result = evaluateShiftGeofence({
      point: pointMetresNorth(70),
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toMatchObject({ kind: "event", status: "in_zone" });
  });

  it("reports out_of_zone beyond the buffered radius", () => {
    // 120 m out, allowed = 75 m → outside.
    const result = evaluateShiftGeofence({
      point: pointMetresNorth(120),
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result.kind).toBe("event");
    if (result.kind === "event") {
      expect(result.status).toBe("out_of_zone");
      expect(result.distanceM).toBeGreaterThan(75);
    }
  });

  it("widens the allowance by the reported accuracy (jitter tolerance)", () => {
    // 120 m out but a 200 m accuracy fix → allowed = 50 + max(200, 25) = 250 m → inside.
    const result = evaluateShiftGeofence({
      point: pointMetresNorth(120, { accuracy: 200 }),
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toMatchObject({ kind: "event", status: "in_zone" });
  });

  it("reports no_signal when the latest point is stale, with null distance", () => {
    const staleMs = NOW - (DEFAULT_GEOFENCE_THRESHOLDS.noSignalAfterMs + 60_000);
    const result = evaluateShiftGeofence({
      point: pointMetresNorth(500, { recordedAtMs: staleMs }), // far, but stale wins
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result.kind).toBe("event");
    if (result.kind === "event") {
      expect(result.status).toBe("no_signal");
      expect(result.distanceM).toBeNull();
      expect(result.minutesSinceSignal).toBeGreaterThanOrEqual(16);
    }
  });

  it("treats a point exactly at the no_signal threshold as no_signal (inclusive)", () => {
    const boundaryMs = NOW - DEFAULT_GEOFENCE_THRESHOLDS.noSignalAfterMs;
    const result = evaluateShiftGeofence({
      point: pointNearSite({ recordedAtMs: boundaryMs }),
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toMatchObject({ kind: "event", status: "no_signal" });
  });

  it("skips when the project has no fence (site not geofenced)", () => {
    const result = evaluateShiftGeofence({
      point: pointNearSite(),
      fence: null,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toEqual({ kind: "skip", reason: "no_fence" });
  });

  it("skips a missing fence even when the point is stale (no_fence wins)", () => {
    const staleMs = NOW - (DEFAULT_GEOFENCE_THRESHOLDS.noSignalAfterMs + 60_000);
    const result = evaluateShiftGeofence({
      point: pointNearSite({ recordedAtMs: staleMs }),
      fence: null,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toEqual({ kind: "skip", reason: "no_fence" });
  });

  it("skips when there is no live point", () => {
    const result = evaluateShiftGeofence({
      point: null,
      fence: SITE,
      nowMs: NOW,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });
    expect(result).toEqual({ kind: "skip", reason: "no_point" });
  });
});

describe("shouldAppendGeoEvent (status-change-only)", () => {
  it("appends the first event when there is no prior status", () => {
    expect(shouldAppendGeoEvent(null, "in_zone")).toBe(true);
  });

  it("does not append when the status is unchanged", () => {
    expect(shouldAppendGeoEvent("in_zone", "in_zone")).toBe(false);
    expect(shouldAppendGeoEvent("no_signal", "no_signal")).toBe(false);
  });

  it("appends on every transition between distinct statuses", () => {
    expect(shouldAppendGeoEvent("in_zone", "out_of_zone")).toBe(true);
    expect(shouldAppendGeoEvent("out_of_zone", "no_signal")).toBe(true);
    expect(shouldAppendGeoEvent("no_signal", "in_zone")).toBe(true);
  });
});
