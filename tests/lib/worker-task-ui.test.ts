import { describe, expect, it, vi } from "vitest";
import {
  openWorkerTaskCompletion,
  openWorkerProjectTaskDetails,
  submitWorkerTaskCompletion,
} from "@/lib/worker-task-ui";

describe("worker task UI actions", () => {
  it("/my-tasks card Mark done opens details instead of marking done directly", () => {
    const task = { id: "task-1", title: "Install trim" };
    const openDetails = vi.fn();
    const updateTaskStatus = vi.fn();

    openWorkerTaskCompletion(task, openDetails);

    expect(openDetails).toHaveBeenCalledWith(task, "completion");
    expect(updateTaskStatus).not.toHaveBeenCalled();
  });

  it("modal completion submit is the path that marks the task done", () => {
    const updateTaskStatus = vi.fn();
    const payload = { note: "Finished", followUpRequired: false };

    submitWorkerTaskCompletion(updateTaskStatus, "task-1", payload);

    expect(updateTaskStatus).toHaveBeenCalledWith("task-1", "done", payload);
  });

  it("allows completing a task without description or evidence payload", () => {
    const updateTaskStatus = vi.fn();

    submitWorkerTaskCompletion(updateTaskStatus, "task-1");

    expect(updateTaskStatus).toHaveBeenCalledWith("task-1", "done", undefined);
  });

  it("worker project general task card click opens the detail modal", () => {
    const task = { id: "general-task", assigned_to: null, project_id: "project-1" };
    const openDetails = vi.fn();

    openWorkerProjectTaskDetails(task, openDetails);

    expect(openDetails).toHaveBeenCalledWith(task, "details");
  });
});
