"use client";

import { useEffect, useMemo } from "react";
import { LogIn, LogOut, CheckCircle2, Camera, SlidersHorizontal, X } from "lucide-react";
import type { Media, Task } from "@/types/database";
import type { ManagerSession } from "@/lib/manager-types";
import type { WorkerAdjustmentItem } from "@/lib/worker-types";
import { useTranslation } from "@/lib/i18n";
import { formatDurationCompact, formatEventTime } from "@/lib/worker-utils";

type EventKind = "check_in" | "check_out" | "task_done" | "media" | "adjust";

type DayEvent = {
  id: string;
  kind: EventKind;
  timestamp: string;
  primary: string;
  secondary: string | null;
};

const ICON_FOR: Record<EventKind, typeof LogIn> = {
  check_in: LogIn,
  check_out: LogOut,
  task_done: CheckCircle2,
  media: Camera,
  adjust: SlidersHorizontal,
};

const COLOR_FOR: Record<EventKind, string> = {
  check_in: "var(--green)",
  check_out: "var(--red)",
  task_done: "var(--green)",
  media: "var(--brand-yellow)",
  adjust: "var(--text-muted)",
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function DayDetailModal({
  open,
  date,
  sessions,
  tasks,
  media,
  adjustments,
  onClose,
}: {
  open: boolean;
  date: string | null;
  sessions: ManagerSession[];
  tasks: Task[];
  media: Media[];
  adjustments: WorkerAdjustmentItem[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const daySessions = useMemo(() => {
    if (!date) return [];
    return sessions.filter((s) => dayKey(s.clockInTime) === date);
  }, [sessions, date]);

  const totalMinutes = useMemo(
    () => daySessions.reduce((sum, s) => sum + s.durationMinutes, 0),
    [daySessions],
  );

  const events: DayEvent[] = useMemo(() => {
    if (!date) return [];

    const out: DayEvent[] = [];

    for (const s of daySessions) {
      out.push({
        id: `in-${s.clockInEventId}`,
        kind: "check_in",
        timestamp: s.clockInTime,
        primary: t("dayDetail.checkIn"),
        secondary: s.projectName,
      });
      if (s.clockOutTime && s.clockOutEventId) {
        out.push({
          id: `out-${s.clockOutEventId}`,
          kind: "check_out",
          timestamp: s.clockOutTime,
          primary: t("dayDetail.checkOut"),
          secondary: `${s.projectName} · ${formatDurationCompact(s.durationMinutes)}`,
        });
      }
    }

    for (const task of tasks) {
      if (task.status !== "done" || !task.completed_at) continue;
      if (dayKey(task.completed_at) !== date) continue;
      out.push({
        id: `task-${task.id}`,
        kind: "task_done",
        timestamp: task.completed_at,
        primary: t("dayDetail.taskDone"),
        secondary: task.title,
      });
    }

    for (const item of media) {
      if (item.deleted_at) continue;
      if (dayKey(item.created_at) !== date) continue;
      out.push({
        id: `media-${item.id}`,
        kind: "media",
        timestamp: item.created_at,
        primary: t("dayDetail.mediaUploaded"),
        secondary: item.filename ?? item.media_type,
      });
    }

    for (const adj of adjustments) {
      if (dayKey(adj.eventTime) !== date) continue;
      const sign = adj.minutes >= 0 ? "+" : "−";
      out.push({
        id: `adj-${adj.id}`,
        kind: "adjust",
        timestamp: adj.eventTime,
        primary: t("dayDetail.adjustment"),
        secondary: `${sign}${formatDurationCompact(Math.abs(adj.minutes))}${adj.reason ? ` — ${adj.reason}` : ""}`,
      });
    }

    return out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }, [date, daySessions, tasks, media, adjustments, t]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !date) return null;

  const headline = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[520px] overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("dayDetail.title")}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-[var(--text-primary)]">{headline}</h2>
            {totalMinutes > 0 ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("dayDetail.duration")}:{" "}
                <span className="font-mono font-semibold text-[var(--brand-yellow)]">
                  {formatDurationCompact(totalMinutes)}
                </span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="max-h-[calc(85vh-100px)] space-y-1.5 overflow-y-auto p-4"
          style={{ scrollbarWidth: "thin" }}
        >
          {events.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
              {t("dayDetail.noEvents")}
            </div>
          ) : (
            events.map((event) => {
              const Icon = ICON_FOR[event.kind];
              const color = COLOR_FOR[event.kind];
              return (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
                  >
                    <Icon size={12} style={{ color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {event.primary}
                    </div>
                    {event.secondary ? (
                      <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                        {event.secondary}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
                    {formatEventTime(event.timestamp)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
