export type BigBooksPayrollExportLine = {
  workerName: string;
  workerId: string;
  workerRole: string;
  status: string;
  regularHours: number;
  overtimeHours: number;
  hourlyRate: number;
  grossRegular: number;
  grossOvertime: number;
  bonus: number;
  reimbursement: number;
  deduction: number;
  netPay: number;
  projectNames: string[];
};

function csvCell(value: string | number): string {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return `"${text.replaceAll('"', '""')}"`;
}

export function makeBigBooksPayrollCsv(args: {
  periodLabel: string;
  startDate: string;
  endDate: string;
  lines: BigBooksPayrollExportLine[];
}): string {
  const headers = [
    "Worker Name",
    "Worker ID",
    "Role",
    "Period Start",
    "Period End",
    "Status",
    "Regular Hours",
    "Overtime Hours",
    "Hourly Rate",
    "Regular Gross",
    "Overtime Gross",
    "Bonus",
    "Reimbursement",
    "Deduction",
    "Net Pay",
    "Projects",
    "Memo",
  ];

  const rows = args.lines.map((line) => {
    const projects = line.projectNames.join("; ");
    const memo = `Check-Time ${args.periodLabel}${projects ? ` | ${projects}` : ""}`;
    return [
      line.workerName,
      line.workerId,
      line.workerRole,
      args.startDate,
      args.endDate,
      line.status,
      line.regularHours,
      line.overtimeHours,
      line.hourlyRate,
      line.grossRegular,
      line.grossOvertime,
      line.bonus,
      line.reimbursement,
      line.deduction,
      line.netPay,
      projects,
      memo,
    ].map(csvCell).join(",");
  });

  return [headers.map(csvCell).join(","), ...rows].join("\n");
}
