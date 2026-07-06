import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasPendingOfflineWork, isNewerSwVersion } from "@/lib/pwa-update";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("isNewerSwVersion", () => {
  it("flags an update when the SW SHA differs from the app SHA", () => {
    expect(isNewerSwVersion("newsha", "oldsha")).toBe(true);
  });

  it("no update when the versions match (same deploy)", () => {
    expect(isNewerSwVersion("sha", "sha")).toBe(false);
  });

  it("never flags when either side is missing (no false positives)", () => {
    expect(isNewerSwVersion(null, "sha")).toBe(false);
    expect(isNewerSwVersion("sha", "")).toBe(false);
    expect(isNewerSwVersion(undefined, undefined)).toBe(false);
    expect(isNewerSwVersion("", "sha")).toBe(false);
  });
});

describe("hasPendingOfflineWork", () => {
  it("is false only when all three queues are empty", () => {
    expect(hasPendingOfflineWork({ timeEvents: 0, fieldActions: 0, uploads: 0 })).toBe(false);
  });

  it("is true when any single queue is non-empty", () => {
    expect(hasPendingOfflineWork({ timeEvents: 1, fieldActions: 0, uploads: 0 })).toBe(true);
    expect(hasPendingOfflineWork({ timeEvents: 0, fieldActions: 2, uploads: 0 })).toBe(true);
    expect(hasPendingOfflineWork({ timeEvents: 0, fieldActions: 0, uploads: 3 })).toBe(true);
  });
});

// Source guardrails for the update-delivery plumbing (Task 3).
describe("pwa update-delivery plumbing (Task 3)", () => {
  const sw = readSource("src/app/sw.ts");
  const hook = readSource("src/lib/hooks/usePwaUpdate.ts");
  const shell = readSource("src/components/worker/WorkerShell.tsx");

  it("SW deletes only previous-deploy caches on activate, never localStorage", () => {
    expect(sw).toContain('addEventListener("activate"');
    expect(sw).toContain("caches.keys()");
    expect(sw).toContain("caches.delete");
    expect(sw).toContain('key.startsWith("ct-app-")');
    expect(sw).toContain("!key.startsWith(`${CACHE_PREFIX}-`)");
    // Cache Storage API only — no localStorage member access in the worker (the
    // word may appear in comments explaining the queues are left alone).
    expect(sw).not.toMatch(/localStorage\.\w/);
  });

  it("hook compares SHAs and calls update() on start/online/focus/visible", () => {
    expect(hook).toContain("APP_BUILD_COMMIT_SHA");
    expect(hook).toContain("isNewerSwVersion");
    expect(hook).toContain("GET_SW_VERSION");
    expect(hook).toContain("registration.update()");
    expect(hook).toContain('"online"');
    expect(hook).toContain('"focus"');
    expect(hook).toContain('"visibilitychange"');
    expect(hook).toContain('"controllerchange"');
    // Detection only — the hook never registers or reloads.
    expect(hook).not.toContain(".register(");
    expect(hook).not.toContain("location.reload");
  });

  it("WorkerShell holds the reload while offline work is pending", () => {
    expect(shell).toContain("usePwaUpdate()");
    expect(shell).toContain("hasPendingOfflineWork");
    expect(shell).toContain("pwa.updateHeldForSync");
    expect(shell).toContain("pwa.updateAvailable");
    // The one-tap reload is gated behind !offlineWorkPending.
    expect(shell).toContain("offlineWorkPending ? null : (");
    expect(shell).toContain("window.location.reload()");
  });
});
