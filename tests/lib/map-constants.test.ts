import { describe, expect, it } from "vitest";
import {
  ACTIVE_MAP_MAX_ZOOM,
  ACTIVE_MAP_MIN_ZOOM,
  TRACKER_ROLE_COLOR,
  WASHINGTON_BOUNDS,
  WASHINGTON_CENTER,
  classifyTrackerRole,
  isProjectOnActiveMap,
  pickInitialMapCenter,
  pickInitialMapZoom,
} from "@/lib/map-constants";
import type { ManagerProjectSummary } from "@/lib/manager-types";

describe("WASHINGTON_CENTER / WASHINGTON_BOUNDS", () => {
  it("centers inside the Washington bounding box", () => {
    expect(WASHINGTON_CENTER.lat).toBeGreaterThan(WASHINGTON_BOUNDS.south);
    expect(WASHINGTON_CENTER.lat).toBeLessThan(WASHINGTON_BOUNDS.north);
    expect(WASHINGTON_CENTER.lng).toBeGreaterThan(WASHINGTON_BOUNDS.west);
    expect(WASHINGTON_CENTER.lng).toBeLessThan(WASHINGTON_BOUNDS.east);
  });

  it("brackets the Seattle area", () => {
    // Seattle ≈ 47.6062, -122.3321 — must be in-bounds.
    expect(WASHINGTON_BOUNDS.south).toBeLessThan(47.6062);
    expect(WASHINGTON_BOUNDS.north).toBeGreaterThan(47.6062);
    expect(WASHINGTON_BOUNDS.west).toBeLessThan(-122.3321);
    expect(WASHINGTON_BOUNDS.east).toBeGreaterThan(-122.3321);
  });

  it("keeps zoom limits inside a sane operational range", () => {
    // ACTIVE_MAP_MIN_ZOOM must stop the map from showing the entire
    // world. Zoom 5 already shows continental Europe + Asia in one
    // viewport, so we require something tighter.
    expect(ACTIVE_MAP_MIN_ZOOM).toBeGreaterThanOrEqual(6);
    expect(ACTIVE_MAP_MAX_ZOOM).toBeLessThanOrEqual(20);
    expect(ACTIVE_MAP_MIN_ZOOM).toBeLessThan(ACTIVE_MAP_MAX_ZOOM);
  });
});

describe("classifyTrackerRole", () => {
  it("buckets drivers", () => {
    expect(classifyTrackerRole("driver")).toBe("driver");
  });

  it("buckets supervisor-tier roles", () => {
    expect(classifyTrackerRole("supervisor")).toBe("supervisor");
    expect(classifyTrackerRole("manager")).toBe("supervisor");
    expect(classifyTrackerRole("admin")).toBe("supervisor");
    expect(classifyTrackerRole("owner")).toBe("supervisor");
  });

  it("defaults unknown roles to worker so unfamiliar future roles still render", () => {
    expect(classifyTrackerRole("worker")).toBe("worker");
    expect(classifyTrackerRole("subcontractor")).toBe("worker");
    expect(classifyTrackerRole(null)).toBe("worker");
    expect(classifyTrackerRole(undefined)).toBe("worker");
    expect(classifyTrackerRole("zzz-unknown")).toBe("worker");
  });

  it("exposes a distinct color per bucket", () => {
    expect(TRACKER_ROLE_COLOR.driver).not.toBe(TRACKER_ROLE_COLOR.worker);
    expect(TRACKER_ROLE_COLOR.driver).not.toBe(TRACKER_ROLE_COLOR.supervisor);
    expect(TRACKER_ROLE_COLOR.supervisor).not.toBe(TRACKER_ROLE_COLOR.worker);
  });
});

describe("isProjectOnActiveMap", () => {
  function project(
    overrides: Partial<Pick<ManagerProjectSummary, "status" | "deleted_at">>,
  ) {
    return {
      status: "active",
      deleted_at: null,
      ...overrides,
    } as Pick<ManagerProjectSummary, "status" | "deleted_at">;
  }

  it("includes active projects", () => {
    expect(isProjectOnActiveMap(project({ status: "active" }))).toBe(true);
  });

  it("includes paused projects (they're still operational, just quiet)", () => {
    expect(isProjectOnActiveMap(project({ status: "paused" }))).toBe(true);
  });

  it("excludes archived projects so the active map stays clean", () => {
    expect(isProjectOnActiveMap(project({ status: "archived" }))).toBe(false);
  });

  it("excludes completed projects", () => {
    expect(isProjectOnActiveMap(project({ status: "completed" }))).toBe(false);
  });

  it("excludes soft-deleted projects regardless of status", () => {
    expect(
      isProjectOnActiveMap(
        project({ status: "active", deleted_at: "2026-01-01T00:00:00Z" }),
      ),
    ).toBe(false);
  });
});

describe("pickInitialMapCenter", () => {
  it("falls back to Washington when no points exist", () => {
    const center = pickInitialMapCenter([], []);
    expect(center.lat).toBe(WASHINGTON_CENTER.lat);
    expect(center.lng).toBe(WASHINGTON_CENTER.lng);
  });

  it("prefers project coordinates over worker coordinates", () => {
    const center = pickInitialMapCenter(
      [{ lat: 47.6, lng: -122.3 }],
      [{ lat: 1, lng: 2 }],
    );
    expect(center).toEqual({ lat: 47.6, lng: -122.3 });
  });

  it("falls back to worker coordinates when no projects are placed", () => {
    const center = pickInitialMapCenter([], [{ lat: 47.25, lng: -122.45 }]);
    expect(center).toEqual({ lat: 47.25, lng: -122.45 });
  });
});

describe("pickInitialMapZoom", () => {
  it("uses the Washington-scale fallback when there are no points", () => {
    expect(pickInitialMapZoom(0)).toBeGreaterThanOrEqual(ACTIVE_MAP_MIN_ZOOM);
    expect(pickInitialMapZoom(0)).toBeLessThanOrEqual(10);
  });

  it("zooms tighter for a single point", () => {
    expect(pickInitialMapZoom(1)).toBeGreaterThan(pickInitialMapZoom(0));
  });

  it("never returns a zoom below the active-map floor", () => {
    for (let n = 0; n < 5; n++) {
      expect(pickInitialMapZoom(n)).toBeGreaterThanOrEqual(ACTIVE_MAP_MIN_ZOOM);
    }
  });
});
