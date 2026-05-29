import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const managerTasksSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ManagerTasksPage.tsx"),
  "utf8",
);

describe("manager completed task filtering", () => {
  it("uses a reversible hide/show completed toggle instead of moving completed tasks to trash", () => {
    expect(managerTasksSource).toContain("const [hideCompletedTasks, setHideCompletedTasks] = useState(false)");
    expect(managerTasksSource).toContain("setHideCompletedTasks((current) => !current)");
    expect(managerTasksSource).toContain("tasks.showCompleted");
    expect(managerTasksSource).not.toContain("handleClearCompleted");
    expect(managerTasksSource).not.toContain("tasks_completed_cleared");
    expect(managerTasksSource).not.toContain("clear-completed");
  });

  it("does not hide completed tasks when an explicit status filter such as Готово is selected", () => {
    expect(managerTasksSource).toContain("if (filterStatus && getEffectiveTaskStatus(task) !== filterStatus) return false;");
    expect(managerTasksSource).toContain("if (!filterStatus && hideCompletedTasks && isEffectiveCompletedTask(task)) return false;");
    expect(managerTasksSource).toContain('const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "done", "cancelled"]');
  });
});
