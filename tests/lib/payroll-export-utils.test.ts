import { describe, expect, it } from "vitest";
import { makeBigBooksPayrollCsv } from "@/lib/payroll-export-utils";

describe("makeBigBooksPayrollCsv", () => {
  it("exports payroll lines for external accounting handoff", () => {
    const csv = makeBigBooksPayrollCsv({
      periodLabel: "2026-05-01 -> 2026-05-31",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      lines: [
        {
          workerName: 'Vasia "V"',
          workerId: "worker-1",
          workerRole: "worker",
          status: "approved",
          regularHours: 40,
          overtimeHours: 3.5,
          hourlyRate: 35,
          grossRegular: 1400,
          grossOvertime: 183.75,
          bonus: 50,
          reimbursement: 12.34,
          deduction: 10,
          netPay: 1636.09,
          projectNames: ["Home", "Shop"],
        },
      ],
    });

    expect(csv.split("\n")[0]).toContain('"Worker Name","Worker ID","Role"');
    expect(csv).toContain('"Vasia ""V"""');
    expect(csv).toContain('"40.00","3.50","35.00"');
    expect(csv).toContain('"Home; Shop"');
    expect(csv).toContain('"Check-Time 2026-05-01 -> 2026-05-31 | Home; Shop"');
  });
});
