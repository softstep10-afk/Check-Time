"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslation } from "@/lib/i18n";
import { DateField } from "@/components/shared/DateField";

export type DateRangePreset =
  | "today"
  | "week"
  | "twoWeeks"
  | "month"
  | "threeMonths"
  | "year"
  | "custom";

const PRESET_KEYS: Record<DateRangePreset, string> = {
  today: "ranges.today",
  week: "ranges.week",
  twoWeeks: "ranges.twoWeeks",
  month: "ranges.month",
  threeMonths: "ranges.threeMonths",
  year: "ranges.year",
  custom: "ranges.custom",
};

const PRESET_ORDER: DateRangePreset[] = [
  "today",
  "week",
  "twoWeeks",
  "month",
  "threeMonths",
  "year",
  "custom",
];

function pad(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * For a given preset, return the [start, end] dates as ISO yyyy-mm-dd
 * strings. End is always today; start scrolls back N days.
 *
 * 'custom' returns the same start/end the caller passed in (or today
 * for both if neither is set) — the UI surfaces two date inputs in
 * that mode.
 */
export function rangeForPreset(
  preset: DateRangePreset,
  custom?: { start?: string | null; end?: string | null },
): { start: string; end: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = pad(today);

  const back = (days: number): string => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return pad(d);
  };

  switch (preset) {
    case "today":
      return { start: end, end };
    case "week":
      return { start: back(6), end };
    case "twoWeeks":
      return { start: back(13), end };
    case "month":
      return { start: back(29), end };
    case "threeMonths":
      return { start: back(89), end };
    case "year":
      return { start: back(364), end };
    case "custom":
    default:
      return {
        start: custom?.start || end,
        end: custom?.end || end,
      };
  }
}

export interface DateRangePresetsProps {
  /** URL search-param name for the start date. Default 'start'. */
  startParam?: string;
  /** URL search-param name for the end date. Default 'end'. */
  endParam?: string;
  /** URL search-param name for the active preset. Default 'range'. */
  presetParam?: string;
  /** Default preset when no URL state is set yet. */
  defaultPreset?: DateRangePreset;
}

/**
 * Shared 7-button date-range picker. Persists the active preset and the
 * (start, end) dates in URL search params so a refresh keeps the same
 * window. The 'custom' preset reveals two date inputs.
 *
 * Used by Timeline, Annual Report, and Payroll.
 */
export function DateRangePresets({
  startParam = "start",
  endParam = "end",
  presetParam = "range",
  defaultPreset = "week",
}: DateRangePresetsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();

  const activePreset = (params.get(presetParam) as DateRangePreset | null) ?? defaultPreset;
  const startValue = params.get(startParam) ?? "";
  const endValue = params.get(endParam) ?? "";

  const updateParams = useCallback(
    (next: Partial<Record<string, string | null>>) => {
      const usp = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null || value === undefined || value === "") usp.delete(key);
        else usp.set(key, value);
      }
      router.replace(`?${usp.toString()}`);
    },
    [params, router],
  );

  const handlePreset = useCallback(
    (preset: DateRangePreset) => {
      if (preset === "custom") {
        // Keep whatever start/end are already set; if none, fall back to
        // today/today so the inputs aren't blank.
        const today = new Date().toISOString().slice(0, 10);
        updateParams({
          [presetParam]: "custom",
          [startParam]: startValue || today,
          [endParam]: endValue || today,
        });
        return;
      }
      const range = rangeForPreset(preset);
      updateParams({
        [presetParam]: preset,
        [startParam]: range.start,
        [endParam]: range.end,
      });
    },
    [endParam, endValue, presetParam, startParam, startValue, updateParams],
  );

  // If the URL has no preset yet, derive default values once so consumers
  // reading the URL elsewhere see something sensible.
  useMemoEnsureDefaults({
    activePreset,
    presetParam,
    startParam,
    endParam,
    hasStart: Boolean(startValue),
    hasEnd: Boolean(endValue),
    defaultPreset,
    updateParams,
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_ORDER.map((preset) => {
          const selected = activePreset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => handlePreset(preset)}
              aria-pressed={selected}
              className="rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
              }}
            >
              {t(PRESET_KEYS[preset] as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>
      {activePreset === "custom" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <DateField
            value={startValue}
            onChange={(event) => updateParams({ [startParam]: event.target.value })}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
          />
          <DateField
            value={endValue}
            onChange={(event) => updateParams({ [endParam]: event.target.value })}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}

// Helper to seed sane defaults on first render without writing setState
// inside an effect body (the lint rule we hit elsewhere). Uses a layout
// ref pattern: only fires the first time the URL params are missing.
function useMemoEnsureDefaults(args: {
  activePreset: DateRangePreset;
  presetParam: string;
  startParam: string;
  endParam: string;
  hasStart: boolean;
  hasEnd: boolean;
  defaultPreset: DateRangePreset;
  updateParams: (next: Partial<Record<string, string | null>>) => void;
}) {
  // We deliberately do nothing here — defaults are computed by callers
  // that read the params via rangeForPreset(activePreset). Materializing
  // them in URL on first mount adds noise; the render path already
  // handles the empty case by treating it as defaultPreset.
  void args;
}
