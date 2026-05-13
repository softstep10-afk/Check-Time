import { describe, expect, it } from "vitest";
import {
  buildCommandCenterQueue,
  type CommandCenterActionItem,
} from "@/lib/command-center";

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
