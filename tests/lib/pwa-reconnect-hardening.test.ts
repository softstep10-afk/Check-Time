import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOfflineCacheKey,
  clearOfflineSnapshotsForActor,
} from "@/lib/offline-field-cache";
import { OFFLINE_KEY as TIME_EVENTS_KEY } from "@/lib/offline-time-events";
import { OFFLINE_FIELD_ACTIONS_KEY } from "@/lib/offline-field-actions";
import { OFFLINE_KEY as UPLOADS_KEY } from "@/lib/offline-uploads";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const workerShell = read("src/components/worker/WorkerShell.tsx");
const providers = read("src/app/providers.tsx");

// PWA Task 6 — queue reconnect + auth-expiry hardening.

// ── Invariant 1: logout clears snapshots, NEVER the pending-work queues ──
function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("logout clears offline snapshots but preserves the pending-work queues", () => {
  it("clearOfflineSnapshotsForActor removes cc_offline_field_cache but leaves cc_offline_* queues intact", () => {
    const store = installStorage();
    const actorId = "worker-1";

    // Queued work (must survive logout) + a scoped snapshot (may be cleared).
    store.set(TIME_EVENTS_KEY, "[{queued clock event}]");
    store.set(OFFLINE_FIELD_ACTIONS_KEY, "[{queued task action}]");
    store.set(UPLOADS_KEY, "[{queued upload}]");
    store.set(buildOfflineCacheKey(actorId, "org-1", "worker-tasks"), "{snapshot}");

    const removed = clearOfflineSnapshotsForActor(actorId);

    expect(removed).toBe(1);
    // Queues survive — the crew's queued work is not touched on logout.
    expect(store.get(TIME_EVENTS_KEY)).toBe("[{queued clock event}]");
    expect(store.get(OFFLINE_FIELD_ACTIONS_KEY)).toBe("[{queued task action}]");
    expect(store.get(UPLOADS_KEY)).toBe("[{queued upload}]");
    // Snapshot cleared.
    expect(store.has(buildOfflineCacheKey(actorId, "org-1", "worker-tasks"))).toBe(false);
  });
});

describe("Task 6 source invariants", () => {
  it("invariant 1: handleSignOut clears snapshots only, and nothing wipes localStorage or a queue", () => {
    expect(workerShell).toContain("clearOfflineSnapshotsForActor(shell.profile.id)");
    // No blunt wipes that would take queued work with them.
    expect(workerShell).not.toContain("localStorage.clear");
    expect(workerShell).not.toContain('localStorage.removeItem("cc_offline');
  });

  it("invariant 1: the auth-expired redirect goes to /login?expired=1 without clearing localStorage", () => {
    expect(providers).toContain('router.push("/login?expired=1")');
    expect(providers).not.toContain("localStorage");
    expect(providers).not.toContain("removeItem");
    expect(providers).not.toContain("clearOfflineSnapshots");
  });

  it("invariant 2: the reconnect drain gates on a valid session before replaying", () => {
    // getUser() gate sits inside drainOfflineQueue, before setDraining/replay.
    expect(workerShell).toContain("const drainOfflineQueue");
    expect(workerShell).toContain("await supabase.auth.getUser()");
    expect(workerShell).toContain("if (drainAuthError || !drainUser) return;");
    // The gate must precede setDraining (i.e. precede the replay loops).
    const drainStart = workerShell.indexOf("const drainOfflineQueue");
    const gateAt = workerShell.indexOf("if (drainAuthError || !drainUser) return;", drainStart);
    const setDrainingAt = workerShell.indexOf("setDraining(true)", drainStart);
    expect(gateAt).toBeGreaterThan(drainStart);
    expect(gateAt).toBeLessThan(setDrainingAt);
  });

  it("invariant 5: auto-drain re-fires when back online (post-reauth drain path)", () => {
    expect(workerShell).toContain("if (!isOnline) return;");
    expect(workerShell).toContain("void drainOfflineQueue();");
  });
});
