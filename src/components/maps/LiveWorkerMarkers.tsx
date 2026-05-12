"use client";

import { useEffect, useMemo, useState } from "react";
import { Marker, Polyline } from "@react-google-maps/api";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
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

export function LiveWorkerMarkers() {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [trails, setTrails] = useState<Map<string, Array<{ lat: number; lng: number }>>>(new Map());
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const pollTime = Date.now();
      // Latest position per currently-clocked-in worker.
      // profiles.current_project != null === clocked in. Join to
      // worker_live_locations for their last ping.
      const { data: clockedIn } = await supabase
        .from("profiles")
        .select("id, name, role, current_project")
        .not("current_project", "is", null)
        .is("deleted_at", null);

      if (!clockedIn || clockedIn.length === 0) {
        if (!cancelled) setPositions([]);
        return;
      }

      const workerIds = (clockedIn as Array<{ id: string }>).map((p) => p.id);

      // Get latest location per worker
      const { data: locations } = await supabase
        .from("worker_live_locations")
        .select("worker_id, lat, lng, recorded_at")
        .in("worker_id", workerIds)
        .order("recorded_at", { ascending: false })
        .limit(workerIds.length * 2); // overfetch slightly, we'll dedup

      // Get consent status per worker
      const { data: consents } = await supabase
        .from("worker_location_consents")
        .select("worker_id, consented")
        .in("worker_id", workerIds)
        .order("signed_at", { ascending: false });

      // Build latest consent per worker
      const consentMap = new Map<string, boolean>();
      if (consents) {
        for (const c of consents as Array<{ worker_id: string; consented: boolean }>) {
          if (!consentMap.has(c.worker_id)) {
            consentMap.set(c.worker_id, c.consented);
          }
        }
      }

      // Build latest location per worker
      const locMap = new Map<string, { lat: number; lng: number; recorded_at: string }>();
      if (locations) {
        for (const loc of locations as Array<{ worker_id: string; lat: number; lng: number; recorded_at: string }>) {
          if (!locMap.has(loc.worker_id)) {
            locMap.set(loc.worker_id, { lat: loc.lat, lng: loc.lng, recorded_at: loc.recorded_at });
          }
        }
      }

      // Get project names
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
    }

    function updatePositions(next: LivePosition[]) {
      setPositions(next);
      setTrails((prev) => {
        const updated = new Map(prev);
        for (const pos of next) {
          if (!pos.consented) continue;
          const trail = updated.get(pos.worker_id) ?? [];
          trail.push({ lat: pos.lat, lng: pos.lng });
          if (trail.length > 90) trail.shift();
          updated.set(pos.worker_id, trail);
        }
        return updated;
      });
    }

    void poll();
    const interval = setInterval(() => void poll(), 20_000);

    // Realtime: every new INSERT into worker_live_locations triggers an
    // immediate refetch so the map reflects motion within ~1s instead of
    // waiting up to 20s for the next poll. The interval stays as a
    // fallback for cases where the realtime channel drops.
    const channel = supabase
      .channel("live-worker-locations")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "worker_live_locations" },
        () => { void poll(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  return (
    <>
      {positions.map((pos) => {
        const tracker = classifyTrackerRole(pos.worker_role);
        const color = TRACKER_ROLE_COLOR[tracker];
        const stale = now - new Date(pos.recorded_at).getTime() > STALE_MS;
        const trail = trails.get(pos.worker_id) ?? [];

        if (!pos.consented) {
          // Opted-out worker: show lock icon at project location (no live tracking)
          return (
            <Marker
              key={`opted-out-${pos.worker_id}`}
              position={{ lat: pos.lat, lng: pos.lng }}
              icon={{
                path: 0 as google.maps.SymbolPath,
                fillColor: "#6B7280",
                fillOpacity: 0.4,
                strokeColor: "#6B7280",
                strokeWeight: 1.5,
                scale: 6,
              }}
              title={`${pos.worker_name} — ${t("gps.optedOut")}`}
            />
          );
        }

        return (
          <span key={pos.worker_id}>
            {trail.length > 1 ? (
              <Polyline
                path={trail}
                options={{
                  strokeColor: color,
                  strokeOpacity: 0.25,
                  strokeWeight: 2,
                }}
              />
            ) : null}
            <Marker
              position={{ lat: pos.lat, lng: pos.lng }}
              icon={makeWorkerIcon(pos.worker_role, stale)}
              title={
                stale
                  ? `${pos.worker_name} — ${t("gps.signalLost")}`
                  : `${pos.worker_name} — ${pos.project_name ?? ""}`
              }
            />
          </span>
        );
      })}
    </>
  );
}
