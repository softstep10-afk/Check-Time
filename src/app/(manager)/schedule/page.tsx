"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime, formatDurationCompact } from "@/lib/worker-utils";
import type { Profile, TimeEvent } from "@/types/database";

function startOfWeekMonday(input: Date): Date {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

type SessionLike = {
  profileId: string;
  projectId: string | null;
  projectName: string | null;
  clockIn: string;
  clockOut: string | null;
  minutes: number;
  partial: boolean;
};

type CellKey = `${string}__${string}`; // profileId__YYYY-MM-DD

type CellDetail = {
  profileId: string;
  profileName: string;
  dayIso: string;
  sessions: SessionLike[];
  totalMinutes: number;
};

function keyFor(profileId: string, dayIso: string): CellKey {
  return `${profileId}__${dayIso}` as CellKey;
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const { t, locale } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<TimeEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CellDetail | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeekMonday(new Date()));
  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const weekEndExclusive = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [profilesRes, eventsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("*")
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .returns<Profile[]>(),
        supabase
          .from("time_events")
          .select("*")
          .gte("event_time", weekStart.toISOString())
          .lt("event_time", weekEndExclusive.toISOString())
          .order("event_time", { ascending: true })
          .returns<TimeEvent[]>(),
      ]);
      if (cancelled) return;
      setProfiles(profilesRes.data ?? []);
      setEvents(eventsRes.data ?? []);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, weekStart, weekEndExclusive]);

  // Fetch project names referenced by the visible events once per week.
  // Keyed by the stringified list of distinct project ids so the effect only
  // re-fires when the set of visible projects actually changes (not every
  // event tick).
  const projectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) if (e.project_id) ids.add(e.project_id);
    return [...ids].sort().join(",");
  }, [events]);

  const [projectNames, setProjectNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    if (!projectIdsKey) {
      // Defer so the write doesn't happen synchronously inside render/effect.
      const t = setTimeout(() => {
        if (!cancelled) setProjectNames(new Map());
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    async function load() {
      const ids = projectIdsKey.split(",");
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .in("id", ids);
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
        map.set(row.id, row.name);
      }
      setProjectNames(map);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, projectIdsKey]);

  const sessionsByKey = useMemo(() => {
    const result = new Map<CellKey, SessionLike[]>();
    const byProfile = new Map<string, TimeEvent[]>();
    for (const e of events) {
      if (e.event_type !== "clock_in" && e.event_type !== "clock_out" && e.event_type !== "auto_out") continue;
      const list = byProfile.get(e.profile_id) ?? [];
      list.push(e);
      byProfile.set(e.profile_id, list);
    }
    for (const [profileId, evs] of byProfile) {
      // evs already ordered ascending by event_time from the query.
      let openIn: TimeEvent | null = null;
      for (const ev of evs) {
        if (ev.event_type === "clock_in") {
          if (openIn) {
            // Unclosed previous clock_in (partial) — capture as partial.
            const day = openIn.event_time.slice(0, 10);
            const k = keyFor(profileId, day);
            const arr = result.get(k) ?? [];
            arr.push({
              profileId,
              projectId: openIn.project_id,
              projectName: projectNames.get(openIn.project_id) ?? null,
              clockIn: openIn.event_time,
              clockOut: null,
              minutes: 0,
              partial: true,
            });
            result.set(k, arr);
          }
          openIn = ev;
        } else if (openIn) {
          const minutes = Math.max(
            0,
            Math.round((new Date(ev.event_time).getTime() - new Date(openIn.event_time).getTime()) / 60_000),
          );
          const day = openIn.event_time.slice(0, 10);
          const k = keyFor(profileId, day);
          const arr = result.get(k) ?? [];
          arr.push({
            profileId,
            projectId: openIn.project_id,
            projectName: projectNames.get(openIn.project_id) ?? null,
            clockIn: openIn.event_time,
            clockOut: ev.event_time,
            minutes,
            partial: false,
          });
          result.set(k, arr);
          openIn = null;
        }
      }
      if (openIn) {
        // Still-open session at week end.
        const day = openIn.event_time.slice(0, 10);
        const k = keyFor(profileId, day);
        const arr = result.get(k) ?? [];
        arr.push({
          profileId,
          projectId: openIn.project_id,
          projectName: projectNames.get(openIn.project_id) ?? null,
          clockIn: openIn.event_time,
          clockOut: null,
          minutes: 0,
          partial: true,
        });
        result.set(k, arr);
      }
    }
    return result;
  }, [events, projectNames]);

  const days = useMemo(() => {
    const weekdayLabels =
      locale === "ru"
        ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const out: { date: Date; iso: string; label: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      out.push({
        date: d,
        iso: isoDay(d),
        label: `${weekdayLabels[i]} ${d.getDate()}`,
      });
    }
    return out;
  }, [weekStart, locale]);

  const cellSummary = useCallback(
    (profileId: string, iso: string) => {
      const list = sessionsByKey.get(keyFor(profileId, iso)) ?? [];
      let totalMinutes = 0;
      let partial = false;
      for (const s of list) {
        totalMinutes += s.minutes;
        if (s.partial) partial = true;
      }
      return { totalMinutes, partial, sessions: list };
    },
    [sessionsByKey],
  );

  function openDetail(profile: Profile, iso: string) {
    const { totalMinutes, sessions } = cellSummary(profile.id, iso);
    if (sessions.length === 0) return;
    setSelected({
      profileId: profile.id,
      profileName: profile.name,
      dayIso: iso,
      sessions,
      totalMinutes,
    });
  }

  const dailyTotals = useMemo(() => {
    return days.map((d) => {
      let total = 0;
      for (const p of profiles) total += cellSummary(p.id, d.iso).totalMinutes;
      return total;
    });
  }, [days, profiles, cellSummary]);

  const weekLabel = `${weekStart.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")} – ${weekEnd.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US")}`;
  const isThisWeek = weekStart.getTime() === startOfWeekMonday(today).getTime();

  return (
    <div className="space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("nav.schedule")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("schedule.weeklyTitle")}
        </h1>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, -7))}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)]"
            style={{ color: "var(--text-secondary)" }}
            aria-label={t("schedule.prevWeek")}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{weekLabel}</h2>
            {!isThisWeek ? (
              <button
                type="button"
                onClick={() => setWeekStart(startOfWeekMonday(today))}
                className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                {t("schedule.thisWeek")}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setWeekStart((d) => addDays(d, 7))}
            className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)]"
            style={{ color: "var(--text-secondary)" }}
            aria-label={t("schedule.nextWeek")}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {loading ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : profiles.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("schedule.noCrew")}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]"
                  style={{ borderBottom: "1px solid var(--border-default)" }}
                >
                  <th className="py-2 pr-3 font-semibold">{t("common.crew")}</th>
                  {days.map((d) => (
                    <th key={d.iso} className="py-2 pr-2 font-semibold">{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-[var(--border-subtle)]">
                    <td className="py-2 pr-3 text-sm font-semibold text-[var(--text-primary)]">
                      {profile.name}
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                        {profile.role}
                      </div>
                    </td>
                    {days.map((d) => {
                      const { totalMinutes, partial, sessions } = cellSummary(profile.id, d.iso);
                      const hasShift = sessions.length > 0;
                      const bg = !hasShift
                        ? "transparent"
                        : partial
                          ? "rgba(245, 158, 11, 0.18)"
                          : "rgba(15, 168, 120, 0.18)";
                      const color = !hasShift
                        ? "var(--text-muted)"
                        : partial
                          ? "#f59e0b"
                          : "var(--green)";
                      const firstProject = sessions[0]?.projectName ?? "";
                      return (
                        <td key={d.iso} className="py-1 pr-2">
                          <button
                            type="button"
                            onClick={() => openDetail(profile, d.iso)}
                            disabled={!hasShift}
                            className="block w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left"
                            style={{ background: bg, color, cursor: hasShift ? "pointer" : "default" }}
                          >
                            {hasShift ? (
                              <>
                                <div className="font-mono text-xs font-bold">
                                  {formatDurationCompact(totalMinutes)}
                                </div>
                                {firstProject ? (
                                  <div className="truncate text-[10px] opacity-80">
                                    {firstProject}
                                    {sessions.length > 1 ? ` +${sessions.length - 1}` : ""}
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <span className="text-[10px]">—</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr
                  className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]"
                  style={{ borderTop: "1px solid var(--border-default)" }}
                >
                  <td className="py-2 pr-3 font-semibold text-[var(--text-primary)]">
                    {t("schedule.dailyTotal")}
                  </td>
                  {dailyTotals.map((m, i) => (
                    <td key={i} className="py-2 pr-2 font-mono text-xs font-bold text-[var(--text-primary)]">
                      {m > 0 ? formatDurationCompact(m) : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(15, 168, 120, 0.18)" }} />
            {t("schedule.legendWorked")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(245, 158, 11, 0.18)" }} />
            {t("schedule.legendPartial")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm border border-[var(--border-default)]" />
            {t("schedule.legendEmpty")}
          </span>
        </div>
      </section>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setSelected(null)}
        >
          <div
            className="surface-card w-full max-w-[520px] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">
                  {selected.profileName}
                </h2>
                <div className="text-xs text-[var(--text-muted)]">{selected.dayIso}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="mt-3 text-sm text-[var(--text-primary)]">
              {t("schedule.dayTotal")}:{" "}
              <span className="font-mono font-bold">{formatDurationCompact(selected.totalMinutes)}</span>
            </div>
            <div className="mt-3 space-y-2">
              {selected.sessions.map((s, idx) => (
                <div
                  key={`${s.clockIn}-${idx}`}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {s.projectName ?? t("common.projectNotResolved")}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    <div>{t("schedule.clockIn")}: {formatDateTime(s.clockIn)}</div>
                    <div>
                      {t("schedule.clockOut")}:{" "}
                      {s.clockOut ? formatDateTime(s.clockOut) : <span style={{ color: "#f59e0b" }}>{t("schedule.openShift")}</span>}
                    </div>
                  </div>
                  <div className="mt-2 font-mono text-sm font-bold text-[var(--text-primary)]">
                    {formatDurationCompact(s.minutes)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
