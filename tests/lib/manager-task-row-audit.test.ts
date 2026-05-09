import { describe, expect, it } from "vitest";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";

const labels = {
  unassigned: "Not assigned",
  unknown: "Unknown",
  formatCompletedAt: (value: string) => `formatted ${value}`,
};

describe("getManagerTaskRowAuditText", () => {
  it("shows assigned worker and completed worker separately for a done assigned task", () => {
    const row = getManagerTaskRowAuditText(
      {
        status: "done",
        assigned_to: "assigned-worker",
        assigneeName: "Assigned Worker",
        completed_by: "completed-worker",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      new Map([
        ["assigned-worker", "Assigned Worker"],
        ["completed-worker", "Vasya"],
      ]),
      labels,
    );

    expect(row.assignedToText).toBe("Assigned Worker");
    expect(row.completedByText).toBe("Vasya");
    expect(row.completedAtText).toBe("formatted 2026-05-01T10:30:00Z");
  });

  it("shows not assigned and completed worker for a done general task", () => {
    const row = getManagerTaskRowAuditText(
      {
        status: "done",
        assigned_to: null,
        completed_by: "worker-2",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      new Map([["worker-2", "Vasya"]]),
      labels,
    );

    expect(row.assignedToText).toBe("Not assigned");
    expect(row.completedByText).toBe("Vasya");
    expect(row.completedAtText).toBe("formatted 2026-05-01T10:30:00Z");
  });

  it("keeps a claimed common task visually unassigned while showing the finisher", () => {
    const row = getManagerTaskRowAuditText(
      {
        status: "done",
        assigned_to: "worker-2",
        assigneeName: "Vasya",
        completed_by: "worker-2",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {
          claimed_from_unassigned: true,
          original_assigned_to: null,
          claimed_by: "worker-2",
        },
      },
      new Map([["worker-2", "Vasya"]]),
      labels,
    );

    expect(row.assignedToText).toBe("Not assigned");
    expect(row.completedByText).toBe("Vasya");
  });

  it("shows a visible unknown fallback for done tasks missing completed_by", () => {
    const row = getManagerTaskRowAuditText(
      {
        status: "done",
        assigned_to: null,
        completed_by: null,
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      new Map(),
      labels,
    );

    expect(row.assignedToText).toBe("Not assigned");
    expect(row.completedByText).toBe("Unknown");
    expect(row.completedAtText).toBe("formatted 2026-05-01T10:30:00Z");
  });

  it("falls back to a short completed_by id when the worker name is missing", () => {
    const row = getManagerTaskRowAuditText(
      {
        status: "done",
        assigned_to: null,
        completed_by: "12345678-90ab-cdef-1234-567890abcdef",
        completed_at: "2026-05-01T10:30:00Z",
        metadata: {},
      },
      new Map(),
      labels,
    );

    expect(row.completedByText).toBe("12345678");
  });
});
