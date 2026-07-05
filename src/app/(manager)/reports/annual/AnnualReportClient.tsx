"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { summarizeAnnualPaidPayroll } from "@/lib/annual-report-utils";
import { useTranslation } from "@/lib/i18n";
import type { PayrollArchiveSummary } from "@/lib/archive-utils";
import type { Profile, Project } from "@/types/database";

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

type AnnualProfile = Pick<Profile, "id" | "name" | "role">;
type AnnualProject = Pick<Project, "id" | "name" | "address" | "status" | "start_date" | "end_date">;
type AnnualWorkerHours = {
  workerId: string;
  totalHours: number;
  projectCount: number;
  dayCount: number;
  firstShift: string | null;
  lastShift: string | null;
};
type AnnualProjectHours = {
  projectId: string;
  laborHours: number;
  workerCount: number;
};
type AnnualReceiptProject = {
  projectId: string;
  materialCost: number;
};
type AnnualStoreBreakdown = {
  stores: Array<{ name: string; chain: string; visits: number; minutes: number }>;
  chains: Array<{ name: string; visits: number; minutes: number }>;
  workers: Array<{ name: string; visits: number; minutes: number }>;
};
type AnnualReportData = {
  profiles: AnnualProfile[];
  projects: AnnualProject[];
  workerHours: AnnualWorkerHours[];
  projectHours: AnnualProjectHours[];
  activeWorkerCountsByMonth: number[];
  receiptsByProject: AnnualReceiptProject[];
  materialByMonth: number[];
  totalMaterials: number;
  visitsByWorker: Array<{ workerId: string; visits: number }>;
  totalVisits: number;
  totalVisitMinutes: number;
  storeBreakdown: AnnualStoreBreakdown;
  sourceRowCounts: {
    profiles: number;
    projects: number;
    timeEvents: number;
    receipts: number;
    storeVisits: number;
  };
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function emptyAnnualReportData(): AnnualReportData {
  return {
    profiles: [],
    projects: [],
    workerHours: [],
    projectHours: [],
    activeWorkerCountsByMonth: new Array<number>(12).fill(0),
    receiptsByProject: [],
    materialByMonth: new Array<number>(12).fill(0),
    totalMaterials: 0,
    visitsByWorker: [],
    totalVisits: 0,
    totalVisitMinutes: 0,
    storeBreakdown: { stores: [], chains: [], workers: [] },
    sourceRowCounts: {
      profiles: 0,
      projects: 0,
      timeEvents: 0,
      receipts: 0,
      storeVisits: 0,
    },
  };
}

export function AnnualReportClient({
  paidPayrollArchive,
}: {
  paidPayrollArchive: PayrollArchiveSummary;
}) {
  const { t, locale } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);

  const [annualData, setAnnualData] = useState<AnnualReportData>(() => emptyAnnualReportData());
  const [tab, setTab] = useState<"workers" | "projects" | "monthly" | "stores">("workers");

  const annualPayroll = useMemo(
    () => summarizeAnnualPaidPayroll(paidPayrollArchive, year),
    [paidPayrollArchive, year],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/reports/annual?year=${year}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as AnnualReportData | { error: string } | null;

        if (cancelled) return;
        if (!response.ok || !payload || "error" in payload) {
          setAnnualData(emptyAnnualReportData());
        } else {
          setAnnualData(payload);
        }
      } catch {
        if (cancelled) return;
        setAnnualData(emptyAnnualReportData());
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [year]);

  // ── Compute summaries ──

  const profiles = annualData.profiles;
  const projects = annualData.projects;

  const visitsByWorker = useMemo(() => {
    return new Map(annualData.visitsByWorker.map((row) => [row.workerId, row.visits]));
  }, [annualData.visitsByWorker]);

  const workerRows = useMemo((): WorkerRow[] => {
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const hoursByWorker = new Map(annualData.workerHours.map((row) => [row.workerId, row]));

    const rows: WorkerRow[] = annualData.workerHours.map((data) => {
      const workerId = data.workerId;
      const profile = profileMap.get(workerId);
      const ot = Math.max(0, data.totalHours - 2080);
      const paid = annualPayroll.workerPayById.get(workerId);
      const avgPerDay = data.dayCount > 0 ? Math.round((data.totalHours / data.dayCount) * 10) / 10 : 0;

      return {
        id: workerId,
        name: profile?.name ?? "Unknown",
        role: profile?.role ?? "worker",
        totalHours: Math.round((data.totalHours || paid?.paidHours || 0) * 100) / 100,
        otHours: Math.round(ot * 100) / 100,
        grossPaid: paid?.grossPaid ?? 0,
        projectCount: data.projectCount || paid?.projectNames.length || 0,
        storeVisits: visitsByWorker.get(workerId) ?? 0,
        firstShift: data.firstShift,
        lastShift: data.lastShift,
        avgHoursPerDay: avgPerDay,
      };
    });

    for (const paid of annualPayroll.workerPayById.values()) {
      if (hoursByWorker.has(paid.workerId)) continue;
      rows.push({
        id: paid.workerId,
        name: paid.workerName,
        role: paid.workerRole,
        totalHours: paid.paidHours,
        otHours: 0,
        grossPaid: paid.grossPaid,
        projectCount: paid.projectNames.length,
        storeVisits: visitsByWorker.get(paid.workerId) ?? 0,
        firstShift: null,
        lastShift: null,
        avgHoursPerDay: 0,
      });
    }

    return rows.sort((a, b) => b.grossPaid - a.grossPaid || b.totalHours - a.totalHours);
  }, [annualData.workerHours, annualPayroll, profiles, visitsByWorker]);

  const projectRows = useMemo((): ProjectRow[] => {
    const hoursByProject = new Map(annualData.projectHours.map((row) => [row.projectId, row]));
    const receiptsByProject = new Map(
      annualData.receiptsByProject.map((row) => [row.projectId, row.materialCost]),
    );

    return projects.map((p) => {
      const labor = hoursByProject.get(p.id);
      const matCost = receiptsByProject.get(p.id) ?? 0;
      const laborCost = Math.round((annualPayroll.projectPayByName.get(p.name) ?? 0) * 100) / 100;
      return {
        id: p.id,
        name: p.name,
        address: p.address,
        status: p.status,
        startDate: p.start_date,
        endDate: p.end_date,
        laborHours: Math.round((labor?.laborHours ?? 0) * 100) / 100,
        laborCost,
        materialCost: Math.round(matCost * 100) / 100,
        totalCost: Math.round((laborCost + matCost) * 100) / 100,
        workerCount: labor?.workerCount ?? 0,
      };
    }).filter((p) => p.laborHours > 0 || p.laborCost > 0 || p.materialCost > 0).sort((a, b) => b.totalCost - a.totalCost);
  }, [annualData.projectHours, annualData.receiptsByProject, annualPayroll, projects]);

  const monthlyData = useMemo((): MonthData[] => {
    const months = locale === "ru"
      ? ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"]
      : ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    return months.map((label, i) => ({
      month: i,
      label,
      laborCost: annualPayroll.laborCostByMonth[i],
      materialCost: Math.round((annualData.materialByMonth[i] ?? 0) * 100) / 100,
      activeWorkers: Math.max(
        annualData.activeWorkerCountsByMonth[i] ?? 0,
        annualPayroll.paidWorkerIdsByMonth[i].size,
      ),
    }));
  }, [annualData.activeWorkerCountsByMonth, annualData.materialByMonth, annualPayroll, locale]);

  // ── Summary totals ──
  const summary = useMemo(() => {
    const totalHours = workerRows.reduce((s, w) => s + w.totalHours, 0);
    const totalGross = annualPayroll.totalGross;
    const totalMaterials = annualData.totalMaterials;
    const totalProjectsWorked = projectRows.length;
    const completedProjects = projectRows.filter((p) => p.status === "completed").length;
    const activeWorkers = workerRows.length;
    const totalVisits = annualData.totalVisits;
    const totalVisitMinutes = annualData.totalVisitMinutes;
    return {
      totalHours,
      totalGross,
      totalMaterials,
      totalProjectsWorked,
      completedProjects,
      activeWorkers,
      totalVisits,
      totalVisitMinutes,
    };
  }, [annualData.totalMaterials, annualData.totalVisitMinutes, annualData.totalVisits, annualPayroll, workerRows, projectRows]);

  // ── Store breakdowns for the Stores tab ──
  const storeBreakdown = annualData.storeBreakdown;

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

  async function exportAnnualPdf() {
    // jspdf + jspdf-autotable ship as CJS defaults; dynamic import keeps
    // them off the initial bundle and out of the SSR path. The
    // autotable module mutates the jsPDF prototype on import, so it has
    // to load after jsPDF itself.
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const darkBg: [number, number, number] = [30, 35, 51];
    const ink: [number, number, number] = [241, 245, 249];
    const goldHex = "#f59e0b";
    const generated = new Date().toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { hourCycle: "h23" });

    function paintPage() {
      doc.setFillColor(...darkBg);
      doc.rect(0, 0, pageWidth, pageHeight, "F");
    }

    function footer() {
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(9);
      doc.text(`Construction Clock — ${generated}`, pageWidth / 2, pageHeight - 24, {
        align: "center",
      });
    }

    // Cover
    paintPage();
    doc.setTextColor(...ink);
    doc.setFontSize(28);
    doc.setFont("helvetica", "bold");
    doc.text(`Annual Report ${year}`, pageWidth / 2, 180, { align: "center" });
    doc.setFontSize(14);
    doc.setFont("helvetica", "normal");
    doc.text("NW Build Pro — Construction Clock", pageWidth / 2, 220, {
      align: "center",
    });
    doc.setFontSize(11);
    doc.setTextColor(148, 163, 184);
    doc.text(`Generated ${generated}`, pageWidth / 2, 244, { align: "center" });
    footer();

    // Summary
    doc.addPage();
    paintPage();
    doc.setTextColor(...ink);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Summary", 40, 56);
    autoTable(doc, {
      startY: 80,
      head: [["Metric", "Value"]],
      body: [
        ["Total Hours", `${Math.round(summary.totalHours)} h`],
        ["Gross Payroll", currency.format(summary.totalGross)],
        ["Material Cost", currency.format(summary.totalMaterials)],
        ["Projects Worked", String(summary.totalProjectsWorked)],
        ["Active Workers", String(summary.activeWorkers)],
        ["Store Visits", String(summary.totalVisits)],
      ],
      theme: "grid",
      styles: { fillColor: darkBg, textColor: ink, lineColor: [51, 65, 85] },
      headStyles: { fillColor: goldHex, textColor: [24, 24, 27], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [40, 47, 69] },
    });
    footer();

    // Workers
    doc.addPage();
    paintPage();
    doc.setTextColor(...ink);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Workers", 40, 56);
    autoTable(doc, {
      startY: 80,
      head: [["Name", "Role", "Hours", "OT", "Gross", "Projects", "Avg h/day"]],
      body: workerRows.map((w) => [
        w.name,
        w.role,
        w.totalHours.toFixed(1),
        w.otHours.toFixed(1),
        currency.format(w.grossPaid),
        String(w.projectCount),
        `${w.avgHoursPerDay}`,
      ]),
      theme: "grid",
      styles: { fillColor: darkBg, textColor: ink, lineColor: [51, 65, 85], fontSize: 9 },
      headStyles: { fillColor: goldHex, textColor: [24, 24, 27], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [40, 47, 69] },
    });
    footer();

    // Projects
    doc.addPage();
    paintPage();
    doc.setTextColor(...ink);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Projects", 40, 56);
    autoTable(doc, {
      startY: 80,
      head: [["Name", "Status", "Start", "End", "Hours", "Materials", "Total"]],
      body: projectRows.map((p) => [
        p.name,
        p.status,
        p.startDate ?? "—",
        p.endDate ?? "—",
        p.laborHours.toFixed(1),
        currency.format(p.materialCost),
        currency.format(p.totalCost),
      ]),
      theme: "grid",
      styles: { fillColor: darkBg, textColor: ink, lineColor: [51, 65, 85], fontSize: 9 },
      headStyles: { fillColor: goldHex, textColor: [24, 24, 27], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [40, 47, 69] },
    });
    footer();

    // Monthly
    doc.addPage();
    paintPage();
    doc.setTextColor(...ink);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Monthly Breakdown", 40, 56);
    autoTable(doc, {
      startY: 80,
      head: [["Month", "Labor Cost", "Material Cost", "Active Workers"]],
      body: monthlyData.map((m) => [
        m.label,
        currency.format(m.laborCost),
        currency.format(m.materialCost),
        String(m.activeWorkers),
      ]),
      theme: "grid",
      styles: { fillColor: darkBg, textColor: ink, lineColor: [51, 65, 85] },
      headStyles: { fillColor: goldHex, textColor: [24, 24, 27], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [40, 47, 69] },
    });
    footer();

    doc.save(`annual_report_${year}.pdf`);
  }

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const hasData =
    annualData.sourceRowCounts.timeEvents > 0 ||
    annualData.sourceRowCounts.receipts > 0 ||
    annualPayroll.totalPaidHours > 0;
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
        <button
          type="button"
          onClick={() => void exportAnnualPdf()}
          disabled={!hasData || loading}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold disabled:opacity-50"
          style={{ background: "#f59e0b", color: "#000" }}
        >
          <Download size={13} />
          {t("report.exportPdf")}
        </button>
      </section>

      {loading ? (
        <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
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
              <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">{Math.round(summary.totalHours).toLocaleString("en-US")}h</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalPayroll")}</div>
              <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">{currency.format(summary.totalGross)}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalMaterials")}</div>
              <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">
                {summary.totalMaterials > 0 ? currency.format(summary.totalMaterials) : (
                  <span className="text-base text-[var(--text-muted)]">{t("report.noData")}</span>
                )}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalProjects")}</div>
              <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">{summary.totalProjectsWorked}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">{summary.completedProjects} {t("common.completed").toLowerCase()}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.activeWorkers")}</div>
              <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">{summary.activeWorkers}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("report.totalVisits")}</div>
              {summary.totalVisits > 0 ? (
                <>
                  <div className="mt-2 font-mono text-[24px] font-bold text-[var(--text-primary)]">
                    {summary.totalVisits.toLocaleString("en-US")}
                  </div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {summary.totalVisitMinutes.toLocaleString("en-US")} {t("common.minShort")}
                  </div>
                </>
              ) : (
                <div className="mt-2 text-base text-[var(--text-muted)]">{t("report.noData")}</div>
              )}
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
                      <td className="py-3 pr-3 font-mono text-[var(--text-primary)]">{w.totalHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 font-mono" style={{ color: w.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{w.otHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 font-mono font-semibold text-[var(--text-primary)]">{currency.format(w.grossPaid)}</td>
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
                      <td className="py-3 pr-3 font-mono text-[var(--text-primary)]">{p.laborHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 font-mono text-[var(--text-primary)]">{currency.format(p.laborCost)}</td>
                      <td className="py-3 pr-3 font-mono text-[var(--text-primary)]">{p.materialCost > 0 ? currency.format(p.materialCost) : "—"}</td>
                      <td className="py-3 pr-3 font-mono font-bold text-[var(--brand-yellow)]">{currency.format(p.totalCost)}</td>
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
              {annualData.totalVisits === 0 ? (
                <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
                  {t("report.noData")}
                </div>
              ) : (
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("report.topStores")}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {storeBreakdown.stores.map((s) => (
                        <div
                          key={s.name}
                          className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--text-primary)]">{s.name}</div>
                            {s.chain ? (
                              <div className="truncate text-xs text-[var(--text-muted)]">{s.chain}</div>
                            ) : null}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                              {s.visits}
                            </div>
                            <div className="font-mono text-[10px] text-[var(--text-muted)]">
                              {s.minutes} {t("common.minShort")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("report.topVisitors")}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {storeBreakdown.workers.map((w) => (
                        <div
                          key={w.name}
                          className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-2 text-sm"
                        >
                          <div className="truncate font-semibold text-[var(--text-primary)]">{w.name}</div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                              {w.visits}
                            </div>
                            <div className="font-mono text-[10px] text-[var(--text-muted)]">
                              {w.minutes} {t("common.minShort")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("report.byChain")}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {storeBreakdown.chains.map((c) => (
                        <div
                          key={c.name}
                          className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2.5 py-2 text-sm"
                        >
                          <div className="truncate font-semibold text-[var(--text-primary)]">{c.name}</div>
                          <div className="shrink-0 text-right">
                            <div className="font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                              {c.visits} {t("report.visits")}
                            </div>
                            <div className="font-mono text-[10px] text-[var(--text-muted)]">
                              {c.minutes} {t("common.minShort")}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
