import type { MessagePriority } from "@/lib/message-types";
import type { TaskStatus } from "@/types/database";

export const OFFLINE_FIELD_ACTIONS_KEY = "cc_offline_field_actions";
export const OFFLINE_FIELD_ACTIONS_CHANGED_EVENT = "cc-offline-field-actions-changed";

export type OfflineFieldActionStatus = "pending" | "syncing" | "failed";

export type OfflineMessageRow = {
  org_id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  color: string;
  priority?: MessagePriority;
  attachment: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

export type OfflineFieldAction =
  | {
      id: string;
      clientActionId: string;
      dedupeKey: string;
      kind: "task_claim";
      actorId: string;
      orgId: string;
      status: OfflineFieldActionStatus;
      retryCount: number;
      queuedAt: string;
      lastAttemptAt: string | null;
      lastErrorMessage: string | null;
      payload: {
        taskId: string;
      };
    }
  | {
      id: string;
      clientActionId: string;
      dedupeKey: string;
      kind: "task_status";
      actorId: string;
      orgId: string;
      status: OfflineFieldActionStatus;
      retryCount: number;
      queuedAt: string;
      lastAttemptAt: string | null;
      lastErrorMessage: string | null;
      payload: {
        taskId: string;
        nextStatus: TaskStatus;
        updatePayload: Record<string, unknown>;
      };
    }
  | {
      id: string;
      clientActionId: string;
      dedupeKey: string;
      kind: "message_send";
      actorId: string;
      orgId: string;
      status: OfflineFieldActionStatus;
      retryCount: number;
      queuedAt: string;
      lastAttemptAt: string | null;
      lastErrorMessage: string | null;
      payload: {
        rows: OfflineMessageRow[];
        priority: MessagePriority;
        taskProjectId: string | null;
        taskSource: "direct_task" | "broadcast_task" | null;
      };
    };

export type QueueOfflineFieldActionInput = Omit<
  OfflineFieldAction,
  "id" | "status" | "retryCount" | "queuedAt" | "lastAttemptAt" | "lastErrorMessage"
> & {
  id?: string;
};

function emitQueueChanged() {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(OFFLINE_FIELD_ACTIONS_CHANGED_EVENT));
  } catch {
    // ignore
  }
}

function persist(items: OfflineFieldAction[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(OFFLINE_FIELD_ACTIONS_KEY, JSON.stringify(items));
    emitQueueChanged();
    return true;
  } catch {
    return false;
  }
}

export function createOfflineFieldActionId(prefix = "field-action"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadOfflineFieldActionQueue(): OfflineFieldAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_FIELD_ACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is OfflineFieldAction => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Partial<OfflineFieldAction>;
      return (
        typeof item.id === "string" &&
        typeof item.clientActionId === "string" &&
        typeof item.dedupeKey === "string" &&
        typeof item.actorId === "string" &&
        typeof item.orgId === "string" &&
        (item.kind === "task_claim" ||
          item.kind === "task_status" ||
          item.kind === "message_send")
      );
    });
  } catch {
    return [];
  }
}

export function queueOfflineFieldAction(
  input: QueueOfflineFieldActionInput,
): { item: OfflineFieldAction; queue: OfflineFieldAction[]; alreadyQueued: boolean } {
  const current = loadOfflineFieldActionQueue();
  const existing = current.find((item) => item.dedupeKey === input.dedupeKey);
  if (existing) {
    return { item: existing, queue: current, alreadyQueued: true };
  }

  const now = new Date().toISOString();
  const item = {
    ...input,
    id: input.id ?? createOfflineFieldActionId(input.kind),
    status: "pending",
    retryCount: 0,
    queuedAt: now,
    lastAttemptAt: null,
    lastErrorMessage: null,
  } as OfflineFieldAction;
  const next = [...current, item];
  persist(next);
  return { item, queue: next, alreadyQueued: false };
}

export function removeOfflineFieldAction(id: string): OfflineFieldAction[] {
  const next = loadOfflineFieldActionQueue().filter((item) => item.id !== id);
  persist(next);
  return next;
}

export function markOfflineFieldActionStatus(
  id: string,
  patch: Partial<
    Pick<
      OfflineFieldAction,
      "status" | "retryCount" | "lastAttemptAt" | "lastErrorMessage"
    >
  >,
): OfflineFieldAction[] {
  const next = loadOfflineFieldActionQueue().map((item) =>
    item.id === id ? ({ ...item, ...patch } as OfflineFieldAction) : item,
  );
  persist(next);
  return next;
}

export function countPendingOfflineFieldActions(items = loadOfflineFieldActionQueue()): number {
  return items.filter((item) => item.status === "pending" || item.status === "syncing").length;
}

export function isNetworkLikeFieldError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error);
  const text = message.toLowerCase();
  return (
    text.includes("fetch") ||
    text.includes("network") ||
    text.includes("load failed") ||
    text.includes("connection") ||
    text.includes("offline") ||
    text.includes("timeout") ||
    text.includes("failed to fetch")
  );
}
