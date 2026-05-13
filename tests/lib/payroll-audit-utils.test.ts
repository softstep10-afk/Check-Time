import { describe, expect, it } from "vitest";
import { buildPayrollActionAuditPayload } from "@/lib/payroll-audit-utils";

describe("buildPayrollActionAuditPayload", () => {
  it("summarizes paid workers, totals, and BigBooks reference", () => {
    const payload = buildPayrollActionAuditPayload({
      period: {
        id: "period-1",
        label: "May",
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        status: "paid",
      },
      workerIds: ["w1"],
      externalPayment: {
        provider: "BigBooks",
        reference: "batch-42",
        worker_ids: ["w1"],
        recorded_at: "2026-06-01T10:00:00Z",
        recorded_by: "owner",
      },
      lines: [
        {
          workerId: "w1",
          workerName: "Vasia",
          workerRole: "worker",
          status: "paid",
          regularHours: 40,
          overtimeHours: 3.5,
          grossTotal: 1583.75,
          netTotal: 1583.75,
          projectNames: ["Home"],
        },
        {
          workerId: "w2",
          workerName: "Dima",
          workerRole: "worker",
          status: "approved",
          regularHours: 8,
          overtimeHours: 0,
          grossTotal: 200,
          netTotal: 200,
          projectNames: ["Shop"],
        },
      ],
    });

    expect(payload).toMatchObject({
      status: "paid",
      worker_count: 1,
      total_hours: 43.5,
      gross_total: 1583.75,
      external_payment: { reference: "batch-42" },
    });
    expect(payload.workers).toEqual([
      {
        worker_id: "w1",
        worker_name: "Vasia",
        worker_role: "worker",
        status: "paid",
        regular_hours: 40,
        overtime_hours: 3.5,
        total_hours: 43.5,
        gross_total: 1583.75,
        net_total: 1583.75,
        projects: ["Home"],
      },
    ]);
  });
});
