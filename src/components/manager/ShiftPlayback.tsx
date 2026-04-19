"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Polyline, Marker } from "@react-google-maps/api";
import { MapProvider } from "@/components/maps/GoogleMaps";
import { useTranslation } from "@/lib/i18n";

type TrailPoint = {
  lat: number;
  lng: number;
  recorded_at: string;
};

const SPEEDS = [1, 4, 16] as const;

export function ShiftPlayback({
  workerName,
  projectName,
  trail,
}: {
  workerName: string;
  projectName: string;
  trail: TrailPoint[];
}) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const speed = SPEEDS[speedIdx];

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || trail.length === 0) return;

    const intervalMs = Math.max(50, 1000 / speed);
    timerRef.current = setInterval(() => {
      setCursor((prev) => {
        if (prev >= trail.length - 1) {
          stop();
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, trail.length, stop]);

  if (trail.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
        No GPS trail data for this shift.
      </div>
    );
  }

  const currentPoint = trail[Math.min(cursor, trail.length - 1)];
  const pathSoFar = trail.slice(0, cursor + 1);
  const center = { lat: trail[0].lat, lng: trail[0].lng };

  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--text-secondary)]">
        <span className="font-semibold text-[var(--text-primary)]">{workerName}</span>
        {" — "}{projectName}
      </div>

      <div className="h-[280px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)]">
        <MapProvider center={center} zoom={15}>
          {/* Full trail (faded) */}
          <Polyline
            path={trail}
            options={{ strokeColor: "var(--text-muted)", strokeOpacity: 0.15, strokeWeight: 2 }}
          />
          {/* Animated trail */}
          {pathSoFar.length > 1 ? (
            <Polyline
              path={pathSoFar}
              options={{ strokeColor: "var(--brand-yellow)", strokeOpacity: 0.7, strokeWeight: 3 }}
            />
          ) : null}
          {/* Current position */}
          <Marker
            position={{ lat: currentPoint.lat, lng: currentPoint.lng }}
            icon={{
              path: 0 as google.maps.SymbolPath,
              fillColor: "var(--brand-yellow)",
              fillOpacity: 0.92,
              strokeColor: "var(--brand-yellow)",
              strokeWeight: 2,
              scale: 7,
            }}
            title={workerName}
          />
          {/* Start pin */}
          <Marker
            position={{ lat: trail[0].lat, lng: trail[0].lng }}
            icon={{
              path: 0 as google.maps.SymbolPath,
              fillColor: "var(--green)",
              fillOpacity: 0.8,
              strokeColor: "var(--green)",
              strokeWeight: 2,
              scale: 5,
            }}
            title="Start"
          />
          {/* End pin */}
          <Marker
            position={{ lat: trail[trail.length - 1].lat, lng: trail[trail.length - 1].lng }}
            icon={{
              path: 0 as google.maps.SymbolPath,
              fillColor: "var(--red)",
              fillOpacity: 0.8,
              strokeColor: "var(--red)",
              strokeWeight: 2,
              scale: 5,
            }}
            title="End"
          />
        </MapProvider>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (playing) {
              stop();
            } else {
              if (cursor >= trail.length - 1) setCursor(0);
              setPlaying(true);
            }
          }}
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>

        <button
          type="button"
          onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
          className="rounded-[var(--radius-sm)] border px-2 py-1 text-xs font-semibold"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
        >
          {speed}x
        </button>

        {/* Progress bar */}
        <div className="flex-1">
          <input
            type="range"
            min={0}
            max={trail.length - 1}
            value={cursor}
            onChange={(e) => {
              setCursor(Number(e.target.value));
              stop();
            }}
            className="w-full"
          />
        </div>

        <span className="whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
          {cursor + 1}/{trail.length}
        </span>
      </div>
    </div>
  );
}
