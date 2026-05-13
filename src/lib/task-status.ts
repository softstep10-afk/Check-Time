import type { Task, TaskStatus } from "@/types/database";

export function getEffectiveTaskStatus(
  task: Pick<Task, "status" | "completed_at">,
): TaskStatus {
  if (task.status === "done") return "done";
  if (task.status !== "cancelled" && task.completed_at) return "done";
  return task.status;
}

export function isEffectiveCompletedTask(
  task: Pick<Task, "status" | "deleted_at" | "completed_at">,
): boolean {
  return !task.deleted_at && getEffectiveTaskStatus(task) === "done";
}

export function isEffectiveOpenTask(
  task: Pick<Task, "status" | "deleted_at" | "completed_at">,
): boolean {
  const effectiveStatus = getEffectiveTaskStatus(task);
  return !task.deleted_at && effectiveStatus !== "done" && effectiveStatus !== "cancelled";
}
