// Geofencing G1 — pure, testable geofence evaluator for an open shift.
//
// Given the shift's latest live point (or none), the project fence
// (centre + radius), and the thresholds, decide the status:
//   'in_zone' | 'out_of_zone' | 'no_signal'  — or skip (no fence / no point).
//
// Distance is straight-line haversine, reusing the SAME helper the clock-in
// geofence uses so evaluation and enforcement agree at the 50–500 m scales
// this feature cares about. No PostGIS RPC needed.

import { haversineMeters } from "@/lib/worker-utils";
import type { GeofenceThresholds } from "@/lib/geofence/config";

export type GeofenceStatus = "in_zone" | "out_of_zone" | "no_signal";

export type LatestLivePoint = {
  lat: number;
  lng: number;
  /** epoch ms of worker_live_locations.recorded_at for the latest point. */
  recordedAtMs: number;
  /** metres of reported GPS accuracy, if known. */
  accuracy?: number | null;
};

export type GeoFence = {
  center: { lat: number; lng: number };
  radiusM: number;
};

export type GeoEvaluation =
  | {
      kind: "event";
      status: GeofenceStatus;
      distanceM: number | null;
      minutesSinceSignal: number | null;
    }
  | { kind: "skip"; reason: "no_point" | "no_fence" };

/**
 * Evaluate one open shift. Total function — never throws.
 *
 * Decision order (deliberate):
 *   1. no live point           → skip('no_point')   [cron pre-filters these]
 *   2. no fence configured     → skip('no_fence')   [project not geofenced]
 *   3. latest point is stale   → 'no_signal'        [tracking went dark]
 *   4. otherwise               → in/out of zone
 *
 * 'no_fence' takes priority over staleness: G1 only produces events for
 * geofenced projects. A project with no site_point is simply not monitored.
 */
export function evaluateShiftGeofence(input: {
  point: LatestLivePoint | null;
  fence: GeoFence | null;
  nowMs: number;
  thresholds: GeofenceThresholds;
}): GeoEvaluation {
  const { point, fence, nowMs, thresholds } = input;

  if (!point) return { kind: "skip", reason: "no_point" };
  if (!fence) return { kind: "skip", reason: "no_fence" };

  const ageMs = Math.max(0, nowMs - point.recordedAtMs);
  const minutesSinceSignal = Math.floor(ageMs / 60_000);

  // Stale latest point → tracking went dark mid-shift. Distance is
  // untrustworthy, so we don't record it.
  if (ageMs >= thresholds.noSignalAfterMs) {
    return { kind: "event", status: "no_signal", distanceM: null, minutesSinceSignal };
  }

  const distanceM = haversineMeters(fence.center, { lat: point.lat, lng: point.lng });
  // Same buffer as clock-in enforcement: radius + max(accuracy, buffer).
  const allowed = fence.radiusM + Math.max(point.accuracy ?? 0, thresholds.accuracyBufferM);
  const status: GeofenceStatus = distanceM <= allowed ? "in_zone" : "out_of_zone";

  return { kind: "event", status, distanceM: Math.round(distanceM), minutesSinceSignal };
}

/**
 * Status-change-only append gate. Returns true when the newly computed status
 * differs from the shift's latest recorded status (or there is none yet), so
 * the cron appends one row per transition instead of one per tick.
 */
export function shouldAppendGeoEvent(
  latestRecordedStatus: GeofenceStatus | null,
  nextStatus: GeofenceStatus,
): boolean {
  return latestRecordedStatus !== nextStatus;
}
