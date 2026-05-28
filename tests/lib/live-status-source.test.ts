import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const managerTasksSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ManagerTasksPage.tsx"),
  "utf8",
);
const projectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);
const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);
const bulkMessageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/BulkMessageComposer.tsx"),
  "utf8",
);
const workerMessagesSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerMessagesPage.tsx"),
  "utf8",
);
const workerProjectViewSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);

describe("live task and message status source paths", () => {
  it("keeps manager task surfaces subscribed to task status updates", () => {
    expect(managerTasksSource).toContain("mergeRealtimeTaskRow");
    expect(managerTasksSource).toContain('event: "UPDATE"');
    expect(managerTasksSource).toContain('table: "tasks"');
    expect(projectDetailSource).toContain("mergeRealtimeTaskRow");
    expect(projectDetailSource).toContain('event: "UPDATE"');
    expect(projectDetailSource).toContain('table: "tasks"');
  });

  it("keeps worker task status local after success and realtime-merged after broadcast", () => {
    expect(workerShellSource).toContain("mergeVisibleRealtimeTask(row)");
    expect(workerShellSource).toContain('event: "UPDATE"');
    expect(workerShellSource).toContain("setShell((current) => ({");
    expect(workerShellSource).toContain("status: nextStatus");
    expect(workerShellSource).toContain("scheduleShellRefresh(1800)");
  });

  it("merges manager sent-message read updates without dropping history", () => {
    expect(bulkMessageSource).toContain("mergeMessagesById");
    expect(bulkMessageSource).toContain("mergeHistoryPayload(payload.new)");
    expect(bulkMessageSource).toContain('event: "UPDATE"');
    expect(bulkMessageSource).toContain("visibilitychange");
    expect(bulkMessageSource).toContain("window.setInterval");
  });

  it("keeps worker private message history sender-or-recipient based after read updates", () => {
    expect(workerMessagesSource).toContain("buildPrivateMessageParticipantFilter");
    expect(workerMessagesSource).toContain("isPrivateMessageVisibleToProfile");
    expect(workerMessagesSource).toContain("markMessagesReadById");
    expect(workerMessagesSource).toContain('event: "UPDATE"');
    expect(workerMessagesSource).toContain('filter: `sender_id=eq.${shell.profile.id}`');
    expect(workerMessagesSource).toContain('filter: `recipient_id=eq.${shell.profile.id}`');
  });

  it("keeps project notes and refreshed lists stable without broad redraws", () => {
    expect(managerTasksSource).toContain("keepStableListIfUnchanged");
    expect(projectDetailSource).toContain("keepStableListIfUnchanged");
    expect(workerProjectViewSource).toContain("keepStableListIfUnchanged");
    expect(projectDetailSource).toContain("setProjectNotesSettings(row.settings ?? {})");
    expect(workerProjectViewSource).toContain("setProjectPublicNotes(readProjectPublicNotes(row.settings ?? {}))");
    expect(workerProjectViewSource).toContain('table: "projects"');
  });
});
