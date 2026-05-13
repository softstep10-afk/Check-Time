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
  it("sorts critical manager actions first and picks the primary action", () => {
    const queue = buildCommandCenterQueue([
      item("medium", 1),
      item("critical-b", 0, "Bravo"),
      item("low", 2),
      item("critical-a", 0, "Alpha"),
    ]);

    expect(queue.allItems.map((entry) => entry.id)).toEqual([
      "critical-a",
      "critical-b",
      "medium",
      "low",
    ]);
    expect(queue.primaryAction?.id).toBe("critical-a");
    expect(queue.criticalCount).toBe(2);
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
});
