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

const WORKER_ROLE_COLOR: Record<string, string> = {
  driver: "#3b82f6",
  worker: "#2EA67A",
  supervisor: "#a855f7",
};

export type ActiveWorkerMarker = {
  id: string;
  name: string;
  role: string;
  projectName: string | null;
  lat: number;
  lng: number;
};

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
function makeDotIcon(color: string, scale = 8) {
  return {
    path: 0 as google.maps.SymbolPath,
    fillColor: color,
    fillOpacity: 0.92,
    strokeColor: color,
    strokeWeight: 2,
    scale,
  };
}

export function ProjectsStatusMap({
  projects,
  activeWorkers = [],
}: {
  projects: ManagerProjectSummary[];
  activeWorkers?: ActiveWorkerMarker[];
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

  const totalPoints = mappedProjects.length + activeWorkers.length;

  const center = useMemo(() => {
    if (mappedProjects.length > 0) {
      return { lat: mappedProjects[0].site.lat, lng: mappedProjects[0].site.lng };
    }
    if (activeWorkers.length > 0) {
      return { lat: activeWorkers[0].lat, lng: activeWorkers[0].lng };
    }
    return { lat: 37.7749, lng: -122.4194 };
  }, [mappedProjects, activeWorkers]);

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      if (totalPoints < 2) return;
      const bounds = new google.maps.LatLngBounds();
      for (const project of mappedProjects) {
        bounds.extend({ lat: project.site.lat, lng: project.site.lng });
      }
      for (const worker of activeWorkers) {
        bounds.extend({ lat: worker.lat, lng: worker.lng });
      }
      map.fitBounds(bounds, 28);
    },
    [mappedProjects, activeWorkers, totalPoints],
  );

  if (totalPoints === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-surface)] px-4 text-center text-sm text-[var(--text-secondary)]">
        Add project coordinates to start seeing live site coverage here.
      </div>
    );
  }

  return (
    <MapProvider
      center={center}
      zoom={totalPoints > 1 ? 11 : 14}
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
      {activeWorkers.map((worker) => {
        const color = WORKER_ROLE_COLOR[worker.role] ?? WORKER_ROLE_COLOR.worker;
        return (
          <Marker
            key={`active-${worker.id}`}
            position={{ lat: worker.lat, lng: worker.lng }}
            icon={makeDotIcon(color, 6)}
            title={
              worker.projectName
                ? `${worker.name} — ${worker.projectName}`
                : worker.name
            }
          />
        );
      })}
      <LiveWorkerMarkers />
      <StoreMarkers />
    </MapProvider>
  );
}
