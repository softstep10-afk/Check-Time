"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { Project } from "@/types/database";

type CalProject = Project & {
  barColor: string;
  category: "active" | "upcoming" | "overdue" | "completed";
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function toDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function categorize(project: Project, today: Date): CalProject {
  const start = project.start_date ? toDate(project.start_date) : null;
  const end = project.end_date ? toDate(project.end_date) : null;

  if (project.status === "completed" || project.status === "archived") {
    return { ...project, barColor: "var(--text-muted)", category: "completed" };
  }
  if (end && end.getTime() < today.getTime()) {
    return { ...project, barColor: "#ef4444", category: "overdue" };
  }
  if (start && start.getTime() > today.getTime()) {
    return { ...project, barColor: "var(--blue)", category: "upcoming" };
  }
  return { ...project, barColor: "var(--green)", category: "active" };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number): number {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Monday = 0
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const { t, locale } = useTranslation();
  const [projects, setProjects] = useState<CalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const todayRef = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [viewYear, setViewYear] = useState(todayRef.getFullYear());
  const [viewMonth, setViewMonth] = useState(todayRef.getMonth());

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("projects")
        .select("*")
        .is("deleted_at", null)
        .order("name");
      const rows = (data as Project[] | null) ?? [];
      setProjects(rows.map((p) => categorize(p, todayRef)));
      setLoading(false);
    }
    void load();
  }, [supabase, todayRef]);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthNames =
    locale === "ru"
      ? ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"]
      : ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const monthLabel = `${monthNames[viewMonth]} ${viewYear}`;

  const totalDays = daysInMonth(viewYear, viewMonth);
  const startOffset = firstDayOfWeek(viewYear, viewMonth);
  const totalCells = startOffset + totalDays;
  const rows = Math.ceil(totalCells / 7);
  const todayStr = todayRef.toISOString().slice(0, 10);

  // Which projects span into this month?
  const monthStart = new Date(viewYear, viewMonth, 1);
  const monthEnd = new Date(viewYear, viewMonth, totalDays);
  const visibleProjects = projects.filter((p) => {
    if (!p.start_date && !p.end_date) return false;
    const s = p.start_date ? toDate(p.start_date) : monthStart;
    const e = p.end_date ? toDate(p.end_date) : monthEnd;
    return s.getTime() <= monthEnd.getTime() && e.getTime() >= monthStart.getTime();
  });

  // Build bars for the calendar
  function projectBarsForDay(day: number): CalProject[] {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = toDate(dateStr);
    return visibleProjects.filter((p) => {
      const s = p.start_date ? toDate(p.start_date) : monthStart;
      const e = p.end_date ? toDate(p.end_date) : monthEnd;
      return date.getTime() >= s.getTime() && date.getTime() <= e.getTime();
    });
  }

  const weekdaysFull =
    locale === "ru"
      ? ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"]
      : ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  const upcomingList = projects
    .filter((p) => p.category === "upcoming" || p.category === "active")
    .sort((a, b) => {
      const aStart = a.start_date ?? "9999";
      const bStart = b.start_date ?? "9999";
      return aStart.localeCompare(bStart);
    })
    .slice(0, 10);

  return (
    <div className="space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("nav.schedule")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("schedule.title")}
        </h1>
      </section>

      {/* Month navigation */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-lg font-bold text-[var(--text-primary)] capitalize">{monthLabel}</h2>
          <button
            type="button"
            onClick={nextMonth}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">Loading...</div>
        ) : (
          <div className="mt-4">
            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-px text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {weekdaysFull.map((d, i) => (
                <div key={i} className="py-2">{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div
              className="grid grid-cols-7 gap-px rounded-[var(--radius-md)] overflow-hidden"
              style={{ background: "var(--border-subtle)" }}
            >
              {Array.from({ length: rows * 7 }, (_, i) => {
                const dayNum = i - startOffset + 1;
                const isValid = dayNum >= 1 && dayNum <= totalDays;
                const dateStr = isValid
                  ? `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`
                  : "";
                const isToday = dateStr === todayStr;
                const bars = isValid ? projectBarsForDay(dayNum) : [];

                return (
                  <div
                    key={i}
                    className="min-h-[120px] p-1.5"
                    style={{
                      background: isToday
                        ? "rgba(191, 162, 52, 0.08)"
                        : "var(--bg-card)",
                    }}
                  >
                    {isValid ? (
                      <>
                        <div
                          className="text-right text-xs font-medium"
                          style={{
                            color: isToday ? "var(--brand-yellow)" : "var(--text-secondary)",
                          }}
                        >
                          {dayNum}
                        </div>
                        <div className="mt-0.5 space-y-0.5">
                          {bars.slice(0, 3).map((p) => (
                            <Link
                              key={p.id}
                              href={`/projects/${p.id}`}
                              className="block truncate rounded-sm px-1 text-[9px] font-medium leading-[16px]"
                              style={{
                                background: `${p.barColor}22`,
                                color: p.barColor,
                              }}
                              title={p.name}
                            >
                              {p.name}
                            </Link>
                          ))}
                          {bars.length > 3 ? (
                            <div className="px-1 text-[9px] text-[var(--text-muted)]">
                              +{bars.length - 3}
                            </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Legend */}
      <section className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--green)" }} />
          {t("common.active")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--blue)" }} />
          {t("schedule.upcoming")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#ef4444" }} />
          {t("schedule.overdue")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--text-muted)" }} />
          {t("common.completed")}
        </span>
      </section>

      {/* Upcoming project list */}
      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("schedule.upcoming")}</h2>
        <div className="mt-4 space-y-3">
          {upcomingList.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("schedule.noSchedule")}
            </div>
          ) : (
            upcomingList.map((project) => {
              const remaining = project.end_date
                ? daysBetween(todayRef, toDate(project.end_date))
                : null;
              const isOverdue = remaining !== null && remaining < 0;

              return (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="block rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{project.name}</div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {project.start_date ?? "—"} → {project.end_date ?? "—"}
                      </div>
                      {project.address ? (
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{project.address}</div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      {remaining !== null ? (
                        isOverdue ? (
                          <div className="text-xs font-semibold" style={{ color: "#ef4444" }}>
                            {t("schedule.overdueDays")} {Math.abs(remaining)} {t("schedule.days")}
                          </div>
                        ) : (
                          <div className="text-xs text-[var(--text-secondary)]">
                            <span className="font-semibold text-[var(--brand-yellow)]">{remaining}</span>{" "}
                            {t("schedule.daysRemaining")}
                          </div>
                        )
                      ) : null}
                      <div
                        className="mt-1 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{ background: `${project.barColor}22`, color: project.barColor }}
                      >
                        {project.status}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
