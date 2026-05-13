import { describe, expect, it } from "vitest";
import {
  getEffectiveTaskStatus,
  isEffectiveCompletedTask,
  isEffectiveOpenTask,
} from "@/lib/task-status";

describe("task status helpers", () => {
  it("treats legacy pending tasks with completed_at as done", () => {
    const task = {
      status: "pending" as const,
      completed_at: "2026-05-10T22:27:00Z",
      deleted_at: null,
    };

    expect(getEffectiveTaskStatus(task)).toBe("done");
    expect(isEffectiveCompletedTask(task)).toBe(true);
    expect(isEffectiveOpenTask(task)).toBe(false);
  });

  it("keeps cancelled tasks closed even when completed_at is empty", () => {
    const task = {
      status: "cancelled" as const,
      completed_at: null,
      deleted_at: null,
    };

    expect(getEffectiveTaskStatus(task)).toBe("cancelled");
    expect(isEffectiveCompletedTask(task)).toBe(false);
    expect(isEffectiveOpenTask(task)).toBe(false);
  });

  it("keeps normal pending tasks open", () => {
    const task = {
      status: "pending" as const,
      completed_at: null,
      deleted_at: null,
    };

    expect(getEffectiveTaskStatus(task)).toBe("pending");
    expect(isEffectiveCompletedTask(task)).toBe(false);
    expect(isEffectiveOpenTask(task)).toBe(true);
  });
});
