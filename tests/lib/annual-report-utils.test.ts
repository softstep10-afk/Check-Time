import { describe, expect, it } from "vitest";
import { summarizeAnnualPaidPayroll } from "@/lib/annual-report-utils";
import type { PayrollArchiveSummary } from "@/lib/archive-utils";

describe("annual report helpers", () => {
  it("summarizes paid payroll by worker, project, and paid month", () => {
    const archive: PayrollArchiveSummary = {
      totalPaidHours: 30,
      totalGrossPaid: 900,
      years: [2026],
      rows: [
        {
          workerId: "worker-a",
          workerName: "Worker A",
          workerRole: "worker",
          year: 2026,
          paidHours: 20,
          grossPaid: 600,
          periodCount: 2,
          projectNames: ["Home", "Shop"],
          periods: [
            {
              id: "home-line",
              workerId: "worker-a",
              label: "Jan",
              startDate: "2026-01-01",
              endDate: "2026-01-15",
              status: "paid",
              paidAt: "2026-01-16T00:00:00Z",
              hours: 12,
              grossPaid: 360,
              projectNames: ["Home"],
              source: "payroll_line_items",
              href: "/payroll?period=jan",
              shiftDetails: [],
              externalPayment: null,
            },
            {
              id: "shop-line",
              workerId: "worker-a",
              label: "Feb",
              startDate: "2026-02-01",
              endDate: "2026-02-15",
              status: "paid",
              paidAt: "2026-02-16T00:00:00Z",
              hours: 8,
              grossPaid: 240,
              projectNames: ["Shop"],
              source: "payroll_line_items",
              href: "/payroll?period=feb",
              shiftDetails: [],
              externalPayment: null,
            },
          ],
        },
        {
          workerId: "worker-b",
          workerName: "Worker B",
          workerRole: "driver",
          year: 2025,
          paidHours: 10,
          grossPaid: 300,
          periodCount: 1,
          projectNames: ["Old"],
          periods: [],
        },
      ],
    };

    const result = summarizeAnnualPaidPayroll(archive, 2026);

    expect(result.totalPaidHours).toBe(20);
    expect(result.totalGross).toBe(600);
    expect(result.workerPayById.get("worker-a")?.grossPaid).toBe(600);
    expect(result.projectPayByName.get("Home")).toBe(360);
    expect(result.projectPayByName.get("Shop")).toBe(240);
    expect(result.laborCostByMonth[0]).toBe(360);
    expect(result.laborCostByMonth[1]).toBe(240);
    expect(result.paidWorkerIdsByMonth[0].has("worker-a")).toBe(true);
    expect(result.workerPayById.has("worker-b")).toBe(false);
  });
});
