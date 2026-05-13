import type { ManagerSession } from "@/lib/manager-types";
import { isEffectiveCompletedTask } from "@/lib/task-status";
import type {
  Media,
  PayrollLineItem,
  PayrollRun,
  Profile,
  Project,
  ProjectAssignment,
  Task,
} from "@/types/database";

export type PayPeriodRow = {
  id: string;
  org_id?: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  approved_by?: string | null;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

export type PayPeriodItemRow = {
  id: string;
  pay_period_id: string;
  worker_id: string;
  rate?: number | string | null;
  regular_hours: number | string;
  overtime_hours: number | string;
  gross_total: number | string;
  net_total?: number | string | null;
  status: string;
  created_at?: string;
};

export type ArchivedProjectRow = {
  id: string;
  name: string;
  address: string | null;
  archivedAt: string | null;
  updatedAt: string;
  taskCount: number;
  completedTaskCount: number;
  mediaCount: number;
  receiptCount: number;
  receiptTotal: number;
  workerCount: number;
  hours: number;
  lastActivityTime: string | null;
};

export type PayrollArchivePeriod = {
  id: string;
  workerId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  paidAt: string | null;
  hours: number;
  grossPaid: number;
  projectNames: string[];
  source: "pay_period_items" | "payroll_line_items";
  href: string;
};

export type PayrollArchiveWorkerYear = {
  workerId: string;
  workerName: string;
  workerRole: string;
  year: number;
  paidHours: number;
  grossPaid: number;
  periodCount: number;
  projectNames: string[];
  periods: PayrollArchivePeriod[];
};

export type PayrollArchiveSummary = {
  rows: PayrollArchiveWorkerYear[];
  years: number[];
  totalPaidHours: number;
  totalGrossPaid: number;
};

export type ArchiveDateRange = {
  fromDate?: string | null;
  toDate?: string | null;
};

export const NO_PROJECT_SPLIT_FILTER = "__no_project_split__";

export type PayrollArchiveFilters = {
  year?: number | null;
  workerId?: string | null;
  projectName?: string | null;
};

function toNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function yearFromDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getUTCFullYear();
}

function dayBoundary(value: string | null | undefined, endOfDay: boolean): number | null {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
  const date = new Date(`${value}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function rangeBounds(range: ArchiveDateRange): { fromMs: number | null; toMs: number | null } {
  return {
    fromMs: dayBoundary(range.fromDate, false),
    toMs: dayBoundary(range.toDate, true),
  };
}

function dateValueInRange(value: string | null | undefined, range: ArchiveDateRange): boolean {
  const { fromMs, toMs } = rangeBounds(range);
  if (fromMs === null && toMs === null) return true;
  if (!value) return false;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return false;
  if (fromMs !== null && ms < fromMs) return false;
  if (toMs !== null && ms > toMs) return false;
  return true;
}

function dateSpanOverlapsRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
  range: ArchiveDateRange,
): boolean {
  const { fromMs, toMs } = rangeBounds(range);
  if (fromMs === null && toMs === null) return true;
  const startMs = dayBoundary(startDate, false);
  const endMs = dayBoundary(endDate ?? startDate, true);
  if (startMs === null || endMs === null) return false;
  if (fromMs !== null && endMs < fromMs) return false;
  if (toMs !== null && startMs > toMs) return false;
  return true;
}

function sortedNames(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function summarizePayrollArchiveRows(
  rows: PayrollArchiveWorkerYear[],
): PayrollArchiveSummary {
  return {
    rows,
    years: [...new Set(rows.map((row) => row.year))].sort((left, right) => right - left),
    totalPaidHours: round2(rows.reduce((sum, row) => sum + row.paidHours, 0)),
    totalGrossPaid: round2(rows.reduce((sum, row) => sum + row.grossPaid, 0)),
  };
}

export function filterArchivedProjectsByDateRange<T extends ArchivedProjectRow>(
  projects: T[],
  range: ArchiveDateRange,
): T[] {
  return projects.filter((project) => dateValueInRange(
    project.archivedAt ?? project.updatedAt,
    range,
  ));
}

export function filterPayrollArchiveByDateRange(
  summary: PayrollArchiveSummary,
  range: ArchiveDateRange,
): PayrollArchiveSummary {
  const rows = summary.rows
    .map((row) => {
      const periods = row.periods.filter((period) => (
        dateSpanOverlapsRange(period.startDate, period.endDate, range)
      ));
      if (periods.length === 0) return null;
      return {
        ...row,
        paidHours: round2(periods.reduce((sum, period) => sum + period.hours, 0)),
        grossPaid: round2(periods.reduce((sum, period) => sum + period.grossPaid, 0)),
        periodCount: periods.length,
        projectNames: sortedNames(new Set(periods.flatMap((period) => period.projectNames))),
        periods,
      };
    })
    .filter((row): row is PayrollArchiveWorkerYear => row !== null);

  return summarizePayrollArchiveRows(rows);
}

export function filterPayrollArchive(
  summary: PayrollArchiveSummary,
  filters: PayrollArchiveFilters,
): PayrollArchiveSummary {
  const rows = summary.rows
    .filter((row) => {
      if (filters.year !== null && filters.year !== undefined && row.year !== filters.year) {
        return false;
      }
      if (filters.workerId && row.workerId !== filters.workerId) {
        return false;
      }
      return true;
    })
    .map((row) => {
      if (!filters.projectName) return row;
      const periods = row.periods.filter((period) => {
        if (filters.projectName === NO_PROJECT_SPLIT_FILTER) {
          return period.projectNames.length === 0;
        }
        return period.projectNames.includes(filters.projectName ?? "");
      });
      if (periods.length === 0) return null;
      return {
        ...row,
        paidHours: round2(periods.reduce((sum, period) => sum + period.hours, 0)),
        grossPaid: round2(periods.reduce((sum, period) => sum + period.grossPaid, 0)),
        periodCount: periods.length,
        projectNames: sortedNames(new Set(periods.flatMap((period) => period.projectNames))),
        periods,
      };
    })
    .filter((row): row is PayrollArchiveWorkerYear => row !== null);

  return summarizePayrollArchiveRows(rows);
}

export function isArchivedProject(
  project: Pick<Project, "status" | "deleted_at">,
): boolean {
  return project.status === "archived" && !project.deleted_at;
}

export function isActiveProjectForOperations(
  project: Pick<Project, "status" | "deleted_at">,
): boolean {
  return !project.deleted_at && project.status !== "archived";
}

export function getActiveOperationalProjects<T extends Pick<Project, "status" | "deleted_at">>(
  projects: T[],
): T[] {
  return projects.filter(isActiveProjectForOperations);
}

export function buildActiveProjectIdSet(
  projects: Array<Pick<Project, "id" | "status" | "deleted_at">>,
): Set<string> {
  return new Set(getActiveOperationalProjects(projects).map((project) => project.id));
}

export function isTaskInActiveOperations(
  task: Pick<Task, "deleted_at" | "project_id">,
  activeProjectIds: ReadonlySet<string>,
): boolean {
  if (task.deleted_at) return false;
  if (!task.project_id) return true;
  return activeProjectIds.has(task.project_id);
}

export function getActiveOperationalTasks<T extends Pick<Task, "deleted_at" | "project_id">>(
  tasks: T[],
  projects: Array<Pick<Project, "id" | "status" | "deleted_at">>,
): T[] {
  const activeProjectIds = buildActiveProjectIdSet(projects);
  return tasks.filter((task) => isTaskInActiveOperations(task, activeProjectIds));
}

export function getActiveOperationalMedia<T extends Pick<Media, "deleted_at" | "project_id">>(
  media: T[],
  projects: Array<Pick<Project, "id" | "status" | "deleted_at">>,
): T[] {
  const activeProjectIds = buildActiveProjectIdSet(projects);
  return media.filter((item) => {
    if (item.deleted_at) return false;
    if (!item.project_id) return true;
    return activeProjectIds.has(item.project_id);
  });
}

export function buildArchivedProjectRows(args: {
  projects: Project[];
  tasks: Task[];
  media: Media[];
  sessions: ManagerSession[];
  assignments: ProjectAssignment[];
  includeFinancials: boolean;
}): ArchivedProjectRow[] {
  const archivedProjects = args.projects.filter(isArchivedProject);
  const archivedProjectIds = new Set(archivedProjects.map((project) => project.id));
  const tasksByProject = new Map<string, Task[]>();
  const mediaByProject = new Map<string, Media[]>();
  const workersByProject = new Map<string, Set<string>>();
  const hoursByProject = new Map<string, number>();
  const lastActivityByProject = new Map<string, string>();

  for (const task of args.tasks) {
    if (task.deleted_at || !task.project_id || !archivedProjectIds.has(task.project_id)) continue;
    const list = tasksByProject.get(task.project_id) ?? [];
    list.push(task);
    tasksByProject.set(task.project_id, list);
  }

  for (const item of args.media) {
    if (item.deleted_at || !item.project_id || !archivedProjectIds.has(item.project_id)) continue;
    const list = mediaByProject.get(item.project_id) ?? [];
    list.push(item);
    mediaByProject.set(item.project_id, list);
  }

  for (const assignment of args.assignments) {
    if (!archivedProjectIds.has(assignment.project_id)) continue;
    const ids = workersByProject.get(assignment.project_id) ?? new Set<string>();
    ids.add(assignment.profile_id);
    workersByProject.set(assignment.project_id, ids);
  }

  for (const session of args.sessions) {
    if (!archivedProjectIds.has(session.projectId)) continue;
    const workerIds = workersByProject.get(session.projectId) ?? new Set<string>();
    workerIds.add(session.profileId);
    workersByProject.set(session.projectId, workerIds);
    hoursByProject.set(
      session.projectId,
      (hoursByProject.get(session.projectId) ?? 0) + session.durationMinutes / 60,
    );
    const current = lastActivityByProject.get(session.projectId);
    const activity = session.clockOutTime ?? session.clockInTime;
    if (!current || activity > current) {
      lastActivityByProject.set(session.projectId, activity);
    }
  }

  return archivedProjects
    .map((project) => {
      const tasks = tasksByProject.get(project.id) ?? [];
      const media = mediaByProject.get(project.id) ?? [];
      let receiptCount = 0;
      let receiptTotal = 0;
      for (const item of media) {
        const meta = item.metadata as Record<string, unknown> | null;
        if (meta?.category !== "receipt") continue;
        receiptCount += 1;
        receiptTotal += toNumber(meta.amount);
      }

      return {
        id: project.id,
        name: project.name,
        address: project.address,
        archivedAt: project.archived_at ?? null,
        updatedAt: project.updated_at,
        taskCount: tasks.length,
        completedTaskCount: tasks.filter(isEffectiveCompletedTask).length,
        mediaCount: media.length,
        receiptCount,
        receiptTotal: args.includeFinancials ? round2(receiptTotal) : 0,
        workerCount: workersByProject.get(project.id)?.size ?? 0,
        hours: round2(hoursByProject.get(project.id) ?? 0),
        lastActivityTime: lastActivityByProject.get(project.id) ?? null,
      };
    })
    .sort((left, right) => {
      const leftDate = left.archivedAt ?? left.updatedAt;
      const rightDate = right.archivedAt ?? right.updatedAt;
      return new Date(rightDate).getTime() - new Date(leftDate).getTime();
    });
}

function isPaidPeriod(period: PayPeriodRow): boolean {
  return period.status === "paid" || Boolean(period.paid_at);
}

function isPaidPeriodItem(item: PayPeriodItemRow, period: PayPeriodRow): boolean {
  return item.status === "paid" || isPaidPeriod(period);
}

function isClosedPayrollRun(run: PayrollRun): boolean {
  return run.status === "paid" || run.status === "confirmed" || run.status === "exported";
}

function getPayPeriodHref(periodId: string): string {
  return `/payroll?period=${periodId}`;
}

function getPayrollRunHref(runId: string): string {
  return `/payroll/history#run-${runId}`;
}

function upsertArchiveRow(
  rows: Map<string, PayrollArchiveWorkerYear>,
  profilesById: ReadonlyMap<string, Profile>,
  period: PayrollArchivePeriod,
  includeFinancials: boolean,
) {
  const year = yearFromDate(period.endDate) ?? new Date().getUTCFullYear();
  const key = `${period.workerId}:${year}`;
  const profile = profilesById.get(period.workerId);
  const row = rows.get(key) ?? {
    workerId: period.workerId,
    workerName: profile?.name ?? "Unknown worker",
    workerRole: profile?.role ?? "worker",
    year,
    paidHours: 0,
    grossPaid: 0,
    periodCount: 0,
    projectNames: [],
    periods: [],
  };

  row.paidHours = round2(row.paidHours + period.hours);
  row.grossPaid = includeFinancials ? round2(row.grossPaid + period.grossPaid) : 0;
  row.periods.push(period);
  row.periodCount = row.periods.length;
  row.projectNames = sortedNames(new Set(row.periods.flatMap((item) => item.projectNames)));
  rows.set(key, row);
}

export function buildPaidPayrollArchive(
  input: {
    profiles: Profile[];
    projects: Project[];
    payPeriods: PayPeriodRow[];
    payPeriodItems: PayPeriodItemRow[];
    payrollRuns: PayrollRun[];
    payrollLineItems: PayrollLineItem[];
  },
  options: { includeFinancials: boolean },
): PayrollArchiveSummary {
  const includeFinancials = options.includeFinancials;
  const profilesById = new Map(input.profiles.map((profile) => [profile.id, profile]));
  const projectsById = new Map(input.projects.map((project) => [project.id, project]));
  const periodsById = new Map(input.payPeriods.map((period) => [period.id, period]));
  const rows = new Map<string, PayrollArchiveWorkerYear>();
  const runsById = new Map(input.payrollRuns.map((run) => [run.id, run]));
  const periodIdsBackedByLedger = new Set<string>();

  for (const item of input.payrollLineItems) {
    const run = runsById.get(item.payroll_run_id);
    if (!run || !isClosedPayrollRun(run)) continue;
    const linkedPayPeriodId = (run.metadata as Record<string, unknown> | null)?.pay_period_id;
    if (typeof linkedPayPeriodId === "string") {
      periodIdsBackedByLedger.add(linkedPayPeriodId);
    }
  }

  for (const item of input.payPeriodItems) {
    const period = periodsById.get(item.pay_period_id);
    if (!period || !isPaidPeriodItem(item, period)) continue;
    if (periodIdsBackedByLedger.has(period.id)) continue;
    const hours = round2(toNumber(item.regular_hours) + toNumber(item.overtime_hours));
    const grossPaid = includeFinancials ? round2(toNumber(item.gross_total)) : 0;
    upsertArchiveRow(
      rows,
      profilesById,
      {
        id: item.id,
        workerId: item.worker_id,
        label: period.label,
        startDate: period.start_date,
        endDate: period.end_date,
        status: item.status,
        paidAt: period.paid_at ?? null,
        hours,
        grossPaid,
        projectNames: [],
        source: "pay_period_items",
        href: getPayPeriodHref(period.id),
      },
      includeFinancials,
    );
  }

  for (const item of input.payrollLineItems) {
    const run = runsById.get(item.payroll_run_id);
    if (!run || !isClosedPayrollRun(run)) continue;
    const linkedPayPeriodId = (run.metadata as Record<string, unknown> | null)?.pay_period_id;
    const linkedPeriod = typeof linkedPayPeriodId === "string"
      ? periodsById.get(linkedPayPeriodId)
      : null;
    const projectName = item.project_id ? projectsById.get(item.project_id)?.name : null;
    const hours = round2(toNumber(item.hours));
    const grossPaid = includeFinancials ? round2(toNumber(item.amount)) : 0;
    upsertArchiveRow(
      rows,
      profilesById,
      {
        id: item.id,
        workerId: item.profile_id,
        label: linkedPeriod?.label ?? `Payroll run ${run.period_start} - ${run.period_end}`,
        startDate: linkedPeriod?.start_date ?? run.period_start,
        endDate: linkedPeriod?.end_date ?? run.period_end,
        status: linkedPeriod?.status ?? run.status,
        paidAt: linkedPeriod?.paid_at ?? run.confirmed_at,
        hours,
        grossPaid,
        projectNames: projectName ? [projectName] : [],
        source: "payroll_line_items",
        href: linkedPeriod ? getPayPeriodHref(linkedPeriod.id) : getPayrollRunHref(run.id),
      },
      includeFinancials,
    );
  }

  const resultRows = [...rows.values()].sort((left, right) => {
    if (right.year !== left.year) return right.year - left.year;
    return left.workerName.localeCompare(right.workerName);
  });

  for (const row of resultRows) {
    row.periods.sort((left, right) => {
      return new Date(right.endDate).getTime() - new Date(left.endDate).getTime();
    });
  }

  const summary = summarizePayrollArchiveRows(resultRows);
  return includeFinancials ? summary : { ...summary, totalGrossPaid: 0 };
}
