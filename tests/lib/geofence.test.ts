import { describe, it, expect } from "vitest";
import { resolveProjectRadiusM } from "@/lib/geofence";
import { haversineMeters } from "@/lib/worker-utils";

// ─────────────────────────────────────────────────────────────────────
// resolveProjectRadiusM — fallback chain
// ─────────────────────────────────────────────────────────────────────

describe("resolveProjectRadiusM", () => {
  it("prefers the per-project gps_radius_m when set", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: 120, radius_m: 200 }, 75)).toBe(120);
  });

  it("falls back to app_settings when gps_radius_m is null", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: null, radius_m: 200 }, 90)).toBe(90);
  });

  it("falls back to app_settings when gps_radius_m is undefined", () => {
    expect(resolveProjectRadiusM({ radius_m: 200 }, 90)).toBe(90);
  });

  it("falls back to legacy radius_m when both gps_radius_m AND app radius are missing/zero", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: null, radius_m: 200 }, 0)).toBe(200);
  });

  it("falls back to 75m floor when nothing is set", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: null, radius_m: null }, 0)).toBe(75);
  });

  it("rejects a zero or negative gps_radius_m and falls through", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: 0, radius_m: 150 }, 90)).toBe(90);
    expect(resolveProjectRadiusM({ gps_radius_m: -10, radius_m: 150 }, 90)).toBe(90);
  });

  it("rejects a NaN gps_radius_m and falls through", () => {
    expect(resolveProjectRadiusM({ gps_radius_m: Number.NaN, radius_m: 150 }, 80)).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────
// haversineMeters — earth distance math
// ─────────────────────────────────────────────────────────────────────

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    const p = { lat: 37.7749, lng: -122.4194 };
    expect(haversineMeters(p, p)).toBe(0);
  });

  it("computes a small east-west delta around 1m precision", () => {
    // ~1° of longitude at the equator ≈ 111_320m
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 1 };
    expect(haversineMeters(a, b)).toBeGreaterThan(111_000);
    expect(haversineMeters(a, b)).toBeLessThan(111_500);
  });

  it("is symmetric: d(a,b) === d(b,a)", () => {
    const a = { lat: 37.7749, lng: -122.4194 };
    const b = { lat: 40.7128, lng: -74.006 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 0);
  });

  it("matches the SF → NYC great-circle distance to within 1km", () => {
    const sf = { lat: 37.7749, lng: -122.4194 };
    const nyc = { lat: 40.7128, lng: -74.006 };
    // Reference: ~4_135_000m
    const d = haversineMeters(sf, nyc);
    expect(d).toBeGreaterThan(4_120_000);
    expect(d).toBeLessThan(4_150_000);
  });

  it("correctly returns ~111km for a 1° latitude delta on the same meridian", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 1, lng: 0 };
    expect(haversineMeters(a, b)).toBeGreaterThan(110_500);
    expect(haversineMeters(a, b)).toBeLessThan(111_500);
  });

  it("treats antipodes as approximately half the earth's circumference", () => {
    const a = { lat: 0, lng: 0 };
    const b = { lat: 0, lng: 180 };
    const d = haversineMeters(a, b);
    expect(d).toBeGreaterThan(20_000_000);
    expect(d).toBeLessThan(20_100_000);
  });

  it("plays well as a fence check: 50m offset is within a 75m radius", () => {
    // ~50m east of (37.7749, -122.4194) at that latitude:
    // 1° lng ≈ 111_320 * cos(lat) ≈ 88_000m → 50m ≈ 0.000568°
    const center = { lat: 37.7749, lng: -122.4194 };
    const near = { lat: 37.7749, lng: -122.4194 + 0.000568 };
    const distance = haversineMeters(center, near);
    expect(distance).toBeLessThan(75);
    expect(distance).toBeGreaterThan(40);
  });

  it("plays well as a fence check: 200m offset is outside a 75m radius", () => {
    const center = { lat: 37.7749, lng: -122.4194 };
    // ~200m east
    const far = { lat: 37.7749, lng: -122.4194 + 0.00227 };
    const distance = haversineMeters(center, far);
    expect(distance).toBeGreaterThan(75);
    expect(distance).toBeLessThan(250);
  });
});
