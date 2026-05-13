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
  totalCount: number;
  criticalCount: number;
  warningCount: number;
  lowCount: number;
  hasActions: boolean;
  primaryAction: CommandCenterActionItem | null;
};

export function buildCommandCenterQueue(
  items: CommandCenterActionItem[],
  { limit = 6 }: { limit?: number } = {},
): CommandCenterQueue {
  const allItems = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      if (left.item.severity !== right.item.severity) {
        return left.item.severity - right.item.severity;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
  const criticalCount = allItems.filter((item) => item.severity === 0).length;
  const warningCount = allItems.filter((item) => item.severity === 1).length;
  const lowCount = allItems.filter((item) => item.severity === 2).length;

  return {
    allItems,
    visibleItems: allItems.slice(0, Math.max(0, limit)),
    totalCount: allItems.length,
    criticalCount,
    warningCount,
    lowCount,
    hasActions: allItems.length > 0,
    primaryAction: allItems[0] ?? null,
  };
}
