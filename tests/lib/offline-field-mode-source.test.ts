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
const workerProjectSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const sendMessageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/SendMessageForm.tsx"),
  "utf8",
);
const bulkMessageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/BulkMessageComposer.tsx"),
  "utf8",
);
const claimRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/worker/claim-task/route.ts"),
  "utf8",
);
const uploadQueueSource = readFileSync(
  resolve(process.cwd(), "src/lib/offline-uploads.ts"),
  "utf8",
);

describe("stable offline field mode source wiring", () => {
  it("queues task status updates and avoids false success before server confirmation", () => {
    expect(workerShellSource).toContain("queueTaskStatusAction(taskId, nextStatus, updatePayload)");
    expect(workerShellSource).toContain("return false;");
    expect(workerShellSource).toContain('fetch("/api/worker/task-status"');
    expect(workerShellSource).toContain("updatePayload: item.payload.updatePayload");
    expect(workerShellSource).toContain('t("worker.fieldActionSynced")');
  });

  it("queues material/task claim actions and drains them through the existing claim route", () => {
    expect(tasksPageSource).toContain("queueTaskClaim(taskId)");
    expect(workerProjectSource).toContain("queueTaskClaim(taskId)");
    expect(workerShellSource).toContain('kind: "task_claim"');
    expect(workerShellSource).toContain('fetch("/api/worker/claim-task"');
    expect(claimRouteSource).toContain('.is("assigned_to", null)');
    expect(claimRouteSource).toContain("Task is already assigned.");
  });

  it("queues private messages with a client action id and syncs them on reconnect", () => {
    expect(sendMessageSource).toContain("queueOfflineFieldAction");
    expect(bulkMessageSource).toContain("queueOfflineFieldAction");
    expect(sendMessageSource).toContain("metadata->>client_action_id");
    expect(bulkMessageSource).toContain("metadata->>client_action_id");
    expect(sendMessageSource).toContain('t("messages.queued")');
    expect(bulkMessageSource).toContain('t("messages.queued")');
  });

  it("shows offline and syncing banners without blocking the mobile shell", () => {
    expect(workerShellSource).toContain('t("worker.offlineMode")');
    expect(workerShellSource).toContain('data-testid="worker-offline-status-bar"');
    expect(workerShellSource).toContain("buildOfflineVisibilityState");
    expect(workerShellSource).toContain('t("worker.pendingFieldActions")');
    expect(workerShellSource).toContain('t("worker.syncingFieldActions")');
    expect(workerShellSource).toContain('window.addEventListener("online", handleOnline)');
    expect(workerShellSource).toContain('window.addEventListener("focus", syncOnlineState)');
    expect(workerShellSource).toContain('document.addEventListener("visibilitychange", syncOnlineState)');
    expect(workerShellSource).toContain("window.setInterval(syncOnlineState, 1500)");
    expect(workerShellSource).toContain("setIsOnline(false)");
  });

  it("keeps upload retry behavior pending until storage and metadata both succeed", () => {
    expect(uploadQueueSource).toContain("queueOfflineUpload");
    expect(workerShellSource).toContain("offlineUploadToFile(item)");
    expect(workerShellSource).toContain(".storage");
    expect(workerShellSource).toContain(".from(\"media\")");
    expect(workerShellSource).toContain("removeOfflineUpload(item.id)");
  });
});
