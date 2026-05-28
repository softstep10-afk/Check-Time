import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_FIELD_ACTIONS_CHANGED_EVENT,
  OFFLINE_FIELD_ACTIONS_KEY,
  isNetworkLikeFieldError,
  loadOfflineFieldActionQueue,
  markOfflineFieldActionStatus,
  queueOfflineFieldAction,
  removeOfflineFieldAction,
} from "@/lib/offline-field-actions";

function installStorage() {
  const store = new Map<string, string>();
  const dispatchEvent = vi.fn();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent,
  });
  return { store, dispatchEvent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline field action queue", () => {
  it("queues task claims in localStorage and emits a change signal", () => {
    const { store, dispatchEvent } = installStorage();

    const result = queueOfflineFieldAction({
      clientActionId: "claim-worker-task-1",
      dedupeKey: "claim-worker-task-1",
      kind: "task_claim",
      actorId: "worker-1",
      orgId: "org-1",
      payload: { taskId: "task-1" },
    });

    expect(result.item.status).toBe("pending");
    expect(loadOfflineFieldActionQueue()).toHaveLength(1);
    expect(store.get(OFFLINE_FIELD_ACTIONS_KEY)).toContain("task_claim");
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: OFFLINE_FIELD_ACTIONS_CHANGED_EVENT }),
    );
  });

  it("dedupes duplicate task and material claim actions by stable key", () => {
    installStorage();

    const first = queueOfflineFieldAction({
      clientActionId: "claim-worker-task-1",
      dedupeKey: "claim-worker-task-1",
      kind: "task_claim",
      actorId: "worker-1",
      orgId: "org-1",
      payload: { taskId: "task-1" },
    });
    const second = queueOfflineFieldAction({
      clientActionId: "claim-worker-task-1",
      dedupeKey: "claim-worker-task-1",
      kind: "task_claim",
      actorId: "worker-1",
      orgId: "org-1",
      payload: { taskId: "task-1" },
    });

    expect(first.alreadyQueued).toBe(false);
    expect(second.alreadyQueued).toBe(true);
    expect(second.item.id).toBe(first.item.id);
    expect(loadOfflineFieldActionQueue()).toHaveLength(1);
  });

  it("preserves queued task status payload until sync removes it", () => {
    installStorage();

    const { item } = queueOfflineFieldAction({
      clientActionId: "status-worker-task-1-done",
      dedupeKey: "status-worker-task-1-done",
      kind: "task_status",
      actorId: "worker-1",
      orgId: "org-1",
      payload: {
        taskId: "task-1",
        nextStatus: "done",
        updatePayload: {
          status: "done",
          completed_at: "2026-05-27T10:00:00.000Z",
          completed_by: "worker-1",
        },
      },
    });

    markOfflineFieldActionStatus(item.id, {
      status: "syncing",
      lastAttemptAt: "2026-05-27T10:01:00.000Z",
    });
    expect(loadOfflineFieldActionQueue()[0]?.status).toBe("syncing");

    removeOfflineFieldAction(item.id);
    expect(loadOfflineFieldActionQueue()).toEqual([]);
  });

  it("classifies weak-network errors for queued retry instead of fake success", () => {
    expect(isNetworkLikeFieldError(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkLikeFieldError({ message: "network timeout" })).toBe(true);
    expect(isNetworkLikeFieldError(new Error("permission denied"))).toBe(false);
  });
});
