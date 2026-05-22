import type { Task } from "@/types/database";

export function removeTaskById<T extends { id: string }>(items: T[], taskId: string): T[] {
  const next = items.filter((item) => item.id !== taskId);
  return next.length === items.length ? items : next;
}

export function mergeRealtimeTaskRow<T extends { id: string }>(
  items: T[],
  row: Task,
  options: {
    shouldInclude?: (row: Task) => boolean;
    decorate?: (row: Task, existing: T | null) => T;
  } = {},
): T[] {
  if (row.deleted_at || (options.shouldInclude && !options.shouldInclude(row))) {
    return removeTaskById(items, row.id);
  }

  const existing = items.find((item) => item.id === row.id) ?? null;
  const nextItem = options.decorate
    ? options.decorate(row, existing)
    : ({ ...existing, ...row } as unknown as T);

  if (!existing) {
    return [nextItem, ...items];
  }

  return items.map((item) => (item.id === row.id ? nextItem : item));
}
