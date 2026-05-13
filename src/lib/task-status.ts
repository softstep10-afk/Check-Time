import type { Task, TaskStatus } from "@/types/database";

const TASK_STATUSES = new Set<string>([
  "pending",
  "in_progress",
  "done",
  "cancelled",
]);

type TaskStatusInput = TaskStatus | string | null | undefined;

function normalizeTaskStatus(status: TaskStatusInput): TaskStatus {
  return TASK_STATUSES.has(status ?? "") ? (status as TaskStatus) : "pending";
}

export function getEffectiveTaskStatus(
  task: { status?: TaskStatusInput; completed_at?: Task["completed_at"] },
): TaskStatus {
  const status = normalizeTaskStatus(task.status);
  if (status === "done") return "done";
  if (status !== "cancelled" && task.completed_at) return "done";
  return status;
}

export function isEffectiveCompletedTask(
  task: {
    status?: TaskStatusInput;
    deleted_at?: Task["deleted_at"];
    completed_at?: Task["completed_at"];
  },
): boolean {
  return !task.deleted_at && getEffectiveTaskStatus(task) === "done";
}

export function isEffectiveOpenTask(
  task: {
    status?: TaskStatusInput;
    deleted_at?: Task["deleted_at"];
    completed_at?: Task["completed_at"];
  },
): boolean {
  const effectiveStatus = getEffectiveTaskStatus(task);
  return !task.deleted_at && effectiveStatus !== "done" && effectiveStatus !== "cancelled";
}
