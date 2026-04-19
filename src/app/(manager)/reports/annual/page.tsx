"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { Profile, Project, TimeEvent, Media } from "@/types/database";

// ── Types ──

type WorkerRow = {
  id: string;
  name: string;
  role: string;
  totalHours: number;
  otHours: number;
  grossPaid: number;
  projectCount: number;
  storeVisits: number;
  firstShift: string | null;
  lastShift: string | null;
  avgHoursPerDay: number;
};

type ProjectRow = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  laborHours: number;
  laborCost: number;
  materialCost: number;
  totalCost: number;
  workerCount: number;
};

type MonthData = {
  month: number;
  label: string;
  laborCost: number;
  materialCost: number;
  activeWorkers: number;
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function pct(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const delta = Math.round(((current - previous) / previous) * 100);
  return delta >= 0 ? `+${delta}%` : `${delta}%`;
}

export default function AnnualReportPage() {
  const supabase = useMemo(() => createClient(), []);
  const { t, locale } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);

  // Data
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [events, setEvents] = useState<TimeEvent[]>([]);
  const [receipts, setReceipts] = useState<Media[]>([]);
  const [tab, setTab] = useState<"workers" | "projects" | "monthly" | "stores">("workers");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const yearStart = `${year}-01-01T00:00:00`;
      const yearEnd = `${year}-12-31T23:59:59`;

      const [profilesRes, projectsRes, eventsRes, receiptsRes] = await Promise.all([
        supabase.from("profiles").select("*"),
        supabase.from("projects").select("*"),
        supabase.from("time_events").select("*").gte("event_time", yearStart).lte("event_time", yearEnd),
        supabase.from("media").select("*").eq("metadata->>category", "receipt").gte("created_at", yearStart).lte("created_at", yearEnd),
      ]);

      setProfiles((profilesRes.data as Profile[]) ?? []);
      setProjects((projectsRes.data as Project[]) ?? []);
      setEvents((eventsRes.data as TimeEvent[]) ?? []);
      setReceipts((receiptsRes.data as Media[]) ?? []);
      setLoading(false);
    }
    void load();
  }, [supabase, year]);

  // ── Compute summaries ──

  const workerRows = useMemo((): WorkerRow[] => {
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const hoursByWorker = new Map<string, { total: number; ot: number; gross: number; projects: Set<string>; days: Set<string>; first: string | null; last: string | null }>();

    // Pair clock_in → clock_out
    const sorted = [...events].filter((e) => e.event_type === "clock_in" || e.event_type === "clock_out" || e.event_type === "auto_out").sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
    const openShifts = new Map<string, TimeEvent>();

    for (const e of sorted) {
      if (e.event_type === "clock_in") {
        openShifts.set(e.profile_id, e);
        continue;
      }
      const clockIn = openShifts.get(e.profile_id);
      if (!clockIn) continue;
      openShifts.delete(e.profile_id);

      const minutes = Math.max(0, Math.round((new Date(e.event_time).getTime() - new Date(clockIn.event_time).getTime()) / 60_000));
      const hours = minutes / 60;
      const profile = profileMap.get(e.profile_id);
      const rate = Number(profile?.hourly_rate ?? 0);

      const entry = hoursByWorker.get(e.profile_id) ?? { total: 0, ot: 0, gross: 0, projects: new Set<string>(), days: new Set<string>(), first: null, last: null };
      entry.total += hours;
      entry.projects.add(e.project_id);
      entry.days.add(clockIn.event_time.slice(0, 10));
      if (!entry.first || clockIn.event_time < entry.first) entry.first = clockIn.event_time;
      if (!entry.last || e.event_time > entry.last) entry.last = e.event_time;

      // Simple OT: if total exceeds 40h/week boundary we'd need weekly bucketing.
      // For annual report, approximate: every hour above 2080 (40*52) is OT.
      hoursByWorker.set(e.profile_id, entry);
    }

    // Second pass: compute OT and gross
    return Array.from(hoursByWorker.entries()).map(([workerId, data]) => {
      const profile = profileMap.get(workerId);
      const rate = Number(profile?.hourly_rate ?? 0);
      const reg = Math.min(data.total, 2080);
      const ot = Math.max(0, data.total - 2080);
      const gross = Math.round((reg * rate + ot * rate * 1.5) * 100) / 100;
      const avgPerDay = data.days.size > 0 ? Math.round((data.total / data.days.size) * 10) / 10 : 0;

      return {
        id: workerId,
        name: profile?.name ?? "Unknown",
        role: profile?.role ?? "worker",
        totalHours: Math.round(data.total * 100) / 100,
        otHours: Math.round(ot * 100) / 100,
        grossPaid: gross,
        projectCount: data.projects.size,
        storeVisits: 0, // Would come from store_visits table
        firstShift: data.first,
        lastShift: data.last,
        avgHoursPerDay: avgPerDay,
      };
    }).sort((a, b) => b.totalHours - a.totalHours);
  }, [profiles, events]);

  const projectRows = useMemo((): ProjectRow[] => {
    const hoursByProject = new Map<string, { hours: number; cost: number; workers: Set<string> }>();
    const sorted = [...events].filter((e) => e.event_type === "clock_in" || e.event_type === "clock_out" || e.event_type === "auto_out").sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const openShifts = new Map<string, TimeEvent>();

    for (const e of sorted) {
      if (e.event_type === "clock_in") { openShifts.set(e.profile_id, e); continue; }
      const clockIn = openShifts.get(e.profile_id);
      if (!clockIn) continue;
      openShifts.delete(e.profile_id);

      const hours = Math.max(0, (new Date(e.event_time).getTime() - new Date(clockIn.event_time).getTime()) / 3_600_000);
      const rate = Number(profileMap.get(e.profile_id)?.hourly_rate ?? 0);
      const entry = hoursByProject.get(clockIn.project_id) ?? { hours: 0, cost: 0, workers: new Set<string>() };
      entry.hours += hours;
      entry.cost += hours * rate;
      entry.workers.add(e.profile_id);
      hoursByProject.set(clockIn.project_id, entry);
    }

    const receiptsByProject = new Map<string, number>();
    for (const r of receipts) {
      if (r.project_id) {
        const amt = Number((r.metadata as Record<string, unknown>)?.amount ?? 0);
        receiptsByProject.set(r.project_id, (receiptsByProject.get(r.project_id) ?? 0) + amt);
      }
    }

    return projects.map((p) => {
      const labor = hoursByProject.get(p.id);
      const matCost = receiptsByProject.get(p.id) ?? 0;
      const laborCost = Math.round((labor?.cost ?? 0) * 100) / 100;
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        status: p.status,
        startDate: p.start_date,
        endDate: p.end_date,
        laborHours: Math.round((labor?.hours ?? 0) * 100) / 100,
        laborCost,
        materialCost: Math.round(matCost * 100) / 100,
        totalCost: Math.round((laborCost + matCost) * 100) / 100,
        workerCount: labor?.workers.size ?? 0,
      };
    }).filter((p) => p.laborHours > 0 || p.materialCost > 0).sort((a, b) => b.totalCost - a.totalCost);
  }, [profiles, projects, events, receipts]);

  const monthlyData = useMemo((): MonthData[] => {
    const months = locale === "ru"
      ? ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]
      : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    const laborByMonth = new Array(12).fill(0);
    const workersByMonth = Array.from({ length: 12 }, () => new Set<string>());
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const sorted = [...events].filter((e) => e.event_type === "clock_in" || e.event_type === "clock_out" || e.event_type === "auto_out").sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
    const openShifts = new Map<string, TimeEvent>();

    for (const e of sorted) {
      if (e.event_type === "clock_in") { openShifts.set(e.profile_id, e); continue; }
      const clockIn = openShifts.get(e.profile_id);
      if (!clockIn) continue;
      openShifts.delete(e.profile_id);

      const month = new Date(clockIn.event_time).getMonth();
      const hours = Math.max(0, (new Date(e.event_time).getTime() - new Date(clockIn.event_time).getTime()) / 3_600_000);
      const rate = Number(profileMap.get(e.profile_id)?.hourly_rate ?? 0);
      laborByMonth[month] += hours * rate;
      workersByMonth[month].add(e.profile_id);
    }

    const materialByMonth = new Array(12).fill(0);
    for (const r of receipts) {
      const month = new Date(r.created_at).getMonth();
      materialByMonth[month] += Number((r.metadata as Record<string, unknown>)?.amount ?? 0);
    }

    return months.map((label, i) => ({
      month: i,
      label,
      laborCost: Math.round(laborByMonth[i] * 100) / 100,
      materialCost: Math.round(materialByMonth[i] * 100) / 100,
      activeWorkers: workersByMonth[i].size,
    }));
  }, [profiles, events, receipts, locale]);

  // ── Summary totals ──
  const summary = useMemo(() => {
    const totalHours = workerRows.reduce((s, w) => s + w.totalHours, 0);
    const totalGross = workerRows.reduce((s, w) => s + w.grossPaid, 0);
    const totalMaterials = receipts.reduce((s, r) => s + Number((r.metadata as Record<string, unknown>)?.amount ?? 0), 0);
    const totalProjectsWorked = projectRows.length;
    const completedProjects = projectRows.filter((p) => p.status === "completed").length;
    const activeWorkers = workerRows.length;
    return { totalHours, totalGross, totalMaterials, totalProjectsWorked, completedProjects, activeWorkers };
  }, [workerRows, projectRows, receipts]);

  // ── CSV export ──
  function exportWorkersCsv() {
    const headers = "Name,Role,Total Hours,OT Hours,Gross Paid,Projects,First Shift,Last Shift,Avg Hrs/Day";
    const rows = workerRows.map((w) => `"${w.name}","${w.role}",${w.totalHours},${w.otHours},${w.grossPaid},${w.projectCount},"${w.firstShift ?? ""}","${w.lastShift ?? ""}",${w.avgHoursPerDay}`);
    downloadCsv(`workers-${year}.csv`, [headers, ...rows].join("\n"));
  }

  function exportProjectsCsv() {
    const headers = "Name,Address,Status,Start,End,Labor Hours,Labor Cost,Material Cost,Total Cost,Workers";
    const rows = projectRows.map((p) => `"${p.name}","${p.address ?? ""}","${p.status}","${p.startDate ?? ""}","${p.endDate ?? ""}",${p.laborHours},${p.laborCost},${p.materialCost},${p.totalCost},${p.workerCount}`);
    downloadCsv(`projects-${year}.csv`, [headers, ...rows].join("\n"));
  }

  function downloadCsv(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const hasData = events.length > 0 || receipts.length > 0;
  const maxBar = Math.max(...monthlyData.map((m) => m.laborCost + m.materialCost), 1);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("report.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("report.title")} {year}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("report.description")}
        </p>
      </section>

      {/* Year picker + export */}
      <section className="flex flex-wrap items-center gap-3">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <button type="button" onClick={exportWorkersCsv} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
          <Download size={13} />
          {t("report.exportCsv")}
        </button>
      </section>

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">Loading...</div>
      ) : !hasData ? (
        <div className="surface-card p-8 text-center text-sm text-[var(--text-secondary)]">
          {t("report.emptyYear")}
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalHours")}</div>
              <div className="mt-2 text-[24px] font-bold text-[var(--text-primary)]">{Math.round(summary.totalHours).toLocaleString()}h</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalPayroll")}</div>
              <div className="mt-2 text-[24px] font-bold text-[var(--text-primary)]">{currency.format(summary.totalGross)}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalMaterials")}</div>
              <div className="mt-2 text-[24px] font-bold text-[var(--text-primary)]">
                {summary.totalMaterials > 0 ? currency.format(summary.totalMaterials) : (
                  <span className="text-base text-[var(--text-muted)]">{t("report.noData")}</span>
                )}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalProjects")}</div>
              <div className="mt-2 text-[24px] font-bold text-[var(--text-primary)]">{summary.totalProjectsWorked}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{summary.completedProjects} {t("common.completed").toLowerCase()}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.activeWorkers")}</div>
              <div className="mt-2 text-[24px] font-bold text-[var(--text-primary)]">{summary.activeWorkers}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalVisits")}</div>
              <div className="mt-2 text-base text-[var(--text-muted)]">{t("report.noData")}</div>
            </div>
          </section>

          {/* Tab switcher */}
          <section className="flex gap-1">
            {(["workers", "projects", "monthly", "stores"] as const).map((tb) => (
              <button key={tb} type="button" onClick={() => setTab(tb)} className="rounded-t-[var(--radius-md)] px-4 py-2 text-sm font-semibold" style={{ background: tab === tb ? "var(--bg-card)" : "transparent", color: tab === tb ? "var(--text-primary)" : "var(--text-muted)" }}>
                {t(`report.${tb === "workers" ? "perWorker" : tb === "projects" ? "perProject" : tb === "monthly" ? "monthlyBreakdown" : "storeActivity"}` as Parameters<typeof t>[0])}
              </button>
            ))}
          </section>

          {/* Tab content */}
          {tab === "workers" ? (
            <section className="surface-card overflow-x-auto p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("report.perWorker")}</h2>
                <button type="button" onClick={exportWorkersCsv} className="text-xs font-semibold text-[var(--brand-yellow)]">{t("payroll.exportCsv")}</button>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th className="pb-3 pr-3 font-semibold">{t("overview.colName")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.regHours")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.otHours")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.grossPay")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.totalProjects")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.avgHoursPerDay")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.firstShift")}</th>
                    <th className="pb-3 font-semibold">{t("report.lastShift")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workerRows.map((w) => (
                    <tr key={w.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-[var(--text-primary)]">{w.name}</div>
                        <span className="mt-0.5 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}>{w.role}</span>
                      </td>
                      <td className="py-3 pr-3 text-[var(--text-primary)]">{w.totalHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3" style={{ color: w.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{w.otHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 font-semibold text-[var(--text-primary)]">{currency.format(w.grossPaid)}</td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{w.projectCount}</td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{w.avgHoursPerDay}h</td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">{w.firstShift?.slice(0, 10) ?? "—"}</td>
                      <td className="py-3 whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">{w.lastShift?.slice(0, 10) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : tab === "projects" ? (
            <section className="surface-card overflow-x-auto p-4">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("report.perProject")}</h2>
                <button type="button" onClick={exportProjectsCsv} className="text-xs font-semibold text-[var(--brand-yellow)]">{t("payroll.exportCsv")}</button>
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th className="pb-3 pr-3 font-semibold">{t("overview.colProject")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.totalHours")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.laborCost")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.materialCost")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("report.totalCost")}</th>
                    <th className="pb-3 font-semibold">{t("payroll.workers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {projectRows.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-[var(--text-primary)]">{p.name}</div>
                        {p.address ? <div className="mt-0.5 text-xs text-[var(--text-muted)]">{p.address}</div> : null}
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{p.startDate ?? "—"} → {p.endDate ?? t("report.ongoing")}</div>
                      </td>
                      <td className="py-3 pr-3 text-[var(--text-primary)]">{p.laborHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 text-[var(--text-primary)]">{currency.format(p.laborCost)}</td>
                      <td className="py-3 pr-3 text-[var(--text-primary)]">{p.materialCost > 0 ? currency.format(p.materialCost) : "—"}</td>
                      <td className="py-3 pr-3 font-bold text-[var(--brand-yellow)]">{currency.format(p.totalCost)}</td>
                      <td className="py-3 text-[var(--text-secondary)]">{p.workerCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : tab === "monthly" ? (
            <section className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("report.monthlyBreakdown")}</h2>
              <div className="mt-4 space-y-2">
                {monthlyData.map((m) => {
                  const total = m.laborCost + m.materialCost;
                  const barWidth = maxBar > 0 ? (total / maxBar) * 100 : 0;
                  const laborPct = total > 0 ? (m.laborCost / total) * 100 : 0;
                  return (
                    <div key={m.month} className="flex items-center gap-3">
                      <div className="w-8 shrink-0 text-xs font-semibold text-[var(--text-muted)]">{m.label}</div>
                      <div className="flex-1">
                        <div className="h-6 overflow-hidden rounded-[var(--radius-sm)]" style={{ background: "var(--bg-primary)", width: `${Math.max(barWidth, 2)}%` }}>
                          <div className="flex h-full">
                            <div style={{ width: `${laborPct}%`, background: "var(--brand-yellow)" }} />
                            <div style={{ width: `${100 - laborPct}%`, background: "var(--blue)" }} />
                          </div>
                        </div>
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs text-[var(--text-secondary)]">
                        {currency.format(total)}
                      </div>
                      <div className="w-12 shrink-0 text-right text-xs text-[var(--text-muted)]">
                        {m.activeWorkers}w
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex gap-4 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--brand-yellow)" }} />
                  {t("report.laborCost")}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--blue)" }} />
                  {t("report.materialCost")}
                </span>
              </div>
            </section>
          ) : (
            <section className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("report.storeActivity")}</h2>
              <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
                {t("report.noData")}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
