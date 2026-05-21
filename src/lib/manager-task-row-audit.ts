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
  seenByText: string | null;
  seenAtText: string | null;
  startedByText: string | null;
  startedAtText: string | null;
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
  const meta = asRecord(task.metadata);
  const seenBy = asRecord(meta?.seen_by);
  const assignedSeenValue = task.assigned_to ? seenBy?.[task.assigned_to] : null;
  const assignedSeenAt =
    typeof assignedSeenValue === "string"
      ? assignedSeenValue
      : null;
  const seenById =
    typeof meta?.last_seen_by === "string"
      ? meta.last_seen_by
      : assignedSeenAt
        ? task.assigned_to ?? null
        : null;
  const seenAt =
    typeof meta?.last_seen_at === "string"
      ? meta.last_seen_at
      : assignedSeenAt;
  const startedById =
    typeof meta?.started_by === "string"
      ? meta.started_by
      : typeof meta?.delivery_started_by === "string"
        ? meta.delivery_started_by
        : typeof meta?.claimed_by === "string"
          ? meta.claimed_by
          : getEffectiveTaskStatus(task) === "in_progress"
            ? task.assigned_to ?? null
            : null;
  const startedAt =
    typeof meta?.started_at === "string"
      ? meta.started_at
      : typeof meta?.delivery_started_at === "string"
        ? meta.delivery_started_at
        : typeof meta?.claimed_at === "string"
          ? meta.claimed_at
          : null;
  const startedByText = startedById
    ? profileNames.get(startedById) ?? formatShortId(startedById)
    : null;
  const startedAtText = startedAt ? labels.formatCompletedAt?.(startedAt) ?? startedAt : null;

  if (getEffectiveTaskStatus(task) !== "done") {
    return {
      assignedToText,
      seenByText: seenById ? profileNames.get(seenById) ?? formatShortId(seenById) : null,
      seenAtText: seenAt ? labels.formatCompletedAt?.(seenAt) ?? seenAt : null,
      startedByText,
      startedAtText,
      completedByText: null,
      completedAtText: null,
    };
  }

  const audit = getTaskCompletionAudit(task, profileNames);

  return {
    assignedToText,
    seenByText: seenById ? profileNames.get(seenById) ?? formatShortId(seenById) : null,
    seenAtText: seenAt ? labels.formatCompletedAt?.(seenAt) ?? seenAt : null,
    startedByText: null,
    startedAtText: null,
    completedByText: audit.completedByName
      ?? (audit.completedById ? formatShortId(audit.completedById) : labels.unknown),
    completedAtText: audit.completedAt
      ? labels.formatCompletedAt?.(audit.completedAt) ?? audit.completedAt
      : labels.unknown,
  };
}
