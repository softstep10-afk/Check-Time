import { describe, expect, it } from "vitest";
import {
  buildPayrollLedgerLineDrafts,
  getPaidWorkerIdsAfter,
  getWorkersClosedIntoPeriod,
  rollupPayPeriodStatus,
} from "@/lib/payroll-period-utils";

describe("rollupPayPeriodStatus", () => {
  it("stays draft until every payable worker is approved or paid", () => {
    expect(rollupPayPeriodStatus([
      { workerId: "a", hasHours: true, status: "approved" },
      { workerId: "b", hasHours: true, status: "pending" },
    ])).toBe("draft");
  });

  it("becomes approved when all payable workers are approved or already paid", () => {
    expect(rollupPayPeriodStatus([
      { workerId: "a", hasHours: true, status: "approved" },
      { workerId: "b", hasHours: true, status: "paid" },
      { workerId: "c", hasHours: false, status: "pending" },
    ])).toBe("approved");
  });

  it("becomes paid only when all payable workers are paid", () => {
    expect(rollupPayPeriodStatus([
      { workerId: "a", hasHours: true, status: "paid" },
      { workerId: "b", hasHours: true, status: "paid" },
    ])).toBe("paid");
  });
});

describe("getPaidWorkerIdsAfter", () => {
  it("combines workers already paid with the newly paid selection", () => {
    expect(getPaidWorkerIdsAfter([
      { workerId: "a", hasHours: true, status: "paid" },
      { workerId: "b", hasHours: true, status: "approved" },
      { workerId: "c", hasHours: false, status: "paid" },
    ], ["b"])).toEqual(["a", "b"]);
  });
});

describe("getWorkersClosedIntoPeriod", () => {
  it("blocks payment when an existing closure reaches into the period", () => {
    const blocked = getWorkersClosedIntoPeriod(
      ["worker-a", "worker-b"],
      "2026-04-01",
      [
        { profile_id: "worker-a", closed_through: "2026-05-31T23:59:59Z" },
        { profile_id: "worker-b", closed_through: "2026-03-31T23:59:59Z" },
      ],
    );

    expect([...blocked]).toEqual(["worker-a"]);
  });

  it("allows the next clean period after a prior closure", () => {
    const blocked = getWorkersClosedIntoPeriod(
      ["worker-a"],
      "2026-06-01",
      [{ profile_id: "worker-a", closed_through: "2026-05-31T23:59:59Z" }],
    );

    expect(blocked.size).toBe(0);
  });
});

describe("buildPayrollLedgerLineDrafts", () => {
  it("splits paid worker lines by project and allocates overtime gross proportionally", () => {
    const rows = buildPayrollLedgerLineDrafts([
      {
        workerId: "worker",
        rate: 20,
        regHours: 40,
        otHours: 10,
        grossTotal: 1100,
        hasHours: true,
        projectBreakdown: [
          {
            projectId: "home",
            hours: 30,
            eventIds: ["in-a", "out-a"],
            sessionIds: ["session-a"],
          },
          {
            projectId: "shop",
            hours: 20,
            eventIds: ["in-b", "out-b"],
            sessionIds: ["session-b"],
          },
        ],
      },
    ], ["worker"]);

    expect(rows).toEqual([
      {
        profileId: "worker",
        projectId: "home",
        hours: 30,
        rate: 20,
        amount: 660,
        eventIds: ["in-a", "out-a"],
        sessionIds: ["session-a"],
      },
      {
        profileId: "worker",
        projectId: "shop",
        hours: 20,
        rate: 20,
        amount: 440,
        eventIds: ["in-b", "out-b"],
        sessionIds: ["session-b"],
      },
    ]);
  });

  it("falls back to one no-project ledger line for loaded historical periods", () => {
    const rows = buildPayrollLedgerLineDrafts([
      {
        workerId: "worker",
        rate: 25,
        regHours: 8,
        otHours: 0,
        grossTotal: 200,
        hasHours: true,
        projectBreakdown: [],
      },
    ], ["worker"]);

    expect(rows).toEqual([
      {
        profileId: "worker",
        projectId: null,
        hours: 8,
        rate: 25,
        amount: 200,
        eventIds: [],
        sessionIds: [],
      },
    ]);
  });
});
