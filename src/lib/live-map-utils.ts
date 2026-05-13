export type LiveTrailPoint = {
  lat: number;
  lng: number;
  recordedAt: string;
};

export const LIVE_MAP_POLL_INTERVAL_MS = 30_000;
export const LIVE_MAP_REALTIME_REFETCH_THROTTLE_MS = 5_000;
export const LIVE_MAP_TRAIL_POINT_LIMIT = 30;

function sameTrailPoint(left: LiveTrailPoint, right: LiveTrailPoint): boolean {
  return (
    left.recordedAt === right.recordedAt &&
    left.lat === right.lat &&
    left.lng === right.lng
  );
}

export function appendLiveTrailPoint(
  trail: ReadonlyArray<LiveTrailPoint>,
  next: LiveTrailPoint,
  limit = LIVE_MAP_TRAIL_POINT_LIMIT,
): LiveTrailPoint[] {
  const last = trail[trail.length - 1];
  if (last && sameTrailPoint(last, next)) {
    return trail as LiveTrailPoint[];
  }

  const trimmed = trail.length >= limit ? trail.slice(trail.length - limit + 1) : [...trail];
  return [...trimmed, next];
}
