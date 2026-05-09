import { getAttachmentMediaIds } from "@/lib/task-attachments";
import { getCompletionMediaIds } from "@/lib/task-notifications";

export function collectTaskReferencedMediaIds(tasks: Array<{ metadata?: unknown }>): string[] {
  return Array.from(
    new Set(
      tasks.flatMap((task) => [
        ...getAttachmentMediaIds(task),
        ...getCompletionMediaIds(task),
      ]),
    ),
  );
}

export function mergeMediaWithTaskReferences<T extends { id: string }>(
  baseMedia: T[],
  allKnownMedia: T[],
  referencedIds: Iterable<string>,
): T[] {
  const byId = new Map<string, T>();
  for (const item of baseMedia) byId.set(item.id, item);
  const allById = new Map(allKnownMedia.map((item) => [item.id, item]));
  for (const id of referencedIds) {
    const item = allById.get(id);
    if (item) byId.set(id, item);
  }
  return [...byId.values()];
}
