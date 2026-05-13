export type CommandCenterSeverity = 0 | 1 | 2;

export type CommandCenterActionItem = {
  id: string;
  label: string;
  title: string;
  detail: string;
  href: string;
  severity: CommandCenterSeverity;
  color: string;
};

export type CommandCenterQueue = {
  allItems: CommandCenterActionItem[];
  visibleItems: CommandCenterActionItem[];
  criticalCount: number;
  primaryAction: CommandCenterActionItem | null;
};

export function buildCommandCenterQueue(
  items: CommandCenterActionItem[],
  { limit = 6 }: { limit?: number } = {},
): CommandCenterQueue {
  const allItems = [...items].sort((left, right) => {
    if (left.severity !== right.severity) return left.severity - right.severity;
    return left.title.localeCompare(right.title);
  });

  return {
    allItems,
    visibleItems: allItems.slice(0, Math.max(0, limit)),
    criticalCount: allItems.filter((item) => item.severity === 0).length,
    primaryAction: allItems[0] ?? null,
  };
}
