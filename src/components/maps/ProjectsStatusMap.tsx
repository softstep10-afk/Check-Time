"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Circle, Marker } from "@react-google-maps/api";
import { MapProvider } from "@/components/maps/GoogleMaps";
import { LiveWorkerMarkers } from "@/components/maps/LiveWorkerMarkers";
import { StoreMarkers } from "@/components/maps/StoreMarkers";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import type { WorkerGeoPoint } from "@/lib/worker-types";
import { parseGeoPoint } from "@/lib/worker-utils";

const MAP_COLORS = {
  gold: "#BFA234",
  green: "#2EA67A",
  gray: "#6B7280",
} as const;

function getMarkerColor(project: { status: string; onSiteWorkerCount: number }) {
  if (project.status === "paused" || project.status === "archived") {
    return MAP_COLORS.gray;
  }
  if (project.onSiteWorkerCount > 0) {
    return MAP_COLORS.green;
  }
  return MAP_COLORS.gold;
}

// google.maps.SymbolPath.CIRCLE === 0
function makeDotIcon(color: string) {
  return {
    path: 0 as google.maps.SymbolPath,
    fillColor: color,
    fillOpacity: 0.92,
    strokeColor: color,
    strokeWeight: 2,
    scale: 8,
  };
}

export function ProjectsStatusMap({
  projects,
}: {
  projects: ManagerProjectSummary[];
}) {
  const router = useRouter();

  const mappedProjects = useMemo(() => {
    return projects
      .map((project) => ({
        ...project,
        site: parseGeoPoint(project.site_point),
      }))
      .filter(
        (
          project,
        ): project is ManagerProjectSummary & { site: WorkerGeoPoint } =>
          project.site !== null,
      );
  }, [projects]);

  const center = useMemo(() => {
    if (mappedProjects.length === 0) return { lat: 37.7749, lng: -122.4194 };
    return { lat: mappedProjects[0].site.lat, lng: mappedProjects[0].site.lng };
  }, [mappedProjects]);

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      if (mappedProjects.length < 2) return;
      const bounds = new google.maps.LatLngBounds();
      for (const project of mappedProjects) {
        bounds.extend({ lat: project.site.lat, lng: project.site.lng });
      }
      map.fitBounds(bounds, 28);
    },
    [mappedProjects],
  );

  if (mappedProjects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-surface)] px-4 text-center text-sm text-[var(--text-secondary)]">
        Add project coordinates to start seeing live site coverage here.
      </div>
    );
  }

  return (
    <MapProvider
      center={center}
      zoom={mappedProjects.length > 1 ? 11 : 14}
      onLoad={handleLoad}
    >
      {mappedProjects.map((project) => {
        const color = getMarkerColor(project);
        return (
          <Marker
            key={project.id}
            position={{ lat: project.site.lat, lng: project.site.lng }}
            icon={makeDotIcon(color)}
            title={project.name}
            onClick={() => router.push(`/projects/${project.id}`)}
          />
        );
      })}
      <LiveWorkerMarkers />
      <StoreMarkers />
    </MapProvider>
  );
}
