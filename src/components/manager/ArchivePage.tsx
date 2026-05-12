"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Archive, CalendarDays, Download, FolderKanban, Lock, Search, Wallet, X } from "lucide-react";
import { DateField } from "@/components/shared/DateField";
import {
  filterArchivedProjectsByDateRange,
  filterPayrollArchiveByDateRange,
  summarizePayrollArchiveRows,
  type ArchiveDateRange,
  ArchivedProjectRow,
  PayrollArchiveSummary,
  PayrollArchiveWorkerYear,
} from "@/lib/archive-utils";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatDate(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString();
}

function makePayrollCsv(rows: PayrollArchiveWorkerYear[]): string {
  const header = [
    "Worker",
    "Role",
    "Year",
    "Paid hours",
    "Gross paid",
    "Payroll periods",
    "Projects",
  ];
  const body = rows.map((row) => [
    row.workerName,
    row.workerRole,
    String(row.year),
    row.paidHours.toFixed(2),
    row.grossPaid.toFixed(2),
    String(row.periodCount),
    row.projectNames.join("; "),
  ]);

  return [header, ...body]
    .map((columns) =>
      columns
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(","),
    )
    .join("\n");
}

function exportPayrollCsv(rows: PayrollArchiveWorkerYear[]) {
  const csv = makePayrollCsv(rows);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "archive-paid-payroll.csv";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function ArchivePage({
  archivedProjects,
  payrollArchive,
  hasFinanceAccess,
}: {
  archivedProjects: ArchivedProjectRow[];
  payrollArchive: PayrollArchiveSummary;
  hasFinanceAccess: boolean;
}) {
  const [tab, setTab] = useState<"projects" | "payroll">("projects");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const hasDateRange = Boolean(fromDate || toDate);
  const dateRange = useMemo<ArchiveDateRange>(() => ({
    fromDate: fromDate || null,
    toDate: toDate || null,
  }), [fromDate, toDate]);

  const filteredProjects = useMemo(() => {
    const dateFiltered = filterArchivedProjectsByDateRange(archivedProjects, dateRange);
    if (!normalizedQuery) return dateFiltered;
    return dateFiltered.filter((project) => {
      return (
        project.name.toLowerCase().includes(normalizedQuery) ||
        (project.address ?? "").toLowerCase().includes(normalizedQuery)
      );
    });
  }, [archivedProjects, dateRange, normalizedQuery]);

  const dateFilteredPayroll = useMemo(() => (
    filterPayrollArchiveByDateRange(payrollArchive, dateRange)
  ), [dateRange, payrollArchive]);

  const filteredPayroll = useMemo(() => {
    return dateFilteredPayroll.rows.filter((row) => {
      if (year !== "all" && row.year !== Number(year)) return false;
      if (!normalizedQuery) return true;
      return (
        row.workerName.toLowerCase().includes(normalizedQuery) ||
        row.projectNames.some((name) => name.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [dateFilteredPayroll.rows, normalizedQuery, year]);

  const visiblePayrollSummary = useMemo(() => (
    summarizePayrollArchiveRows(filteredPayroll)
  ), [filteredPayroll]);

  function clearDateRange() {
    setFromDate("");
    setToDate("");
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Operations History
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold text-[var(--text-primary)]">Archive</h1>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--text-secondary)]">
              Historical projects and paid payroll records. Deleted items stay in Trash.
            </p>
          </div>
          <Link
            href="/trash"
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Open Trash
          </Link>
        </div>
      </section>

      <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTab("projects")}
            className="button-base px-3 py-2 text-xs"
            style={{
              background: tab === "projects" ? "rgba(191, 162, 52, 0.16)" : "transparent",
              color: tab === "projects" ? "var(--brand-yellow)" : "var(--text-secondary)",
            }}
          >
            <FolderKanban size={16} />
            Projects
          </button>
          <button
            type="button"
            onClick={() => setTab("payroll")}
            className="button-base px-3 py-2 text-xs"
            style={{
              background: tab === "payroll" ? "rgba(191, 162, 52, 0.16)" : "transparent",
              color: tab === "payroll" ? "var(--brand-yellow)" : "var(--text-secondary)",
            }}
          >
            <Wallet size={16} />
            Payroll / Workers
          </button>
        </div>
        <div className="flex flex-1 flex-wrap items-end justify-end gap-2">
          <label className="flex min-w-[260px] items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}
          >
            <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "projects" ? "Search project or address" : "Search worker or project"}
              className="w-full bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border text-[var(--text-muted)]"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-primary)" }}
            >
              <CalendarDays size={16} />
            </div>
            <div className="w-[140px]">
              <DateField
                label="From"
                showHint={false}
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="w-[140px]">
              <DateField
                label="To"
                showHint={false}
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            {hasDateRange ? (
              <button
                type="button"
                onClick={clearDateRange}
                className="button-base button-secondary h-10 px-3 text-xs"
              >
                <X size={14} />
                Clear dates
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {tab === "projects" ? (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Archived projects</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{filteredProjects.length}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Tasks preserved</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.taskCount, 0)}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Media preserved</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.mediaCount, 0)}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Worker hours</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.hours, 0).toFixed(1)}h
              </div>
            </div>
          </div>

          <div className="surface-card overflow-x-auto p-4">
            {filteredProjects.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                No archived projects found.
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th className="pb-3 pr-3 font-semibold">Project</th>
                    <th className="pb-3 pr-3 font-semibold">Archived</th>
                    <th className="pb-3 pr-3 font-semibold">Work</th>
                    <th className="pb-3 pr-3 font-semibold">Tasks</th>
                    <th className="pb-3 pr-3 font-semibold">Media</th>
                    <th className="pb-3 font-semibold">History</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => (
                    <tr key={project.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-[var(--text-primary)]">{project.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{project.address ?? "No address"}</div>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                        {formatDate(project.archivedAt)}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-primary)]">
                        <span className="font-mono">{project.hours.toFixed(1)}h</span>
                        <span className="ml-2 text-xs text-[var(--text-muted)]">{project.workerCount} workers</span>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
                        {project.completedTaskCount}/{project.taskCount} done
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
                        {project.mediaCount} files
                        {project.receiptCount > 0 ? (
                          <span className="ml-2">
                            {project.receiptCount} receipts
                            {hasFinanceAccess ? `, ${currency.format(project.receiptTotal)}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <Link href={`/archive/projects/${project.id}`} className="text-sm font-semibold text-[var(--brand-yellow)]">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          {!hasFinanceAccess ? (
            <div className="surface-card flex items-start gap-3 p-4">
              <Lock size={18} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)]">Payroll archive is finance-only</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  Archived project history stays visible here, but gross paid, payroll periods, rates, and paid totals require owner/admin or finance access.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex flex-wrap gap-2">
                  <select
                    value={year}
                    onChange={(event) => setYear(event.target.value)}
                    className="rounded-[var(--radius-sm)] border bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <option value="all">All years</option>
                    {payrollArchive.years.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => exportPayrollCsv(filteredPayroll)}
                  className="button-base button-secondary px-3 py-2 text-xs"
                  disabled={filteredPayroll.length === 0}
                >
                  <Download size={16} />
                  CSV
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Paid hours</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{visiblePayrollSummary.totalPaidHours.toFixed(1)}h</div>
                </div>
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Gross paid</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{currency.format(visiblePayrollSummary.totalGrossPaid)}</div>
                </div>
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Worker years</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{visiblePayrollSummary.rows.length}</div>
                </div>
              </div>

              <div className="surface-card overflow-x-auto p-4">
                {filteredPayroll.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                    No paid payroll rows found.
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                        <th className="pb-3 pr-3 font-semibold">Worker</th>
                        <th className="pb-3 pr-3 font-semibold">Year</th>
                        <th className="pb-3 pr-3 font-semibold">Paid hours</th>
                        <th className="pb-3 pr-3 font-semibold">Gross paid</th>
                        <th className="pb-3 pr-3 font-semibold">Periods</th>
                        <th className="pb-3 font-semibold">Projects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPayroll.map((row) => (
                        <tr key={`${row.workerId}-${row.year}`} className="border-b border-[var(--border-subtle)] align-top">
                          <td className="py-3 pr-3">
                            <Link href={`/team/${row.workerId}`} className="font-semibold text-[var(--text-primary)]">
                              {row.workerName}
                            </Link>
                            <div className="mt-0.5 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">
                              {row.workerRole}
                            </div>
                          </td>
                          <td className="py-3 pr-3 font-mono text-[var(--text-secondary)]">{row.year}</td>
                          <td className="py-3 pr-3 font-mono text-[var(--text-primary)]">{row.paidHours.toFixed(2)}h</td>
                          <td className="py-3 pr-3 font-mono font-semibold text-[var(--text-primary)]">{currency.format(row.grossPaid)}</td>
                          <td className="py-3 pr-3">
                            <div className="space-y-1">
                              {row.periods.map((period) => (
                                <Link key={period.id} href={period.href} className="block text-xs text-[var(--brand-yellow)]">
                                  {period.startDate} - {period.endDate} · {period.hours.toFixed(2)}h · {currency.format(period.grossPaid)}
                                </Link>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 text-[var(--text-secondary)]">
                            {row.projectNames.length > 0 ? row.projectNames.join(", ") : "No project split recorded"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </section>
      )}

      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <Archive size={14} />
        Archive preserves linked history. Trash is only for deleted rows that can be restored or permanently removed.
      </div>
    </div>
  );
}
