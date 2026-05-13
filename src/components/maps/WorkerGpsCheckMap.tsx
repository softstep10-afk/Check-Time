"use client";

import { useCallback, useMemo } from "react";
import { Circle, Marker } from "@react-google-maps/api";
import { MapProvider } from "@/components/maps/GoogleMaps";
import type { WorkerGpsCheck } from "@/lib/worker-types";

const MAP_COLORS = {
  gold: "#BFA234",
  green: "#2EA67A",
  red: "#D4515E",
} as const;

export function WorkerGpsCheckMap({
  gpsCheck,
}: {
  gpsCheck: WorkerGpsCheck;
}) {
  const workerColor =
    gpsCheck.withinFence === false ? MAP_COLORS.red : MAP_COLORS.green;
  const workerPos = useMemo(() => ({
    lat: gpsCheck.position.lat,
    lng: gpsCheck.position.lng,
  }), [gpsCheck.position.lat, gpsCheck.position.lng]);

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      if (!gpsCheck.site) return;
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(workerPos);
      bounds.extend({ lat: gpsCheck.site.lat, lng: gpsCheck.site.lng });
      map.fitBounds(bounds, 28);
    },
    [gpsCheck.site, workerPos],
  );

  return (
    <MapProvider
      center={workerPos}
      zoom={16}
      options={{ zoomControl: false }}
      onLoad={handleLoad}
    >
      {gpsCheck.site ? (
        <>
          <Circle
            center={{ lat: gpsCheck.site.lat, lng: gpsCheck.site.lng }}
            radius={gpsCheck.radiusMeters}
            options={{
              strokeColor: MAP_COLORS.gold,
              strokeWeight: 2,
              fillColor: MAP_COLORS.gold,
              fillOpacity: 0.14,
            }}
          />
          <Marker
            position={{ lat: gpsCheck.site.lat, lng: gpsCheck.site.lng }}
            icon={{
              path: 0 as google.maps.SymbolPath,
              fillColor: MAP_COLORS.gold,
              fillOpacity: 0.92,
              strokeColor: MAP_COLORS.gold,
              strokeWeight: 2,
              scale: 7,
            }}
            title="Site"
          />
        </>
      ) : null}
      <Marker
        position={workerPos}
        icon={{
          path: 0 as google.maps.SymbolPath,
          fillColor: workerColor,
          fillOpacity: 0.92,
          strokeColor: workerColor,
          strokeWeight: 2,
          scale: 7,
        }}
        title="Your position"
      />
    </MapProvider>
  );
}
