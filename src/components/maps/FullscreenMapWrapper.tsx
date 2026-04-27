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

  return (
    <>
      {/* Normal inline map */}
      <div className="relative mt-4 h-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] md:h-[320px]">
        <ProjectsStatusMap
          projects={projects.filter((p) => p.status !== "completed")}
          activeWorkers={activeWorkers}
        />
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title="Развернуть карту"
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
          style={{ background: "rgba(15,17,23,0.85)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)" }}
        >
          <Maximize2 size={13} />
          На весь экран
        </button>
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: "#0f1117" }}
        >
          <div
            className="flex items-center justify-between px-4 py-2"
            style={{ background: "#181c27", borderBottom: "1px solid #2a3045" }}
          >
            <span className="font-bold text-[var(--text-primary)]">
              Карта объектов и бригады
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-semibold"
              style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              <X size={14} />
              Закрыть
            </button>
          </div>
          <div className="flex-1">
            <ProjectsStatusMap
              projects={projects.filter((p) => p.status !== "completed")}
            />
          </div>
        </div>
      )}
    </>
  );
}
