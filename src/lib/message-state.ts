import type { MessagePriority } from "@/lib/message-types";

export type MessageStateItem = {
  id: string;
  created_at: string;
  read?: boolean;
};

export function isTaskMessagePriority(priority: unknown): priority is Extract<MessagePriority, "task"> {
  return priority === "task";
}

export function mergeMessagesById<T extends MessageStateItem>(
  current: readonly T[],
  incoming: T | readonly T[],
): T[] {
  const rows = Array.isArray(incoming) ? incoming : [incoming];
  const byId = new Map<string, T>();
  for (const message of current) {
    byId.set(message.id, message);
  }
  for (const message of rows) {
    const existing = byId.get(message.id);
    byId.set(message.id, existing ? { ...existing, ...message } : message);
  }
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
}

export function markMessagesReadById<T extends MessageStateItem>(
  messages: readonly T[],
  ids: Iterable<string>,
): T[] {
  const idSet = new Set(ids);
  if (idSet.size === 0) return [...messages];
  return messages.map((message) =>
    idSet.has(message.id) ? { ...message, read: true } : message,
  );
}

export function isPrivateMessageVisibleToProfile(
  message: { sender_id?: string | null; recipient_id?: string | null },
  profileId: string,
): boolean {
  return message.sender_id === profileId || message.recipient_id === profileId;
}

export function buildPrivateMessageParticipantFilter(profileId: string): string {
  return `sender_id.eq.${profileId},recipient_id.eq.${profileId}`;
}

export function readLinkedTaskId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const taskId = metadata?.task_id;
  return typeof taskId === "string" && taskId.trim().length > 0 ? taskId : null;
}

export function buildMessageTaskMetadata(
  metadata: Record<string, unknown> | null | undefined,
  taskId: string,
  taskCreatedAt: string,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    priority: "task",
    task_id: taskId,
    task_created_at: taskCreatedAt,
  };
}
