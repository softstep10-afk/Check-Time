"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarDays, Download, FolderKanban, Lock, Search, Wallet, X } from "lucide-react";
import { DateField } from "@/components/shared/DateField";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import { useTranslation } from "@/lib/i18n";
import {
  filterArchivedProjectsByDateRange,
  filterPayrollArchive,
  filterPayrollArchiveByDateRange,
  NO_PROJECT_SPLIT_FILTER,
  summarizePayrollArchiveRows,
  type ArchiveDateRange,
  ArchivedProjectRow,
  PayrollArchivePeriod,
  PayrollArchiveSummary,
  PayrollArchiveWorkerYear,
} from "@/lib/archive-utils";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const COPY = {
  en: {
    notRecorded: "Not recorded",
    csvHeaders: ["Worker", "Role", "Year", "Paid hours", "Gross paid", "Payroll periods", "Projects"],
    eyebrow: "Operations History",
    title: "Archive",
    description: "Historical projects and paid payroll records. Deleted items stay in Trash.",
    openTrash: "Open Trash",
    projectsTab: "Projects",
    payrollTab: "Payroll / Workers",
    searchProjects: "Search project or address",
    searchPayroll: "Search worker or project",
    from: "From",
    to: "To",
    clearDates: "Clear dates",
    archivedProjects: "Archived projects",
    tasksPreserved: "Tasks preserved",
    mediaPreserved: "Media preserved",
    workerHours: "Worker hours",
    noProjects: "No archived projects found.",
    project: "Project",
    archived: "Archived",
    work: "Work",
    tasks: "Tasks",
    media: "Media",
    done: "done",
    files: "files",
    history: "History",
    noAddress: "No address",
    workers: "workers",
    receipts: "receipts",
    open: "Open",
    payrollLockedTitle: "Payroll archive is finance-only",
    payrollLockedDesc: "Archived project history stays visible here, but gross paid, payroll periods, rates, and paid totals require owner/admin or finance access.",
    allYears: "All years",
    allWorkers: "All workers",
    allProjects: "All projects",
    noProjectSplitOption: "No project split",
    paidHours: "Paid hours",
    grossPaid: "Gross paid",
    workerYears: "Worker years",
    noPayroll: "No paid payroll rows found.",
    worker: "Worker",
    year: "Year",
    periods: "Periods",
    noProjectSplit: "No project split recorded",
    periodDetails: "Payroll period",
    close: "Close",
    paidAt: "Paid at",
    status: "Status",
    source: "Source",
    sourcePayPeriodItems: "Payroll period item",
    sourcePayrollLineItems: "Payroll ledger",
    externalPayment: "External payment",
    externalPaymentReference: "Reference",
    shifts: "Paid shifts",
    noShifts: "No shift breakdown was found for this paid period.",
    shiftTime: "Time",
    shiftHours: "Hours",
    shiftAmount: "Amount",
    possibleDuplicate: "Possible duplicate",
    duplicateWarning: "This worker has another paid period with the same dates, hours, and amount. The yearly total includes each paid record.",
    footer: "Archive preserves linked history. Trash is only for deleted rows that can be restored or permanently removed.",
  },
  ru: {
    notRecorded: "Не записано",
    csvHeaders: ["Рабочий", "Роль", "Год", "Оплаченные часы", "Начислено", "Периоды зарплаты", "Проекты"],
    eyebrow: "История работ",
    title: "Архив",
    description: "Здесь хранятся архивные проекты и оплаченная зарплата. Удалённые элементы остаются в Корзине.",
    openTrash: "Открыть корзину",
    projectsTab: "Проекты",
    payrollTab: "Зарплата / Рабочие",
    searchProjects: "Поиск по проекту или адресу",
    searchPayroll: "Поиск по рабочему или проекту",
    from: "От",
    to: "До",
    clearDates: "Сбросить даты",
    archivedProjects: "Проектов в архиве",
    tasksPreserved: "Задач сохранено",
    mediaPreserved: "Файлов сохранено",
    workerHours: "Часы рабочих",
    noProjects: "Архивные проекты не найдены.",
    project: "Проект",
    archived: "Архивирован",
    work: "Работа",
    tasks: "Задачи",
    media: "Файлы",
    done: "готово",
    files: "файлов",
    history: "История",
    noAddress: "Адрес не указан",
    workers: "рабочих",
    receipts: "чеков",
    open: "Открыть",
    payrollLockedTitle: "Архив зарплаты доступен только финансам",
    payrollLockedDesc: "История архивных проектов остаётся видимой, но начисления, периоды зарплаты, ставки и суммы доступны только владельцу, администратору или пользователю с финансовым доступом.",
    allYears: "Все годы",
    allWorkers: "Все рабочие",
    allProjects: "Все проекты",
    noProjectSplitOption: "Без разбивки по проекту",
    paidHours: "Оплаченные часы",
    grossPaid: "Начислено",
    workerYears: "Рабочие по годам",
    noPayroll: "Оплаченные строки зарплаты не найдены.",
    worker: "Рабочий",
    year: "Год",
    periods: "Периоды",
    noProjectSplit: "Разбивка по проектам не записана",
    periodDetails: "Период зарплаты",
    close: "Закрыть",
    paidAt: "Оплачено",
    status: "Статус",
    source: "Источник",
    sourcePayPeriodItems: "Строка платёжного периода",
    sourcePayrollLineItems: "Зарплатный ledger",
    externalPayment: "Внешняя оплата",
    externalPaymentReference: "Reference",
    shifts: "Оплаченные смены",
    noShifts: "Разбивка смен для этого оплаченного периода не найдена.",
    shiftTime: "Время",
    shiftHours: "Часы",
    shiftAmount: "Сумма",
    possibleDuplicate: "Возможный дубль",
    duplicateWarning: "У этого рабочего есть ещё один оплаченный период с теми же датами, часами и суммой. Годовой итог включает каждую оплаченную запись.",
    footer: "Архив сохраняет связанную историю. Корзина только для удалённых строк, которые можно восстановить или удалить навсегда.",
  },
} as const;

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return new Date(value).toLocaleDateString();
}

function makePayrollCsv(rows: PayrollArchiveWorkerYear[], header: readonly string[]): string {
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

function exportPayrollCsv(rows: PayrollArchiveWorkerYear[], header: readonly string[]) {
  const csv = makePayrollCsv(rows, header);
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

type PayrollPeriodSelection = {
  row: PayrollArchiveWorkerYear;
  period: PayrollArchivePeriod;
};

function payrollPeriodDuplicateKey(period: PayrollArchivePeriod): string {
  return [
    period.workerId,
    period.startDate,
    period.endDate,
    period.hours.toFixed(2),
    period.grossPaid.toFixed(2),
  ].join("|");
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
  const [workerId, setWorkerId] = useState<string>("all");
  const [projectName, setProjectName] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedPayrollPeriod, setSelectedPayrollPeriod] =
    useState<PayrollPeriodSelection | null>(null);
  const { locale } = useTranslation();
  const text = COPY[locale];

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

  const workerOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of payrollArchive.rows) {
      byId.set(row.workerId, row.workerName);
    }
    return [...byId.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  }, [payrollArchive.rows]);

  const projectOptions = useMemo(() => {
    const names = new Set<string>();
    let hasNoSplit = false;
    for (const row of payrollArchive.rows) {
      for (const period of row.periods) {
        if (period.projectNames.length === 0) {
          hasNoSplit = true;
          continue;
        }
        for (const name of period.projectNames) {
          names.add(name);
        }
      }
    }
    const sorted = [...names].sort((left, right) => left.localeCompare(right));
    return hasNoSplit ? [...sorted, NO_PROJECT_SPLIT_FILTER] : sorted;
  }, [payrollArchive.rows]);

  const filteredPayroll = useMemo(() => {
    const scoped = filterPayrollArchive(dateFilteredPayroll, {
      year: year === "all" ? null : Number(year),
      workerId: workerId === "all" ? null : workerId,
      projectName: projectName === "all" ? null : projectName,
    });
    return scoped.rows.filter((row) => {
      if (!normalizedQuery) return true;
      return (
        row.workerName.toLowerCase().includes(normalizedQuery) ||
        row.projectNames.some((name) => name.toLowerCase().includes(normalizedQuery))
      );
    });
  }, [dateFilteredPayroll, normalizedQuery, projectName, workerId, year]);

  const visiblePayrollSummary = useMemo(() => (
    summarizePayrollArchiveRows(filteredPayroll)
  ), [filteredPayroll]);

  const payrollPeriodDuplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of filteredPayroll) {
      for (const period of row.periods) {
        const key = payrollPeriodDuplicateKey(period);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [filteredPayroll]);

  useEffect(() => {
    if (!selectedPayrollPeriod) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelectedPayrollPeriod(null);
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedPayrollPeriod]);

  function clearDateRange() {
    setFromDate("");
    setToDate("");
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {text.eyebrow}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-bold text-[var(--text-primary)]">{text.title}</h1>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--text-secondary)]">
              {text.description}
            </p>
          </div>
          <Link
            href="/trash"
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {text.openTrash}
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
            {text.projectsTab}
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
            {text.payrollTab}
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
              placeholder={tab === "projects" ? text.searchProjects : text.searchPayroll}
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
                label={text.from}
                showHint={false}
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="w-[140px]">
              <DateField
                label={text.to}
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
                {text.clearDates}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {tab === "projects" ? (
        <section className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.archivedProjects}</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{filteredProjects.length}</div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.tasksPreserved}</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.taskCount, 0)}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.mediaPreserved}</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.mediaCount, 0)}
              </div>
            </div>
            <div className="surface-card p-4">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.workerHours}</div>
              <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
                {filteredProjects.reduce((sum, project) => sum + project.hours, 0).toFixed(1)}h
              </div>
            </div>
          </div>

          <div className="surface-card overflow-x-auto p-4">
            {filteredProjects.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                {text.noProjects}
              </div>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th className="pb-3 pr-3 font-semibold">{text.project}</th>
                    <th className="pb-3 pr-3 font-semibold">{text.archived}</th>
                    <th className="pb-3 pr-3 font-semibold">{text.work}</th>
                    <th className="pb-3 pr-3 font-semibold">{text.tasks}</th>
                    <th className="pb-3 pr-3 font-semibold">{text.media}</th>
                    <th className="pb-3 font-semibold">{text.history}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => (
                    <tr key={project.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-[var(--text-primary)]">{project.name}</div>
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{project.address ?? text.noAddress}</div>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                        {formatDate(project.archivedAt, text.notRecorded)}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-primary)]">
                        <span className="font-mono">{project.hours.toFixed(1)}h</span>
                        <span className="ml-2 text-xs text-[var(--text-muted)]">{project.workerCount} {text.workers}</span>
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
                        {project.completedTaskCount}/{project.taskCount} {text.done}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
                        {project.mediaCount} {text.files}
                        {project.receiptCount > 0 ? (
                          <span className="ml-2">
                            {project.receiptCount} {text.receipts}
                            {hasFinanceAccess ? `, ${currency.format(project.receiptTotal)}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3">
                        <Link href={`/archive/projects/${project.id}`} className="text-sm font-semibold text-[var(--brand-yellow)]">
                          {text.open}
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
                <h2 className="text-base font-bold text-[var(--text-primary)]">{text.payrollLockedTitle}</h2>
                <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                  {text.payrollLockedDesc}
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
                    <option value="all">{text.allYears}</option>
                    {payrollArchive.years.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                  <select
                    value={workerId}
                    onChange={(event) => setWorkerId(event.target.value)}
                    className="rounded-[var(--radius-sm)] border bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <option value="all">{text.allWorkers}</option>
                    {workerOptions.map(([id, name]) => (
                      <option key={id} value={id}>{name}</option>
                    ))}
                  </select>
                  <select
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    className="rounded-[var(--radius-sm)] border bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)]"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <option value="all">{text.allProjects}</option>
                    {projectOptions.map((name) => (
                      <option key={name} value={name}>
                        {name === NO_PROJECT_SPLIT_FILTER ? text.noProjectSplitOption : name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => exportPayrollCsv(filteredPayroll, text.csvHeaders)}
                  className="button-base button-secondary px-3 py-2 text-xs"
                  disabled={filteredPayroll.length === 0}
                >
                  <Download size={16} />
                  CSV
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.paidHours}</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{visiblePayrollSummary.totalPaidHours.toFixed(1)}h</div>
                </div>
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.grossPaid}</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{currency.format(visiblePayrollSummary.totalGrossPaid)}</div>
                </div>
                <div className="surface-card p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.workerYears}</div>
                  <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{visiblePayrollSummary.rows.length}</div>
                </div>
              </div>

              <div className="surface-card overflow-x-auto p-4">
                {filteredPayroll.length === 0 ? (
                  <div className="py-10 text-center text-sm text-[var(--text-secondary)]">
                    {text.noPayroll}
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                        <th className="pb-3 pr-3 font-semibold">{text.worker}</th>
                        <th className="pb-3 pr-3 font-semibold">{text.year}</th>
                        <th className="pb-3 pr-3 font-semibold">{text.paidHours}</th>
                        <th className="pb-3 pr-3 font-semibold">{text.grossPaid}</th>
                        <th className="pb-3 pr-3 font-semibold">{text.periods}</th>
                        <th className="pb-3 font-semibold">{text.projectsTab}</th>
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
                              {row.periods.map((period) => {
                                const duplicateCount =
                                  payrollPeriodDuplicateCounts.get(payrollPeriodDuplicateKey(period)) ?? 0;
                                return (
                                  <button
                                    key={period.id}
                                    type="button"
                                    onClick={() => setSelectedPayrollPeriod({ row, period })}
                                    className="block w-full text-left text-xs text-[var(--brand-yellow)] underline-offset-2 hover:underline focus:underline"
                                  >
                                    {period.startDate} - {period.endDate} · {period.hours.toFixed(2)}h · {currency.format(period.grossPaid)}
                                    {duplicateCount > 1 ? (
                                      <span
                                        className="ml-2 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                                        style={{
                                          background: "rgba(245, 158, 11, 0.16)",
                                          color: "#f59e0b",
                                        }}
                                      >
                                        {text.possibleDuplicate}
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                          <td className="py-3 text-[var(--text-secondary)]">
                            {row.projectNames.length > 0 ? row.projectNames.join(", ") : text.noProjectSplit}
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
        {text.footer}
      </div>

      {selectedPayrollPeriod ? (() => {
        const { row, period } = selectedPayrollPeriod;
        const duplicateCount =
          payrollPeriodDuplicateCounts.get(payrollPeriodDuplicateKey(period)) ?? 0;
        const sourceLabel = period.source === "payroll_line_items"
          ? text.sourcePayrollLineItems
          : text.sourcePayPeriodItems;
        return (
          <ModalBackdrop
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
            style={{ background: "rgba(0, 0, 0, 0.72)" }}
            onClose={() => setSelectedPayrollPeriod(null)}
          >
            <div
              className="max-h-[90vh] w-full max-w-[840px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                    {text.periodDetails}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {row.workerName}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {period.startDate} - {period.endDate}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPayrollPeriod(null)}
                  aria-label={text.close}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
                >
                  <X size={16} />
                </button>
              </div>

              {duplicateCount > 1 ? (
                <div
                  className="mt-4 rounded-[var(--radius-md)] border px-3 py-2 text-sm"
                  style={{
                    borderColor: "rgba(245, 158, 11, 0.34)",
                    background: "rgba(245, 158, 11, 0.08)",
                    color: "#f59e0b",
                  }}
                >
                  <div className="font-semibold">{text.possibleDuplicate}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {text.duplicateWarning}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.paidHours}
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">
                    {period.hours.toFixed(2)}h
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.grossPaid}
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">
                    {currency.format(period.grossPaid)}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.status}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {period.status}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.paidAt}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {period.paidAt ? new Date(period.paidAt).toLocaleString() : text.notRecorded}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.source}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {sourceLabel}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.projectsTab}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {period.projectNames.length > 0 ? period.projectNames.join(", ") : text.noProjectSplit}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 sm:col-span-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {text.externalPayment}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                    {period.externalPayment
                      ? [
                          period.externalPayment.provider,
                          period.externalPayment.reference
                            ? `${text.externalPaymentReference}: ${period.externalPayment.reference}`
                            : null,
                          period.externalPayment.recordedAt
                            ? new Date(period.externalPayment.recordedAt).toLocaleString()
                            : null,
                        ].filter(Boolean).join(" · ")
                      : text.notRecorded}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">
                    {text.shifts}
                  </h3>
                  <span className="font-mono text-xs text-[var(--text-muted)]">
                    {period.shiftDetails.length} · {period.shiftDetails.reduce((sum, shift) => sum + shift.hours, 0).toFixed(2)}h
                  </span>
                </div>
                {period.shiftDetails.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                    {text.noShifts}
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          <th className="px-3 py-2 font-semibold">{text.project}</th>
                          <th className="px-3 py-2 font-semibold">{text.shiftTime}</th>
                          <th className="px-3 py-2 text-right font-semibold">{text.shiftHours}</th>
                          <th className="px-3 py-2 text-right font-semibold">{text.shiftAmount}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {period.shiftDetails.map((shift) => (
                          <tr key={shift.id} className="border-t border-[var(--border-subtle)]">
                            <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">
                              {shift.projectName}
                            </td>
                            <td className="px-3 py-2 text-[var(--text-secondary)]">
                              {new Date(shift.clockInTime).toLocaleString()}
                              {" - "}
                              {shift.clockOutTime
                                ? new Date(shift.clockOutTime).toLocaleString()
                                : text.notRecorded}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">
                              {shift.hours.toFixed(2)}h
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">
                              {currency.format(shift.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedPayrollPeriod(null)}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold text-[var(--text-primary)]"
                  style={{ borderColor: "var(--border-default)" }}
                >
                  {text.close}
                </button>
              </div>
            </div>
          </ModalBackdrop>
        );
      })() : null}
    </div>
  );
}
