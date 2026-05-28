import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);
const tasksPageSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/TasksPage.tsx"),
  "utf8",
);
const workerProjectsListSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectsList.tsx"),
  "utf8",
);
const workerProjectSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const workerMessagesSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerMessagesPage.tsx"),
  "utf8",
);
const cacheHelperSource = readFileSync(
  resolve(process.cwd(), "src/lib/offline-field-cache.ts"),
  "utf8",
);

describe("offline readable field cache source wiring", () => {
  it("scopes last-loaded worker snapshots by profile and org without signed URLs", () => {
    expect(cacheHelperSource).toContain("buildOfflineCacheKey");
    expect(cacheHelperSource).toContain("actorId");
    expect(cacheHelperSource).toContain("orgId");
    expect(cacheHelperSource).toContain("worker-tasks");
    expect(cacheHelperSource).toContain("worker-project-detail");
    expect(cacheHelperSource).toContain("worker-messages");
    expect(cacheHelperSource).toContain("SECRET_KEY_PATTERN");
    expect(cacheHelperSource).toContain("signed_url");
    expect(cacheHelperSource).toContain("clearOfflineSnapshotsForActor");
  });

  it("caches worker task, material queue, and project list snapshots from WorkerShell", () => {
    expect(workerShellSource).toContain('saveOfflineSnapshot(offlineCacheActor, "worker-tasks"');
    expect(workerShellSource).toContain('saveOfflineSnapshot(offlineCacheActor, "material-tasks"');
    expect(workerShellSource).toContain('saveOfflineSnapshot(offlineCacheActor, "worker-projects"');
    expect(workerShellSource).toContain("shell.tasks.filter(isMaterialTask)");
    expect(workerShellSource).toContain("clearOfflineSnapshotsForActor(shell.profile.id)");
  });

  it("loads cached task list data and stores task detail snapshots from /my-tasks", () => {
    expect(tasksPageSource).toContain('loadOfflineSnapshot(cacheActor, "worker-tasks")');
    expect(tasksPageSource).toContain('loadOfflineSnapshot(cacheActor, "worker-projects")');
    expect(tasksPageSource).toContain('saveOfflineSnapshot(cacheActor, "worker-task-detail"');
    expect(tasksPageSource).toContain("<OfflineCacheNotice");
    expect(tasksPageSource).toContain("<OfflineCacheEmptyState");
  });

  it("lets the project list open a previously loaded project summary while offline", () => {
    expect(workerProjectsListSource).toContain('"worker-projects"');
    expect(workerProjectsListSource).toContain("cachedProjectsSnapshot");
    expect(workerProjectsListSource).toContain('"worker-project-detail"');
    expect(workerProjectsListSource).toContain('data-testid="offline-cached-project-detail"');
    expect(workerProjectsListSource).toContain('t("worker.offlineCacheEmpty")');
  });

  it("saves and reloads worker project detail and task detail snapshots", () => {
    expect(workerProjectSource).toContain('"worker-project-detail"');
    expect(workerProjectSource).toContain('saveOfflineSnapshot(cacheActor, "worker-task-detail"');
    expect(workerProjectSource).toContain("setCachedProjectSnapshot(cached)");
    expect(workerProjectSource).toContain("<OfflineCacheNotice");
  });

  it("keeps private message history available from the worker cache", () => {
    expect(workerMessagesSource).toContain('buildPrivateMessageParticipantFilter(shell.profile.id)');
    expect(workerMessagesSource).toContain('"worker-messages"');
    expect(workerMessagesSource).toContain("loadCachedMessages");
    expect(workerMessagesSource).toContain("<OfflineCacheNotice");
    expect(workerMessagesSource).toContain("<OfflineCacheEmptyState");
  });
});
