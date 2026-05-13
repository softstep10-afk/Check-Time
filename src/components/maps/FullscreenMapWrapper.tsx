"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import {
  ProjectsStatusMap,
  type ActiveWorkerMarker,
} from "@/components/maps/ProjectsStatusMap";
import {
  isPointInsideWashingtonBounds,
  isProjectOnActiveMap,
} from "@/lib/map-constants";
import { useTranslation } from "@/lib/i18n";
import { parseGeoPoint } from "@/lib/worker-utils";
import type { ManagerProjectSummary } from "@/lib/manager-types";

const COPY = {
  en: {
    title: "Projects and crew map",
    close: "Close",
    expand: "Fullscreen",
    expandTitle: "Open map fullscreen",
    shown: "shown",
    active: "active",
    noGps: "no GPS",
    outside: "outside WA",
  },
  ru: {
    title: "Карта объектов и бригады",
    close: "Закрыть",
    expand: "На весь экран",
    expandTitle: "Развернуть карту",
    shown: "на карте",
    active: "активных",
    noGps: "без GPS",
    outside: "вне WA",
  },
} as const;

export function FullscreenMapWrapper({
  projects,
  activeWorkers = [],
}: {
  projects: ManagerProjectSummary[];
  activeWorkers?: ActiveWorkerMarker[];
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const { locale } = useTranslation();
  const text = COPY[locale];

  // Active map should ignore archived/deleted/completed projects so the
  // manager only sees operational sites. ProjectsStatusMap also filters
  // defensively; the duplicate is intentional in case a future caller
  // passes its own dataset straight into ProjectsStatusMap.
  const filteredProjects = useMemo(
    () => projects.filter(isProjectOnActiveMap),
    [projects],
  );
  const coverage = useMemo(() => {
    let shown = 0;
    let outside = 0;
    let missing = 0;
    for (const project of filteredProjects) {
      const point = parseGeoPoint(project.site_point);
      if (!point) {
        missing += 1;
      } else if (isPointInsideWashingtonBounds(point)) {
        shown += 1;
      } else {
        outside += 1;
      }
    }
    return {
      active: filteredProjects.length,
      shown,
      missing,
      outside,
    };
  }, [filteredProjects]);

  // The fullscreen overlay is portaled into document.body so it escapes
  // any transform / filter / contain ancestor that would otherwise pin
  // a `position: fixed` element to the overview-page subtree. That kept
  // the app background visible behind the overlay (the flicker symptom).
  // Also: only one <ProjectsStatusMap> is mounted at a time — when
  // fullscreen flips, the inline instance unmounts before the portal
  // mounts, so we never run two GoogleMap + LiveWorkerMarkers in
  // parallel against the same Maps key / Supabase channel.
  const fullscreenOverlay = (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 9999, background: "#0f1117" }}
    >
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ background: "#181c27", borderBottom: "1px solid #2a3045" }}
      >
        <span className="flex flex-wrap items-center gap-2 font-bold text-[var(--text-primary)]">
          {text.title}
          <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
            {coverage.shown}/{coverage.active} {text.shown}
            {coverage.missing > 0 ? ` · ${coverage.missing} ${text.noGps}` : ""}
            {coverage.outside > 0 ? ` · ${coverage.outside} ${text.outside}` : ""}
          </span>
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
          {text.close}
        </button>
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-0">
          <ProjectsStatusMap
            projects={filteredProjects}
            activeWorkers={activeWorkers}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Inline map — only mounted when fullscreen is closed. */}
      <div className="relative mt-4 h-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] md:h-[320px]">
        {!fullscreen && (
          <ProjectsStatusMap
            projects={filteredProjects}
            activeWorkers={activeWorkers}
          />
        )}
        <div
          className="absolute left-2 top-2 z-10 flex max-w-[calc(100%-120px)] flex-wrap gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-semibold"
          style={{
            background: "rgba(15,17,23,0.86)",
            color: "var(--text-primary)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <span>
            {coverage.shown}/{coverage.active} {text.shown}
          </span>
          {coverage.missing > 0 ? (
            <span style={{ color: "#f59e0b" }}>
              {coverage.missing} {text.noGps}
            </span>
          ) : null}
          {coverage.outside > 0 ? (
            <span style={{ color: "#f59e0b" }}>
              {coverage.outside} {text.outside}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          title={text.expandTitle}
          className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold"
          style={{
            background: "rgba(15,17,23,0.85)",
            color: "#f59e0b",
            border: "1px solid rgba(245,158,11,0.4)",
          }}
        >
          <Maximize2 size={13} />
          {text.expand}
        </button>
      </div>

      {fullscreen && typeof document !== "undefined"
        ? createPortal(fullscreenOverlay, document.body)
        : null}
    </>
  );
}
