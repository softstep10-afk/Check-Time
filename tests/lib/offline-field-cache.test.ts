import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_FIELD_CACHE_PREFIX,
  buildOfflineCacheKey,
  clearOfflineSnapshotsForActor,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
} from "@/lib/offline-field-cache";

function installStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  vi.stubGlobal("window", { localStorage });
  return { store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offline field readable cache", () => {
  it("namespaces cache keys by org, actor, scope, and item id", () => {
    const key = buildOfflineCacheKey("worker-1", "org-1", "worker-project-detail", "project-1");

    expect(key).toContain(OFFLINE_FIELD_CACHE_PREFIX);
    expect(key).toContain("org-1");
    expect(key).toContain("worker-1");
    expect(key).toContain("worker-project-detail");
    expect(key).toContain("project-1");
  });

  it("saves and loads a last-known snapshot for the same actor only", () => {
    installStorage();
    const actor = { actorId: "worker-1", orgId: "org-1" };

    expect(saveOfflineSnapshot(actor, "worker-tasks", { tasks: [{ id: "task-1" }] })).toBe(true);

    expect(loadOfflineSnapshot<{ tasks: Array<{ id: string }> }>(actor, "worker-tasks")?.payload)
      .toEqual({ tasks: [{ id: "task-1" }] });
    expect(loadOfflineSnapshot({ actorId: "worker-2", orgId: "org-1" }, "worker-tasks"))
      .toBeNull();
    expect(loadOfflineSnapshot({ actorId: "worker-1", orgId: "org-2" }, "worker-tasks"))
      .toBeNull();
  });

  it("ignores corrupt cache entries safely", () => {
    const { store } = installStorage();
    const actor = { actorId: "worker-1", orgId: "org-1" };
    store.set(buildOfflineCacheKey(actor.actorId, actor.orgId, "worker-messages"), "{bad json");

    expect(loadOfflineSnapshot(actor, "worker-messages")).toBeNull();
  });

  it("scrubs secrets, pins, tokens, and signed URLs before writing snapshots", () => {
    installStorage();
    const actor = { actorId: "worker-1", orgId: "org-1" };

    saveOfflineSnapshot(actor, "worker-project-detail", {
      project: { id: "project-1", name: "Kitchen" },
      pin_hash: "must-not-cache",
      token: "must-not-cache",
      nested: {
        signed_url: "https://example.test/signed",
        publicUrl: "https://example.test/public",
        safe: "kept",
      },
    });

    const raw = JSON.stringify(loadOfflineSnapshot(actor, "worker-project-detail")?.payload);
    expect(raw).toContain("Kitchen");
    expect(raw).toContain("kept");
    expect(raw).not.toContain("must-not-cache");
    expect(raw).not.toContain("signed");
    expect(raw).not.toContain("public");
  });

  it("clears only the selected actor snapshots on logout", () => {
    installStorage();
    const actorA = { actorId: "worker-1", orgId: "org-1" };
    const actorB = { actorId: "worker-2", orgId: "org-1" };
    saveOfflineSnapshot(actorA, "worker-tasks", { tasks: [{ id: "task-a" }] });
    saveOfflineSnapshot(actorA, "worker-projects", { projects: [{ id: "project-a" }] });
    saveOfflineSnapshot(actorB, "worker-tasks", { tasks: [{ id: "task-b" }] });

    expect(clearOfflineSnapshotsForActor(actorA.actorId)).toBe(2);
    expect(loadOfflineSnapshot(actorA, "worker-tasks")).toBeNull();
    expect(loadOfflineSnapshot(actorA, "worker-projects")).toBeNull();
    expect(loadOfflineSnapshot(actorB, "worker-tasks")).not.toBeNull();
  });
});
