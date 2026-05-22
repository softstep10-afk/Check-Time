import { describe, expect, it } from "vitest";
import { mergeRealtimeTaskRow, removeTaskById } from "@/lib/task-realtime";
import type { Task } from "@/types/database";

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    id: overrides.id,
    org_id: overrides.org_id ?? "org-1",
    project_id: overrides.project_id ?? "project-1",
    assigned_to: overrides.assigned_to ?? "worker-1",
    assigned_by: overrides.assigned_by ?? "manager-1",
    title: overrides.title ?? "Task",
    description: overrides.description ?? null,
    status: overrides.status ?? "pending",
    priority: overrides.priority ?? "medium",
    due_date: overrides.due_date ?? null,
    completed_at: overrides.completed_at ?? null,
    completed_by: overrides.completed_by ?? null,
    deleted_at: overrides.deleted_at ?? null,
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? "2026-05-22T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-22T10:00:00.000Z",
  };
}

describe("task realtime merge helpers", () => {
  it("inserts a new realtime task at the front without duplicating ids", () => {
    const existing = [task({ id: "old" })];
    const next = mergeRealtimeTaskRow(existing, task({ id: "new", title: "New task" }));

    expect(next.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("merges status updates into an existing task and keeps it visible", () => {
    const existing = [task({ id: "task-1", status: "pending", title: "Install door" })];
    const next = mergeRealtimeTaskRow(existing, task({ id: "task-1", status: "done" }));

    expect(next).toHaveLength(1);
    expect(next[0]?.status).toBe("done");
    expect(next[0]?.title).toBe("Task");
  });

  it("preserves decorated UI fields while applying realtime row updates", () => {
    type TaskRow = Task & { projectName: string | null };
    const existing: TaskRow[] = [{ ...task({ id: "task-1", status: "pending" }), projectName: "Garage" }];
    const next = mergeRealtimeTaskRow<TaskRow>(existing, task({ id: "task-1", status: "in_progress" }), {
      decorate: (row, current) => ({
        ...(current ?? ({} as TaskRow)),
        ...row,
        projectName: current?.projectName ?? null,
      }),
    });

    expect(next[0]?.status).toBe("in_progress");
    expect(next[0]?.projectName).toBe("Garage");
  });

  it("removes soft-deleted or filtered-out tasks from the visible list", () => {
    const existing = [task({ id: "task-1" }), task({ id: "task-2" })];

    expect(
      mergeRealtimeTaskRow(existing, task({ id: "task-1", deleted_at: "2026-05-22T11:00:00.000Z" }))
        .map((item) => item.id),
    ).toEqual(["task-2"]);
    expect(
      mergeRealtimeTaskRow(existing, task({ id: "task-2", project_id: "other" }), {
        shouldInclude: (row) => row.project_id === "project-1",
      }).map((item) => item.id),
    ).toEqual(["task-1"]);
  });

  it("keeps the same array reference when removing an absent task", () => {
    const existing = [task({ id: "task-1" })];
    expect(removeTaskById(existing, "missing")).toBe(existing);
  });
});
