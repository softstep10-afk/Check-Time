import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const managerProjectsSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectsPage.tsx"),
  "utf8",
);
const workerProjectsSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectsList.tsx"),
  "utf8",
);
const workerTasksSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/TasksPage.tsx"),
  "utf8",
);
const workerModalSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerTaskDetailModal.tsx"),
  "utf8",
);

describe("mobile project card and task action UX", () => {
  it("makes worker project cards clickable without wrapping nested controls in a link", () => {
    expect(workerProjectsSource).toContain('data-testid="worker-project-card"');
    expect(workerProjectsSource).toContain("router.push(`/project/${project.id}`)");
    expect(workerProjectsSource).toContain("onKeyDown={(event) => {");
    expect(workerProjectsSource).not.toContain("href={`/project/${project.id}`}");
  });

  it("keeps address/copy rows from triggering the project card navigation", () => {
    expect(managerProjectsSource).toContain("CopyAddressButton address={project.address}");
    expect(managerProjectsSource).toContain("onClick={(event) => event.stopPropagation()}");
    expect(workerProjectsSource).toContain("onClick={(event) => event.stopPropagation()}");
  });

  it("keeps task card actions stacked on mobile and wrapped on larger screens", () => {
    expect(workerTasksSource).toContain("mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap");
    expect(workerTasksSource).toContain("button-base button-secondary w-full justify-center sm:flex-1");
    expect(workerTasksSource).toContain("button-base button-primary w-full justify-center sm:flex-1");
  });

  it("keeps the completion modal capable of submitting an empty optional report", () => {
    expect(workerModalSource).toContain("const isEmpty =");
    expect(workerModalSource).toContain("onDone(task.id, isEmpty ? undefined : payload)");
  });
});
