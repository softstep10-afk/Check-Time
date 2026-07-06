import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const nextConfig = readSource("next.config.ts");
const swRoute = readSource("src/app/serwist/[path]/route.ts");
const sw = readSource("src/app/sw.ts");
const registration = readSource("src/components/pwa/ServiceWorkerRegistration.tsx");
const providers = readSource("src/app/providers.tsx");

// PWA Task 2 — Serwist skeleton + registration only. These guard the plumbing
// invariants (and the Task 3 exclusions) against regression.
describe("pwa service-worker plumbing (Task 2)", () => {
  it("wires Serwist for Turbopack and sets no-store + js headers on the SW route", () => {
    expect(nextConfig).toContain('from "@serwist/turbopack"');
    expect(nextConfig).toContain("withSerwist(nextConfig)");
    expect(nextConfig).toContain("/serwist/:path*");
    expect(nextConfig).toContain("application/javascript; charset=utf-8");
    expect(nextConfig).toContain("no-cache, no-store, must-revalidate");
  });

  it("serves the worker from a route that injects the build SHA (no next-pwa)", () => {
    expect(swRoute).toContain("createSerwistRoute");
    expect(swRoute).toContain('swSrc: "src/app/sw.ts"');
    expect(swRoute).toContain("__APP_BUILD_SHA__");
    expect(swRoute).toContain("APP_BUILD_COMMIT_SHA");
    expect(nextConfig).not.toContain("next-pwa");
    expect(swRoute).not.toContain("next-pwa");
  });

  it("keeps runtime caching narrow: build/public assets only, NetworkOnly by omission", () => {
    expect(sw).toContain("self.__SW_MANIFEST");
    expect(sw).toContain("/_next/static/");
    expect(sw).toContain("CacheFirst");
    // No broad Next default cache (would cache pages/RSC/api/maps/fonts).
    expect(sw).not.toContain("defaultCache");
    // Versioned cache names keyed by the injected build SHA.
    expect(sw).toContain("ct-app-");
    expect(sw).toContain("__APP_BUILD_SHA__");
    // Exposes its version to controlled clients (Task 3 compares it).
    expect(sw).toContain("GET_SW_VERSION");
    expect(sw).toContain("skipWaiting: true");
    expect(sw).toContain("clientsClaim: true");
    // No offline navigation fallback in this task (Task 4).
    expect(sw).not.toContain("fallbacks");
    expect(sw).toContain("navigationPreload: false");
  });

  it("registers app-wide from providers with scope / and updateViaCache none, prod-only", () => {
    expect(registration).toContain('register("/serwist/sw.js"');
    expect(registration).toContain('scope: "/"');
    expect(registration).toContain('updateViaCache: "none"');
    expect(registration).toContain('process.env.NODE_ENV !== "production"');
    expect(providers).toContain("<ServiceWorkerRegistration />");
    // Mounted in providers, not WorkerShell: the SW registration must not import
    // WorkerShell or its queue/message modules.
    expect(registration).not.toContain('from "@/components/worker/WorkerShell"');
    expect(registration).not.toContain("offline");
  });

  it("does NOT add Task 3 update-delivery behavior (no auto-reload / version compare here)", () => {
    for (const forbidden of ["location.reload", "window.location.reload", "skipWaiting()", "controllerchange"]) {
      expect(registration).not.toContain(forbidden);
    }
  });
});
