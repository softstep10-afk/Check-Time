import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);
const workerProjectSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const taskStatusRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/worker/task-status/route.ts"),
  "utf8",
);
const materialOrdersRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/worker/material-orders/route.ts"),
  "utf8",
);

describe("worker task RLS preparation", () => {
  it("removes direct worker authenticated writes to tasks from field UI", () => {
    const workerSources = `${workerShellSource}\n${workerProjectSource}`;
    expect(workerSources).not.toMatch(/\.from\("tasks"\)[\s\S]{0,180}\.insert\(/);
    expect(workerSources).not.toMatch(/\.from\("tasks"\)[\s\S]{0,180}\.update\(/);
  });

  it("drains worker task status changes through the server route", () => {
    expect(workerShellSource).toContain('fetch("/api/worker/task-status"');
    expect(workerProjectSource).toContain('fetch("/api/worker/task-status"');
    expect(workerShellSource).toContain("taskId: item.payload.taskId");
    expect(workerShellSource).toContain("nextStatus: item.payload.nextStatus");
  });

  it("server task status route reasserts ownership on admin update", () => {
    expect(taskStatusRouteSource).toContain("createAdminClient()");
    expect(taskStatusRouteSource).toContain('.select("id, org_id, project_id, assigned_to');
    expect(taskStatusRouteSource).toContain("task.assigned_to !== profile.id");
    expect(taskStatusRouteSource).toContain('.eq("id", task.id)');
    expect(taskStatusRouteSource).toContain('.eq("org_id", profile.org_id)');
    expect(taskStatusRouteSource).toContain('.eq("assigned_to", profile.id)');
    expect(taskStatusRouteSource).toContain('.is("deleted_at", null)');
    expect(taskStatusRouteSource).toContain("completed_by: nextStatus === \"done\" ? profile.id : null");
  });

  it("worker material order creation derives org and assignee server-side", () => {
    expect(workerProjectSource).toContain('fetch("/api/worker/material-orders"');
    expect(materialOrdersRouteSource).toContain("assertWorkerProjectAccess");
    expect(materialOrdersRouteSource).toContain("org_id: profile.org_id");
    expect(materialOrdersRouteSource).toContain("assigned_to: null");
    expect(materialOrdersRouteSource).toContain("assigned_by: profile.id");
    expect(materialOrdersRouteSource).toContain("requestedBy: profile.id");
    expect(materialOrdersRouteSource).not.toContain("body.orgId");
    expect(materialOrdersRouteSource).not.toContain("body.assignedTo");
  });
});
