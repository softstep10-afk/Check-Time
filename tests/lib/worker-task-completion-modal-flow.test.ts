import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tasksPage = readFileSync("src/components/worker/TasksPage.tsx", "utf8");
const projectView = readFileSync("src/components/worker/WorkerProjectView.tsx", "utf8");
const detailModal = readFileSync("src/components/worker/WorkerTaskDetailModal.tsx", "utf8");

describe("worker task completion modal flow", () => {
  it("closes the global task completion modal only after the done update succeeds", () => {
    expect(tasksPage).toContain('if (ok) {');
    expect(tasksPage).toContain("setLocallyCompletedTaskIds");
    expect(tasksPage).toContain("closeDetails();");
  });

  it("closes the project task completion modal only after the done update succeeds", () => {
    expect(projectView).toContain('if (ok) {');
    expect(projectView).toContain('markLocalTask(id, "done");');
    expect(projectView).toContain("closeDetails();");
  });

  it("keeps the manual open-details path available", () => {
    expect(tasksPage).toContain('data-testid="worker-task-open-details"');
    expect(projectView).toContain("openWorkerProjectTaskDetails(task, openDetails)");
  });

  it("keeps completion report and evidence controls in the modal", () => {
    expect(detailModal).toContain('data-testid="worker-task-completion-note"');
    expect(detailModal).toContain('data-testid="worker-task-completion-files"');
    expect(detailModal).toContain('data-testid="worker-task-followup-toggle"');
    expect(detailModal).toContain('data-testid="worker-task-mark-done"');
  });
});
