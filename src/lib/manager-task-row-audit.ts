import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";

export type ManagerTaskRowAuditInput = {
  status?: string | null;
  assigned_to?: string | null;
  assigneeName?: string | null;
  completed_by?: string | null;
  completed_at?: string | null;
  completedByName?: string | null;
  metadata?: unknown;
};

export type ManagerTaskRowAuditText = {
  assignedToText: string;
  completedByText: string | null;
  completedAtText: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatShortId(id: string): string {
  return id.slice(0, 8);
}

export function getManagerTaskAssignedToText(
  task: Pick<ManagerTaskRowAuditInput, "assigned_to" | "assigneeName" | "metadata">,
  profileNames: Map<string, string>,
  labels: { unassigned: string },
): string {
  const meta = asRecord(task.metadata);
  const claimedFromUnassigned = meta?.claimed_from_unassigned === true;
  const originalAssignedTo =
    typeof meta?.original_assigned_to === "string"
      ? meta.original_assigned_to
      : meta?.original_assigned_to === null
        ? null
        : undefined;

  if (claimedFromUnassigned && originalAssignedTo === null) {
    return labels.unassigned;
  }

  const assignedTo = claimedFromUnassigned && originalAssignedTo
    ? originalAssignedTo
    : task.assigned_to;

  return assignedTo
    ? task.assigneeName ?? profileNames.get(assignedTo) ?? assignedTo
    : labels.unassigned;
}

export function getManagerTaskRowAuditText(
  task: ManagerTaskRowAuditInput,
  profileNames: Map<string, string>,
  labels: {
    unassigned: string;
    unknown: string;
    formatCompletedAt?: (value: string) => string;
  },
): ManagerTaskRowAuditText {
  const assignedToText = getManagerTaskAssignedToText(task, profileNames, labels);

  if (getEffectiveTaskStatus(task) !== "done") {
    return {
      assignedToText,
      completedByText: null,
      completedAtText: null,
    };
  }

  const audit = getTaskCompletionAudit(task, profileNames);

  return {
    assignedToText,
    completedByText: audit.completedByName
      ?? (audit.completedById ? formatShortId(audit.completedById) : labels.unknown),
    completedAtText: audit.completedAt
      ? labels.formatCompletedAt?.(audit.completedAt) ?? audit.completedAt
      : labels.unknown,
  };
}
