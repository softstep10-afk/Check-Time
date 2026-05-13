export type PayrollExternalPaymentAudit = {
  provider: "BigBooks";
  reference: string | null;
  worker_ids: string[];
  recorded_at: string;
  recorded_by: string;
};

export type PayrollAuditLineInput = {
  workerId: string;
  workerName: string;
  workerRole: string;
  status: string;
  regularHours: number;
  overtimeHours: number;
  grossTotal: number;
  netTotal: number;
  projectNames: string[];
};

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildPayrollActionAuditPayload(args: {
  period: {
    id: string;
    label: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  lines: PayrollAuditLineInput[];
  workerIds?: string[];
  externalPayment?: PayrollExternalPaymentAudit | null;
}): Record<string, unknown> {
  const workerSet = args.workerIds ? new Set(args.workerIds) : null;
  const lines = args.lines.filter((line) => !workerSet || workerSet.has(line.workerId));
  return {
    status: args.period.status,
    period: {
      id: args.period.id,
      label: args.period.label,
      start_date: args.period.startDate,
      end_date: args.period.endDate,
    },
    external_payment: args.externalPayment ?? null,
    worker_count: lines.length,
    total_hours: r2(lines.reduce((sum, line) => sum + line.regularHours + line.overtimeHours, 0)),
    regular_hours: r2(lines.reduce((sum, line) => sum + line.regularHours, 0)),
    overtime_hours: r2(lines.reduce((sum, line) => sum + line.overtimeHours, 0)),
    gross_total: r2(lines.reduce((sum, line) => sum + line.grossTotal, 0)),
    net_total: r2(lines.reduce((sum, line) => sum + line.netTotal, 0)),
    workers: lines.map((line) => ({
      worker_id: line.workerId,
      worker_name: line.workerName,
      worker_role: line.workerRole,
      status: line.status,
      regular_hours: r2(line.regularHours),
      overtime_hours: r2(line.overtimeHours),
      total_hours: r2(line.regularHours + line.overtimeHours),
      gross_total: r2(line.grossTotal),
      net_total: r2(line.netTotal),
      projects: line.projectNames,
    })),
  };
}
