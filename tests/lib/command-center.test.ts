import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCommandCenterQueue,
  type CommandCenterActionItem,
} from "@/lib/command-center";

const commandCenterSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/command-center/page.tsx"),
  "utf8",
);
const bulkComposerSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/BulkMessageComposer.tsx"),
  "utf8",
);

function item(
  id: string,
  severity: CommandCenterActionItem["severity"],
  title = id,
): CommandCenterActionItem {
  return {
    id,
    label: "Action",
    title,
    detail: "Detail",
    href: "/overview",
    severity,
    color: "red",
  };
}

describe("buildCommandCenterQueue", () => {
  it("sorts critical manager actions first and preserves source order within a severity", () => {
    const queue = buildCommandCenterQueue([
      item("medium", 1),
      item("critical-b", 0, "Bravo"),
      item("low", 2),
      item("critical-a", 0, "Alpha"),
    ]);

    expect(queue.allItems.map((entry) => entry.id)).toEqual([
      "critical-b",
      "critical-a",
      "medium",
      "low",
    ]);
    expect(queue.primaryAction?.id).toBe("critical-b");
    expect(queue.totalCount).toBe(4);
    expect(queue.criticalCount).toBe(2);
    expect(queue.warningCount).toBe(1);
    expect(queue.lowCount).toBe(1);
    expect(queue.hasActions).toBe(true);
  });

  it("limits visible items without hiding the full critical count", () => {
    const queue = buildCommandCenterQueue([
      item("a", 0),
      item("b", 0),
      item("c", 1),
    ], { limit: 1 });

    expect(queue.visibleItems.map((entry) => entry.id)).toEqual(["a"]);
    expect(queue.criticalCount).toBe(2);
  });

  it("handles an empty manager queue", () => {
    const queue = buildCommandCenterQueue([]);

    expect(queue.allItems).toEqual([]);
    expect(queue.visibleItems).toEqual([]);
    expect(queue.primaryAction).toBeNull();
    expect(queue.hasActions).toBe(false);
    expect(queue.totalCount).toBe(0);
  });
});

describe("Command Center layout limits", () => {
  it("puts team messages before live operations and limits visible operations to six", () => {
    const messagesIndex = commandCenterSource.indexOf("{text.messagesTitle}");
    const liveOpsIndex = commandCenterSource.indexOf("{text.liveOps}");
    const metricIndex = commandCenterSource.indexOf("label: text.openTasks");
    const dispatchIndex = commandCenterSource.indexOf("{text.dispatchTitle}");

    expect(messagesIndex).toBeGreaterThanOrEqual(0);
    expect(liveOpsIndex).toBeGreaterThanOrEqual(0);
    expect(messagesIndex).toBeLessThan(liveOpsIndex);
    expect(liveOpsIndex).toBeLessThan(metricIndex);
    expect(liveOpsIndex).toBeLessThan(dispatchIndex);
    expect(commandCenterSource).toContain("visibleLiveWorkers = liveWorkers.slice(0, COMMAND_CENTER_PREVIEW_LIMIT)");
    expect(commandCenterSource).toContain("hiddenLiveWorkers = liveWorkers.slice(COMMAND_CENTER_PREVIEW_LIMIT)");
    expect(commandCenterSource).toContain("visibleLiveWorkers.map(renderLiveWorkerCard)");
    expect(commandCenterSource).toContain("hiddenLiveWorkers.map(renderLiveWorkerCard)");
    expect(commandCenterSource).toContain("text.showAllPeople");
    expect(commandCenterSource).toContain("text.collapse");
  });

  it("moves the owner attention queue near the bottom and limits it to six", () => {
    const riskIndex = commandCenterSource.indexOf("{text.riskQueue}");
    const messagesIndex = commandCenterSource.indexOf("{text.messagesTitle}");
    const taskBoardIndex = commandCenterSource.indexOf("{text.taskBoardTitle}");

    expect(riskIndex).toBeGreaterThan(messagesIndex);
    expect(riskIndex).toBeLessThan(taskBoardIndex);
    expect(commandCenterSource).toContain("visibleOwnerAttentionItems = ownerAttentionItems.slice(0, COMMAND_CENTER_PREVIEW_LIMIT)");
    expect(commandCenterSource).toContain("visibleOwnerAttentionItems.map");
  });

  it("shows no more than six task status cards by default", () => {
    expect(commandCenterSource).toContain("visibleDispatchTasks = dispatchTasks.slice(0, COMMAND_CENTER_PREVIEW_LIMIT)");
    expect(commandCenterSource).toContain("visibleDispatchTasks.map");
    expect(commandCenterSource).toContain("{text.showAll}");
  });

  it("limits recent embedded Command Center messages to the latest three", () => {
    expect(commandCenterSource).toContain("COMMAND_CENTER_RECENT_MESSAGE_LIMIT = 3");
    expect(commandCenterSource).toContain("historyLimit={COMMAND_CENTER_RECENT_MESSAGE_LIMIT}");
    expect(bulkComposerSource).toContain("historyLimit = 20");
    expect(bulkComposerSource).toContain(".limit(historyLimit)");
  });

  it("removes the Jarvis next-actions and action-ledger blocks from the main board", () => {
    // Owner-dashboard cleanup: Jarvis widgets no longer clutter the Command
    // Center. Audit data itself is untouched — only this read-only display is
    // gone (recommended follow-up: surface it on the dedicated /ai page).
    expect(commandCenterSource).not.toContain('data-testid="jarvis-next-actions-compact"');
    expect(commandCenterSource).not.toContain("aiNextActions");
    expect(commandCenterSource).not.toContain("aiPromptHref");
    expect(commandCenterSource).not.toContain("jarvisAuditRows");
    expect(commandCenterSource).not.toContain("{text.actionLedger}");
  });

  it("removes the duplicate quick-actions block now that the left nav covers it", () => {
    expect(commandCenterSource).not.toContain("{text.quickControls}");
    expect(commandCenterSource).not.toContain("quickLink(");
  });

  it("makes the four stat cards clickable to existing list pages", () => {
    expect(commandCenterSource).toContain('href: "/tasks"');
    expect(commandCenterSource).toContain('href: "/projects"');
    expect(commandCenterSource).toContain("if (href) {");
  });

  it("keeps protected Command Center blocks mounted", () => {
    for (const token of [
      "BulkMessageComposer",
      "ManagerTasksPage",
      "{text.openProjects}",
      "{text.taskBoardTitle}",
    ]) {
      expect(commandCenterSource).toContain(token);
    }
  });
});
