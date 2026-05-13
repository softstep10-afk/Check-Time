"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { MarkerF, PolylineF } from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  LIVE_MAP_POLL_INTERVAL_MS,
  LIVE_MAP_REALTIME_REFETCH_THROTTLE_MS,
  LIVE_MAP_TRAIL_POINT_LIMIT,
  appendLiveTrailPoint,
  type LiveTrailPoint,
} from "@/lib/live-map-utils";
import { TRACKER_ROLE_COLOR, classifyTrackerRole } from "@/lib/map-constants";

// NOTE on external trackers (AirTag, Tile, vehicle GPS, etc.):
//   Apple AirTag does not expose a public web API for location reads —
//   AirTag locations are surfaced only through the Find My iCloud client
//   on Apple devices, so the manager map cannot consume them directly.
//   Future hardware tracker sources should write normalized lat/lng
//   pings into an app-owned table (today: worker_live_locations, or a
//   parallel tracker table that maps to a LiveAssetMarker), and the map
//   reads from that same shape. Do NOT couple this component to any
//   vendor SDK.

type LivePosition = {
  worker_id: string;
  worker_name: string;
  worker_role: string;
  project_name: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
  consented: boolean;
};

const STALE_MS = 5 * 60_000; // 5 min

function makeWorkerIcon(role: string, stale: boolean) {
  const tracker = classifyTrackerRole(role);
  const baseColor = TRACKER_ROLE_COLOR[tracker];
  const color = stale ? "#6B7280" : baseColor;
  // Drivers get a forward arrow so a delivery run reads as motion vs. a
  // stationary worker. Supervisors get a slightly larger ringed circle.
  if (tracker === "driver") {
    return {
      path: 1 as google.maps.SymbolPath, // FORWARD_CLOSED_ARROW
      fillColor: color,
      fillOpacity: stale ? 0.5 : 0.95,
      strokeColor: stale ? "#6B7280" : "#ffffff",
      strokeWeight: 1.5,
      scale: 5,
    };
  }
  return {
    path: 0 as google.maps.SymbolPath, // CIRCLE
    fillColor: color,
    fillOpacity: stale ? 0.5 : 0.92,
    strokeColor: stale
      ? "#6B7280"
      : tracker === "supervisor"
        ? "#ffffff"
        : color,
    strokeWeight: 2,
    scale: tracker === "supervisor" ? 8 : 7,
  };
}

function makeOptedOutIcon() {
  return {
    path: 0 as google.maps.SymbolPath,
    fillColor: "#6B7280",
    fillOpacity: 0.4,
    strokeColor: "#6B7280",
    strokeWeight: 1.5,
    scale: 6,
  };
}

function samePosition(left: LivePosition, right: LivePosition): boolean {
  return (
    left.worker_id === right.worker_id &&
    left.worker_name === right.worker_name &&
    left.worker_role === right.worker_role &&
    left.project_name === right.project_name &&
    left.lat === right.lat &&
    left.lng === right.lng &&
    left.recorded_at === right.recorded_at &&
    left.consented === right.consented
  );
}

function samePositions(left: LivePosition[], right: LivePosition[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (!samePosition(left[i], right[i])) return false;
  }
  return true;
}

export function LiveWorkerMarkers() {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [trails, setTrails] = useState<Map<string, LiveTrailPoint[]>>(new Map());
  const [now, setNow] = useState(0);
  const icons = useMemo(() => ({
    driver: {
      fresh: makeWorkerIcon("driver", false),
      stale: makeWorkerIcon("driver", true),
    },
    supervisor: {
      fresh: makeWorkerIcon("supervisor", false),
      stale: makeWorkerIcon("supervisor", true),
    },
    worker: {
      fresh: makeWorkerIcon("worker", false),
      stale: makeWorkerIcon("worker", true),
    },
    optedOut: makeOptedOutIcon(),
  }), []);
  const trailOptions = useMemo(() => ({
    driver: {
      strokeColor: TRACKER_ROLE_COLOR.driver,
      strokeOpacity: 0.25,
      strokeWeight: 2,
    },
    supervisor: {
      strokeColor: TRACKER_ROLE_COLOR.supervisor,
      strokeOpacity: 0.25,
      strokeWeight: 2,
    },
    worker: {
      strokeColor: TRACKER_ROLE_COLOR.worker,
      strokeOpacity: 0.25,
      strokeWeight: 2,
    },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastPollStartedAt = 0;
    let pendingPoll: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled || inFlight) return;
      inFlight = true;
      lastPollStartedAt = Date.now();
      const pollTime = Date.now();
      try {
        // Latest position per currently-clocked-in worker.
        // profiles.current_project != null === clocked in. Join to
        // worker_live_locations for their last ping.
        const { data: clockedIn } = await supabase
          .from("profiles")
          .select("id, name, role, current_project")
          .not("current_project", "is", null)
          .is("deleted_at", null);

        if (!clockedIn || clockedIn.length === 0) {
          if (!cancelled) {
            setNow(pollTime);
            setPositions((prev) => (prev.length === 0 ? prev : []));
            setTrails((prev) => (prev.size === 0 ? prev : new Map()));
          }
          return;
        }

        const workerIds = (clockedIn as Array<{ id: string }>).map((p) => p.id);

        // Get latest location per worker.
        const { data: locations } = await supabase
          .from("worker_live_locations")
          .select("worker_id, lat, lng, recorded_at")
          .in("worker_id", workerIds)
          .order("recorded_at", { ascending: false })
          .limit(workerIds.length * 2); // overfetch slightly, we'll dedup

        // Get consent status per worker.
        const { data: consents } = await supabase
          .from("worker_location_consents")
          .select("worker_id, consented")
          .in("worker_id", workerIds)
          .order("signed_at", { ascending: false });

        // Build latest consent per worker.
        const consentMap = new Map<string, boolean>();
        if (consents) {
          for (const c of consents as Array<{ worker_id: string; consented: boolean }>) {
            if (!consentMap.has(c.worker_id)) {
              consentMap.set(c.worker_id, c.consented);
            }
          }
        }

        // Build latest location per worker.
        const locMap = new Map<string, { lat: number; lng: number; recorded_at: string }>();
        if (locations) {
          for (const loc of locations as Array<{ worker_id: string; lat: number; lng: number; recorded_at: string }>) {
            if (!locMap.has(loc.worker_id)) {
              locMap.set(loc.worker_id, { lat: loc.lat, lng: loc.lng, recorded_at: loc.recorded_at });
            }
          }
        }

        // Get project names.
        const projectIds = [...new Set(
          (clockedIn as Array<{ current_project: string | null }>)
            .map((p) => p.current_project)
            .filter(Boolean) as string[],
        )];
        const { data: projects } = projectIds.length > 0
          ? await supabase.from("projects").select("id, name").in("id", projectIds)
          : { data: [] };
        const projectMap = new Map(
          ((projects ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
        );

        const result: LivePosition[] = (clockedIn as Array<{ id: string; name: string; role: string; current_project: string | null }>).map((profile) => {
          const loc = locMap.get(profile.id);
          const consented = consentMap.get(profile.id) ?? true; // default to consented if no record

          return {
            worker_id: profile.id,
            worker_name: profile.name,
            worker_role: profile.role,
            project_name: profile.current_project ? (projectMap.get(profile.current_project) ?? null) : null,
            lat: loc?.lat ?? 0,
            lng: loc?.lng ?? 0,
            recorded_at: loc?.recorded_at ?? new Date(pollTime).toISOString(),
            consented,
          };
        }).filter((p) => p.lat !== 0 && p.lng !== 0); // Only show workers with a real recorded position

        if (!cancelled) {
          setNow(pollTime);
          updatePositions(result);
        }
      } finally {
        inFlight = false;
      }
    }

    function schedulePoll() {
      if (cancelled || pendingPoll !== null) return;
      const elapsed = Date.now() - lastPollStartedAt;
      const wait = Math.max(1_500, LIVE_MAP_REALTIME_REFETCH_THROTTLE_MS - elapsed);
      pendingPoll = setTimeout(() => {
        pendingPoll = null;
        void poll();
      }, wait);
    }

    function updatePositions(next: LivePosition[]) {
      setPositions((prev) => (samePositions(prev, next) ? prev : next));
      setTrails((prev) => {
        const updated = new Map(prev);
        let changed = false;
        const liveWorkerIds = new Set(next.map((pos) => pos.worker_id));
        for (const workerId of updated.keys()) {
          if (!liveWorkerIds.has(workerId)) {
            updated.delete(workerId);
            changed = true;
          }
        }
        for (const pos of next) {
          if (!pos.consented) continue;
          const trail = updated.get(pos.worker_id) ?? [];
          const nextTrail = appendLiveTrailPoint(
            trail,
            { lat: pos.lat, lng: pos.lng, recordedAt: pos.recorded_at },
            LIVE_MAP_TRAIL_POINT_LIMIT,
          );
          if (nextTrail !== trail) {
            updated.set(pos.worker_id, nextTrail);
            changed = true;
          }
        }
        return changed ? updated : prev;
      });
    }

    void poll();
    const interval = setInterval(() => void poll(), LIVE_MAP_POLL_INTERVAL_MS);

    // Realtime inserts are throttled. Worker GPS can write often, and
    // refetching profiles/projects/consents for every insert makes the
    // map feel sticky while the manager pans around.
    const channel = supabase
      .channel("live-worker-locations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "worker_live_locations" },
        schedulePoll,
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (pendingPoll !== null) clearTimeout(pendingPoll);
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  return (
    <>
      {positions.map((pos) => {
        const tracker = classifyTrackerRole(pos.worker_role);
        const stale = now - new Date(pos.recorded_at).getTime() > STALE_MS;
        const trail = trails.get(pos.worker_id) ?? [];

        if (!pos.consented) {
          // Opted-out worker: show lock icon at project location (no live tracking)
          return (
            <MarkerF
              key={`opted-out-${pos.worker_id}`}
              position={{ lat: pos.lat, lng: pos.lng }}
              icon={icons.optedOut}
              title={`${pos.worker_name} — ${t("gps.optedOut")}`}
            />
          );
        }

        return (
          <Fragment key={pos.worker_id}>
            {trail.length > 1 ? (
              <PolylineF
                path={trail}
                options={trailOptions[tracker]}
              />
            ) : null}
            <MarkerF
              position={{ lat: pos.lat, lng: pos.lng }}
              icon={icons[tracker][stale ? "stale" : "fresh"]}
              title={
                stale
                  ? `${pos.worker_name} — ${t("gps.signalLost")}`
                  : `${pos.worker_name} — ${pos.project_name ?? ""}`
              }
            />
          </Fragment>
        );
      })}
    </>
  );
}
