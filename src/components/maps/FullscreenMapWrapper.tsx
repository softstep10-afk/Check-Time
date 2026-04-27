"use client";

import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import {
  ProjectsStatusMap,
  type ActiveWorkerMarker,
} from "@/components/maps/ProjectsStatusMap";
import type { ManagerProjectSummary } from "@/lib/manager-types";

export function FullscreenMapWrapper({
  projects,
  activeWorkers = [],
}: {
  projects: ManagerProjectSummary[];
  activeWorkers?: ActiveWorkerMarker[];
}) {
  const [fullscreen, setFullscreen] = useState(false);

  // ONE <ProjectsStatusMap> mounted at a fixed JSX position. The outer
  // <div>'s className flips between inline (h-[220px]) and fullscreen
  // (fixed inset-0) styles — same DOM node, just CSS changes. The map's
  // container fills its parent via absolute inset-0 in both modes, so
  // Google Maps' built-in ResizeObserver handles the size change without
  // re-init / flicker. The header (fullscreen) and the open button
  // (inline) live as siblings of the map wrapper and only one is rendered
  // at a time — they're at different child indices so they never collide
  // with the map wrapper's identity in React reconciliation.
  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50"
          : "relative mt-4 h-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] md:h-[320px]"
      }
      style={fullscreen ? { background: "#0f1117" } : undefined}
    >
      {/* Map: always mounted at index 0, fills the outer div */}
      <div className="absolute inset-0">
        <ProjectsStatusMap
          projects={projects.filter((p) => p.status !== "completed")}
          activeWorkers={activeWorkers}
        />
      </div>

      {fullscreen ? (
        <div
          className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between px-4 py-2"
          style={{ background: "#181c27", borderBottom: "1px solid #2a3045" }}
        >
          <span className="font-bold text-[var(--text-primary)]">
            Карта объектов и бригады
          </span>
          <button
            type="button"
            onClick={() => setFullscreen(false)}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-semibold"
            style={{
              background: "rgba(239,68,68,0.15)",
              color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <X size={14} />
            Закрыть
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title="Развернуть карту"
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
          style={{
            background: "rgba(15,17,23,0.85)",
            color: "#f59e0b",
            border: "1px solid rgba(245,158,11,0.4)",
          }}
        >
          <Maximize2 size={13} />
          На весь экран
        </button>
      )}
    </div>
  );
}
