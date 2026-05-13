import type { PayrollArchiveSummary } from "@/lib/archive-utils";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type AnnualWorkerPayroll = {
  workerId: string;
  workerName: string;
  workerRole: string;
  paidHours: number;
  grossPaid: number;
  projectNames: string[];
};

export type AnnualPaidPayrollIndex = {
  totalPaidHours: number;
  totalGross: number;
  workerPayById: Map<string, AnnualWorkerPayroll>;
  projectPayByName: Map<string, number>;
  laborCostByMonth: number[];
  paidWorkerIdsByMonth: Array<Set<string>>;
};

export function summarizeAnnualPaidPayroll(
  archive: PayrollArchiveSummary,
  year: number,
): AnnualPaidPayrollIndex {
  const rows = archive.rows.filter((row) => row.year === year);
  const workerPayById = new Map<string, AnnualWorkerPayroll>();
  const projectPayByName = new Map<string, number>();
  const laborCostByMonth = new Array(12).fill(0) as number[];
  const paidWorkerIdsByMonth = Array.from({ length: 12 }, () => new Set<string>());

  for (const row of rows) {
    workerPayById.set(row.workerId, {
      workerId: row.workerId,
      workerName: row.workerName,
      workerRole: row.workerRole,
      paidHours: row.paidHours,
      grossPaid: row.grossPaid,
      projectNames: row.projectNames,
    });

    for (const period of row.periods) {
      const month = new Date(period.endDate).getMonth();
      if (month >= 0 && month < 12) {
        laborCostByMonth[month] = round2(laborCostByMonth[month] + period.grossPaid);
        paidWorkerIdsByMonth[month].add(row.workerId);
      }

      if (period.projectNames.length === 0) continue;
      const projectShare = round2(period.grossPaid / period.projectNames.length);
      for (const projectName of period.projectNames) {
        projectPayByName.set(
          projectName,
          round2((projectPayByName.get(projectName) ?? 0) + projectShare),
        );
      }
    }
  }

  return {
    totalPaidHours: round2(rows.reduce((sum, row) => sum + row.paidHours, 0)),
    totalGross: round2(rows.reduce((sum, row) => sum + row.grossPaid, 0)),
    workerPayById,
    projectPayByName,
    laborCostByMonth,
    paidWorkerIdsByMonth,
  };
}
