import type { UserRole } from "@/types/database";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import type { WorkerGeoPoint } from "@/lib/worker-types";

// Washington-focused defaults for the manager Active Site Map.
//
// The company operates around the Puget Sound, so the map should land
// near Seattle/Tacoma even when no project coordinates exist yet — and
// it must never zoom out far enough to show the whole world.
//
// Tuning: bounds cover the state with a small buffer. Center is the
// midpoint between Seattle and Tacoma. Zoom 8 lands the manager at
// county-scale; the Marker fit-bounds path will tighten further when
// real points are present.
export const WASHINGTON_CENTER: WorkerGeoPoint = {
  lat: 47.4502,
  lng: -122.3088,
};

export const WASHINGTON_BOUNDS = {
  north: 49.05,
  south: 45.5,
  east: -116.85,
  west: -124.85,
} as const;

export const WASHINGTON_DEFAULT_ZOOM = 8;
export const WASHINGTON_SINGLE_POINT_ZOOM = 13;

// Hard floor on zoom-out so the map never lands on a world view. 6 keeps
// the manager around the Pacific Northwest even if a stray coordinate
// lives outside Washington. Raise toward 7 if Oregon/Idaho noise creeps
// in.
export const ACTIVE_MAP_MIN_ZOOM = 6;
// Cap zoom-in so a single project doesn't slam to street-level on load.
export const ACTIVE_MAP_MAX_ZOOM = 17;

export type TrackerRole = "worker" | "supervisor" | "driver";

// A normalized marker shape that the map can render regardless of the
// underlying data source. Live worker GPS today, but the same shape is
// what an external tracker integration (vehicle GPS, BLE beacon, etc.)
// should produce. See note in LiveWorkerMarkers about AirTag.
export interface LiveAssetMarker {
  id: string;
  name: string;
  role: TrackerRole;
  projectName: string | null;
  lat: number;
  lng: number;
  recordedAt?: string | null;
}

const DRIVER_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(["driver"]);
const SUPERVISOR_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  "supervisor",
  "manager",
  "admin",
  "owner",
]);

// Bucket a raw profile role into the three marker visuals the map
// renders. Anything that isn't a driver/supervisor falls back to
// "worker" so unknown future roles still get a sensible pin.
export function classifyTrackerRole(role: string | null | undefined): TrackerRole {
  if (!role) return "worker";
  if (DRIVER_ROLES.has(role as UserRole)) return "driver";
  if (SUPERVISOR_ROLES.has(role as UserRole)) return "supervisor";
  return "worker";
}

export const TRACKER_ROLE_COLOR: Record<TrackerRole, string> = {
  driver: "#3b82f6",
  supervisor: "#a855f7",
  worker: "#2EA67A",
};

// Active map should hide projects that are archived, soft-deleted, or
// completed.
export function isProjectOnActiveMap(
  project: Pick<ManagerProjectSummary, "status" | "deleted_at">,
): boolean {
  if (project.deleted_at) return false;
  if (project.status === "archived") return false;
  if (project.status === "completed") return false;
  return true;
}

export interface LatLngLike {
  lat: number;
  lng: number;
}

export function isPointInsideWashingtonBounds(point: LatLngLike | null | undefined): boolean {
  if (!point) return false;
  return (
    point.lat >= WASHINGTON_BOUNDS.south &&
    point.lat <= WASHINGTON_BOUNDS.north &&
    point.lng >= WASHINGTON_BOUNDS.west &&
    point.lng <= WASHINGTON_BOUNDS.east
  );
}

// Pick a sensible initial center for the map given the points we know
// about. Project bounds take priority, then any active worker/driver
// position, then the Washington fallback. The result is only used until
// fitBounds runs against a real LatLngBounds on map load.
export function pickInitialMapCenter(
  projectPoints: ReadonlyArray<LatLngLike>,
  workerPoints: ReadonlyArray<LatLngLike>,
): LatLngLike {
  if (projectPoints.length > 0) {
    return { lat: projectPoints[0].lat, lng: projectPoints[0].lng };
  }
  if (workerPoints.length > 0) {
    return { lat: workerPoints[0].lat, lng: workerPoints[0].lng };
  }
  return { lat: WASHINGTON_CENTER.lat, lng: WASHINGTON_CENTER.lng };
}

// Initial zoom that mirrors pickInitialMapCenter:
//   • multiple points → state-scale, fitBounds will tighten on load
//   • exactly one point → city-scale
//   • no points → Washington-scale fallback
export function pickInitialMapZoom(totalPoints: number): number {
  if (totalPoints === 0) return WASHINGTON_DEFAULT_ZOOM;
  if (totalPoints === 1) return WASHINGTON_SINGLE_POINT_ZOOM;
  return 10;
}
