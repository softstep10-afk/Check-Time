"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n";

export const GPS_RADIUS_MIN = 25;
export const GPS_RADIUS_MAX = 300;
export const GPS_RADIUS_STEP = 5;
export const GPS_RADIUS_DEFAULT = 75;

export function GpsRadiusSlider({
  name = "gps_radius_m",
  defaultValue = GPS_RADIUS_DEFAULT,
}: {
  name?: string;
  defaultValue?: number | null;
}) {
  const { t } = useTranslation();
  const initial = clampRadius(defaultValue ?? GPS_RADIUS_DEFAULT);
  const [value, setValue] = useState<number>(initial);

  return (
    <label className="flex w-full flex-col gap-1.5">
      <span
        className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
        title={t("projects.checkinRadiusTip")}
      >
        <span>{t("projects.checkinRadius")}</span>
        <span className="font-mono text-sm font-bold normal-case tracking-normal text-[var(--brand-yellow)]">
          {value}m
        </span>
      </span>
      <input
        type="range"
        name={name}
        min={GPS_RADIUS_MIN}
        max={GPS_RADIUS_MAX}
        step={GPS_RADIUS_STEP}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        className="w-full"
        title={t("projects.checkinRadiusTip")}
      />
      <span className="flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        <span>{GPS_RADIUS_MIN}m</span>
        <span>{GPS_RADIUS_DEFAULT}m</span>
        <span>{GPS_RADIUS_MAX}m</span>
      </span>
    </label>
  );
}

export function clampRadius(value: number): number {
  if (!Number.isFinite(value)) return GPS_RADIUS_DEFAULT;
  if (value < GPS_RADIUS_MIN) return GPS_RADIUS_MIN;
  if (value > GPS_RADIUS_MAX) return GPS_RADIUS_MAX;
  return value;
}
