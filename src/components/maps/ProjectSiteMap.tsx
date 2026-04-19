"use client";

import { Circle, Marker } from "@react-google-maps/api";
import { MapProvider } from "@/components/maps/GoogleMaps";
import type { WorkerGeoPoint } from "@/lib/worker-types";

const GOLD = "#BFA234";

export function ProjectSiteMap({
  site,
  radiusMeters,
}: {
  site: WorkerGeoPoint;
  radiusMeters: number;
}) {
  const center = { lat: site.lat, lng: site.lng };

  return (
    <MapProvider center={center} zoom={15}>
      <Circle
        center={center}
        radius={radiusMeters}
        options={{
          strokeColor: GOLD,
          strokeWeight: 2,
          fillColor: GOLD,
          fillOpacity: 0.18,
        }}
      />
      <Marker
        position={center}
        icon={{
          path: 0 as google.maps.SymbolPath,
          fillColor: GOLD,
          fillOpacity: 0.92,
          strokeColor: GOLD,
          strokeWeight: 2,
          scale: 8,
        }}
        title="Jobsite pin"
      />
    </MapProvider>
  );
}
