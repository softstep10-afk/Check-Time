import type { TaskStatus } from "@/types/database";

export type WorkerTaskModalMode = "details" | "completion";

export type WorkerTaskStatusUpdater<Payload = unknown> = (
  taskId: string,
  nextStatus: TaskStatus,
  payload?: Payload,
) => void;

export function openWorkerTaskCompletion<T>(
  task: T,
  openDetails: (task: T, mode: WorkerTaskModalMode) => void,
): void {
  openDetails(task, "completion");
}

export function openWorkerProjectTaskDetails<T>(
  task: T,
  openDetails: (task: T, mode: WorkerTaskModalMode) => void,
): void {
  openDetails(task, "details");
}

export function submitWorkerTaskCompletion<Payload>(
  updateTaskStatus: WorkerTaskStatusUpdater<Payload>,
  taskId: string,
  payload?: Payload,
): void {
  updateTaskStatus(taskId, "done", payload);
}
