export type PayPeriodLineStatus = "pending" | "approved" | "paid";
export type PayPeriodStatus = "draft" | "approved" | "paid";

export type PayPeriodStatusLine = {
  workerId: string;
  hasHours: boolean;
  status: PayPeriodLineStatus;
};

export type PayrollLedgerProjectBreakdown = {
  projectId: string | null;
  hours: number;
  amount?: number;
  eventIds?: string[];
  sessionIds?: string[];
};

export type PayrollLedgerLineSource = {
  workerId: string;
  rate: number;
  regHours: number;
  otHours: number;
  grossTotal: number;
  hasHours: boolean;
  projectBreakdown: PayrollLedgerProjectBreakdown[];
};

export type PayrollLedgerLineDraft = {
  profileId: string;
  projectId: string | null;
  hours: number;
  rate: number;
  amount: number;
  eventIds: string[];
  sessionIds: string[];
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function rollupPayPeriodStatus(lines: PayPeriodStatusLine[]): PayPeriodStatus {
  const payable = lines.filter((line) => line.hasHours);
  if (payable.length === 0) return "draft";
  if (payable.every((line) => line.status === "paid")) return "paid";
  if (payable.every((line) => line.status === "approved" || line.status === "paid")) {
    return "approved";
  }
  return "draft";
}

export function getPaidWorkerIdsAfter(
  lines: PayPeriodStatusLine[],
  newlyPaidWorkerIds: Iterable<string>,
): string[] {
  const newlyPaid = new Set(newlyPaidWorkerIds);
  return lines
    .filter((line) => line.hasHours && (line.status === "paid" || newlyPaid.has(line.workerId)))
    .map((line) => line.workerId);
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function amountAllocations(
  totalAmount: number,
  breakdown: ReadonlyArray<PayrollLedgerProjectBreakdown>,
): number[] {
  const totalHours = breakdown.reduce((sum, item) => sum + item.hours, 0);
  if (totalHours <= 0) return breakdown.map(() => 0);

  let allocated = 0;
  return breakdown.map((item, index) => {
    if (index === breakdown.length - 1) {
      return r2(totalAmount - allocated);
    }
    const amount = r2(totalAmount * (item.hours / totalHours));
    allocated = r2(allocated + amount);
    return amount;
  });
}

export function buildPayrollLedgerLineDrafts(
  lines: PayrollLedgerLineSource[],
  workerIds: Iterable<string>,
): PayrollLedgerLineDraft[] {
  const workerSet = new Set(workerIds);
  const drafts: PayrollLedgerLineDraft[] = [];

  for (const line of lines) {
    if (!line.hasHours || !workerSet.has(line.workerId)) continue;
    const totalHours = r2(line.regHours + line.otHours);
    if (totalHours <= 0) continue;

    const projectBreakdown = line.projectBreakdown.filter((item) => item.hours > 0);
    if (projectBreakdown.length === 0) {
      drafts.push({
        profileId: line.workerId,
        projectId: null,
        hours: totalHours,
        rate: line.rate,
        amount: r2(line.grossTotal),
        eventIds: [],
        sessionIds: [],
      });
      continue;
    }

    const amounts = amountAllocations(line.grossTotal, projectBreakdown);
    for (let index = 0; index < projectBreakdown.length; index += 1) {
      const project = projectBreakdown[index];
      drafts.push({
        profileId: line.workerId,
        projectId: project.projectId,
        hours: r2(project.hours),
        rate: line.rate,
        amount: amounts[index],
        eventIds: unique(project.eventIds ?? []),
        sessionIds: unique(project.sessionIds ?? []),
      });
    }
  }

  return drafts;
}
