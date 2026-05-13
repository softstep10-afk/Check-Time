"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { InfoWindowF, MarkerF } from "@react-google-maps/api";
import { MapProvider } from "@/components/maps/GoogleMaps";
import { LiveWorkerMarkers } from "@/components/maps/LiveWorkerMarkers";
import { useTranslation } from "@/lib/i18n";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import type { WorkerGeoPoint } from "@/lib/worker-types";
import { parseGeoPoint } from "@/lib/worker-utils";
import {
  ACTIVE_MAP_MAX_ZOOM,
  ACTIVE_MAP_MIN_ZOOM,
  TRACKER_ROLE_COLOR,
  WASHINGTON_BOUNDS,
  classifyTrackerRole,
  isPointInsideWashingtonBounds,
  isProjectOnActiveMap,
  pickInitialMapCenter,
  pickInitialMapZoom,
  type TrackerRole,
} from "@/lib/map-constants";

const MAP_COLORS = {
  gold: "#BFA234",
  green: "#2EA67A",
  gray: "#6B7280",
} as const;

const COPY = {
  en: {
    onSite: "On site:",
    openTasks: "Open tasks:",
    openProject: "Open project →",
  },
  ru: {
    onSite: "На объекте:",
    openTasks: "Открытые задачи:",
    openProject: "Открыть проект →",
  },
} as const;

type ProjectMarkerTone = keyof typeof MAP_COLORS;

export type ActiveWorkerMarker = {
  id: string;
  name: string;
  role: string;
  projectName: string | null;
  lat: number;
  lng: number;
};

function getProjectMarkerTone(project: {
  status: string;
  onSiteWorkerCount: number;
}): ProjectMarkerTone {
  if (project.status === "paused" || project.status === "archived") {
    return "gray";
  }
  if (project.onSiteWorkerCount > 0) {
    return "green";
  }
  return "gold";
}

function makeProjectIcon(color: string, scale = 9) {
  return {
    path: 0 as google.maps.SymbolPath, // CIRCLE
    fillColor: color,
    fillOpacity: 0.92,
    strokeColor: "#0f1117",
    strokeWeight: 2,
    scale,
  };
}

// Worker / supervisor: filled circle. Driver: forward arrow so delivery
// runs read as movement, not a stationary worker. The arrow sits inside
// a white halo via the stroke so it stays legible on the dark basemap.
//
// Future tracker integrations (BLE/AirTag-style devices, vehicle GPS)
// should feed the same `LiveAssetMarker` shape and reuse these icons
// rather than introducing a separate marker family.
function makeRoleIcon(role: TrackerRole) {
  const color = TRACKER_ROLE_COLOR[role];
  if (role === "driver") {
    return {
      path: 1 as google.maps.SymbolPath, // FORWARD_CLOSED_ARROW
      fillColor: color,
      fillOpacity: 0.95,
      strokeColor: "#ffffff",
      strokeWeight: 1.5,
      scale: 5,
    };
  }
  return {
    path: 0 as google.maps.SymbolPath, // CIRCLE
    fillColor: color,
    fillOpacity: 0.9,
    strokeColor: role === "supervisor" ? "#ffffff" : "#0f1117",
    strokeWeight: role === "supervisor" ? 2 : 1.5,
    scale: role === "supervisor" ? 8 : 7,
  };
}

type ProjectWithSite = ManagerProjectSummary & { site: WorkerGeoPoint };
type MappedProject = ProjectWithSite & {
  site: WorkerGeoPoint;
  markerSite: WorkerGeoPoint;
};

function coordinateKey(point: WorkerGeoPoint): string {
  return `${point.lat.toFixed(5)}:${point.lng.toFixed(5)}`;
}

function spreadDuplicatePoint(
  point: WorkerGeoPoint,
  index: number,
  total: number,
): WorkerGeoPoint {
  if (total <= 1) return point;
  const angle = (Math.PI * 2 * index) / total;
  const radius = 0.0012 + Math.floor(index / 8) * 0.0004;
  return {
    lat: point.lat + Math.sin(angle) * radius,
    lng: point.lng + Math.cos(angle) * radius,
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
  const { locale } = useTranslation();
  const text = COPY[locale];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Filter archived/deleted/completed projects out of the active map so
  // the manager only sees what's operational. Archived projects live on
  // a dedicated archive page; they don't pollute live coverage.
  const mappedProjects = useMemo<MappedProject[]>(() => {
    const withSites = projects
      .filter(isProjectOnActiveMap)
      .map((project) => ({
        ...project,
        site: parseGeoPoint(project.site_point),
      }))
      .filter((project): project is ProjectWithSite => project.site !== null)
      .filter((project) => isPointInsideWashingtonBounds(project.site));
    const groupCounts = new Map<string, number>();
    for (const project of withSites) {
      const key = coordinateKey(project.site);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
    const groupIndexes = new Map<string, number>();
    return withSites.map((project) => {
      const key = coordinateKey(project.site);
      const index = groupIndexes.get(key) ?? 0;
      groupIndexes.set(key, index + 1);
      return {
        ...project,
        markerSite: spreadDuplicatePoint(project.site, index, groupCounts.get(key) ?? 1),
      };
    });
  }, [projects]);

  const totalPoints = mappedProjects.length + activeWorkers.length;

  const center = useMemo(
    () => pickInitialMapCenter(mappedProjects.map((p) => p.markerSite), activeWorkers),
    [mappedProjects, activeWorkers],
  );
  const initialZoom = pickInitialMapZoom(totalPoints);
  const projectIcons = useMemo(() => ({
    gold: makeProjectIcon(MAP_COLORS.gold),
    green: makeProjectIcon(MAP_COLORS.green),
    gray: makeProjectIcon(MAP_COLORS.gray),
  }), []);
  const roleIcons = useMemo(() => ({
    driver: makeRoleIcon("driver"),
    supervisor: makeRoleIcon("supervisor"),
    worker: makeRoleIcon("worker"),
  }), []);
  const mapOptions = useMemo<google.maps.MapOptions>(() => ({
    minZoom: ACTIVE_MAP_MIN_ZOOM,
    maxZoom: ACTIVE_MAP_MAX_ZOOM,
    clickableIcons: false,
    restriction: {
      latLngBounds: {
        // Restrict panning to a generous Pacific Northwest window so
        // the manager can't accidentally drift the map onto an empty
        // ocean / global view. The window is wider than the state so
        // a slight overscroll still feels natural.
        north: WASHINGTON_BOUNDS.north + 1.5,
        south: WASHINGTON_BOUNDS.south - 1.5,
        east: WASHINGTON_BOUNDS.east + 2,
        west: WASHINGTON_BOUNDS.west - 2,
      },
      strictBounds: false,
    },
  }), []);

  const handleLoad = useCallback(
    (map: google.maps.Map) => {
      if (totalPoints === 0) {
        // No points yet → frame Washington so the manager lands on a
        // recognizable region instead of a global view.
        map.fitBounds(
          new google.maps.LatLngBounds(
            { lat: WASHINGTON_BOUNDS.south, lng: WASHINGTON_BOUNDS.west },
            { lat: WASHINGTON_BOUNDS.north, lng: WASHINGTON_BOUNDS.east },
          ),
        );
        return;
      }
      if (totalPoints < 2) return;
      const bounds = new google.maps.LatLngBounds();
      for (const project of mappedProjects) {
        bounds.extend({ lat: project.markerSite.lat, lng: project.markerSite.lng });
      }
      for (const worker of activeWorkers) {
        bounds.extend({ lat: worker.lat, lng: worker.lng });
      }
      map.fitBounds(bounds, 32);
    },
    [mappedProjects, activeWorkers, totalPoints],
  );

  const selectedProject = useMemo(
    () =>
      selectedProjectId
        ? mappedProjects.find((p) => p.id === selectedProjectId) ?? null
        : null,
    [selectedProjectId, mappedProjects],
  );

  return (
    <MapProvider
      center={center}
      zoom={initialZoom}
      options={mapOptions}
      onLoad={handleLoad}
    >
      {mappedProjects.map((project) => {
        const tone = getProjectMarkerTone(project);
        return (
          <MarkerF
            key={project.id}
            position={{ lat: project.markerSite.lat, lng: project.markerSite.lng }}
            icon={projectIcons[tone]}
            title={project.name}
            onClick={() => setSelectedProjectId(project.id)}
          />
        );
      })}
      {activeWorkers.map((worker) => {
        const role = classifyTrackerRole(worker.role);
        return (
          <MarkerF
            key={`active-${worker.id}`}
            position={{ lat: worker.lat, lng: worker.lng }}
            icon={roleIcons[role]}
            title={
              worker.projectName
                ? `${worker.name} — ${worker.projectName}`
                : worker.name
            }
          />
        );
      })}
      {selectedProject ? (
        <InfoWindowF
          position={{
            lat: selectedProject.markerSite.lat,
            lng: selectedProject.markerSite.lng,
          }}
          onCloseClick={() => setSelectedProjectId(null)}
        >
          <div
            style={{
              background: "#181c27",
              color: "#f4f4f5",
              padding: "10px 12px",
              borderRadius: 8,
              minWidth: 200,
              maxWidth: 260,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
              {selectedProject.name}
            </div>
            {selectedProject.address ? (
              <div style={{ color: "#9ca3af", marginBottom: 6 }}>
                {selectedProject.address}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
              <span>
                <span style={{ color: "#9ca3af" }}>{text.onSite}</span>{" "}
                <strong>{selectedProject.onSiteWorkerCount}</strong>
              </span>
              <span>
                <span style={{ color: "#9ca3af" }}>{text.openTasks}</span>{" "}
                <strong>{selectedProject.openTaskCount}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/projects/${selectedProject.id}`)}
              style={{
                background: "#BFA234",
                color: "#0f1117",
                border: "none",
                borderRadius: 6,
                padding: "5px 10px",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {text.openProject}
            </button>
          </div>
        </InfoWindowF>
      ) : null}
      <LiveWorkerMarkers />
    </MapProvider>
  );
}
