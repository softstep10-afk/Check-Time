import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const workerShell = read("src/components/worker/WorkerShell.tsx");
const clockPage = read("src/components/worker/ClockPage.tsx");
const supabaseClient = read("src/lib/supabase/client.ts");
const sw = read("src/app/sw.ts");
const navActions = read("src/components/shared/ProjectNavigationActions.tsx");
const googleMaps = read("src/components/maps/GoogleMaps.tsx");

// PWA Task 5 — worker surfaces offline QA. These pin the offline paths that
// weren't already covered by offline-readable-cache-source / offline-field-* /
// offline-time-events tests, so the behaviors verified in Task 5 can't silently
// regress. (Snapshot read/write wiring for /my-tasks, /my-projects, /project/:id
// is pinned by offline-readable-cache-source.test.ts.)

describe("Task 5 — /clock offline path", () => {
  it("queues clock events with a device client_event_id and overlays them on the shell", () => {
    expect(workerShell).toContain("queueOfflineEvent");
    expect(workerShell).toContain("applyQueuedEventsToShell");
    expect(workerShell).toContain("crypto.randomUUID");
    expect(workerShell).toContain("client_event_id");
    // Offline-first: when the browser is already offline, skip the network and
    // queue immediately instead of waiting for a doomed request.
    expect(workerShell).toContain("navigator.onLine");
  });

  it("renders /clock from the shell context (no blocking fetch → no blank offline)", () => {
    expect(clockPage).toContain("useWorkerShell()");
    // Shift + project state come from the shared shell, not a page-level fetch.
    expect(clockPage).toContain("shell.clockState");
    expect(clockPage).toContain("shell.projects");
    expect(clockPage).not.toContain('fetch("/api/worker');
  });
});

describe("Task 5 — no false auth-expired redirect while offline", () => {
  it("skips auth-expired classification on offline / status-0 responses", () => {
    expect(supabaseClient).toContain("navigator.onLine === false");
    expect(supabaseClient).toContain("response.status === 0");
    expect(supabaseClient).toContain("shouldSkipAuthExpiredClassification");
  });
});

describe("Task 5 — maps/directions degrade gracefully offline", () => {
  it("the service worker only caches same-origin assets, so Google Maps (cross-origin) is never cached", () => {
    // Every runtime matcher is gated on sameOrigin; maps.googleapis.com is
    // cross-origin and can therefore never be intercepted/cached by the SW.
    const matchers = sw.match(/matcher:\s*\(\{[^}]*\}\)\s*=>[\s\S]*?handler:/g) ?? [];
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher).toContain("sameOrigin");
    }
    expect(sw).not.toContain("googleapis");
  });

  it("directions actions are pure (no map script load) and keep the address available offline", () => {
    expect(navActions).not.toContain("useJsApiLoader");
    expect(navActions).not.toContain("<GoogleMap");
    expect(navActions).toContain("buildGoogleMapsDirectionsUrl");
    expect(navActions).toContain("buildProjectAddressCopyText");
  });

  it("the map container shows an offline-aware fallback instead of an uncaught error", () => {
    expect(googleMaps).toContain("loadError");
    expect(googleMaps).toContain("navigator.onLine === false");
    expect(googleMaps).toContain("offlineUnavailable");
  });
});
