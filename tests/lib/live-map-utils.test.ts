import { describe, expect, it } from "vitest";
import {
  LIVE_MAP_POLL_INTERVAL_MS,
  LIVE_MAP_REALTIME_REFETCH_THROTTLE_MS,
  LIVE_MAP_TRAIL_POINT_LIMIT,
  appendLiveTrailPoint,
  type LiveTrailPoint,
} from "@/lib/live-map-utils";

describe("live map helpers", () => {
  it("uses conservative polling defaults for the manager map", () => {
    expect(LIVE_MAP_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(LIVE_MAP_REALTIME_REFETCH_THROTTLE_MS).toBeGreaterThanOrEqual(5_000);
    expect(LIVE_MAP_TRAIL_POINT_LIMIT).toBeLessThanOrEqual(30);
  });

  it("does not append the same trail point twice", () => {
    const trail: LiveTrailPoint[] = [
      { lat: 47.6, lng: -122.3, recordedAt: "2026-05-12T10:00:00Z" },
    ];

    const next = appendLiveTrailPoint(trail, {
      lat: 47.6,
      lng: -122.3,
      recordedAt: "2026-05-12T10:00:00Z",
    });

    expect(next).toBe(trail);
  });

  it("caps trail history so old GPS paths do not slow the map down", () => {
    const trail = Array.from({ length: LIVE_MAP_TRAIL_POINT_LIMIT }, (_, index) => ({
      lat: 47 + index / 1000,
      lng: -122,
      recordedAt: `2026-05-12T10:${String(index).padStart(2, "0")}:00Z`,
    }));

    const next = appendLiveTrailPoint(trail, {
      lat: 48,
      lng: -122,
      recordedAt: "2026-05-12T11:00:00Z",
    });

    expect(next).toHaveLength(LIVE_MAP_TRAIL_POINT_LIMIT);
    expect(next[0]).toEqual(trail[1]);
    expect(next.at(-1)?.recordedAt).toBe("2026-05-12T11:00:00Z");
  });
});
