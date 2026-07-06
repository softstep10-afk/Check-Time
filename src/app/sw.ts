/// <reference lib="esnext" />
/// <reference lib="webworker" />

// PWA Task 2 — Serwist service-worker skeleton.
//
// SCOPE OF THIS FILE (deliberately minimal):
//  - Precache immutable build assets + public PWA assets (Serwist injects the
//    manifest into `self.__SW_MANIFEST`; dev builds inject nothing).
//  - Runtime caching is effectively OFF: only /_next/static/** and the public
//    PWA assets are CacheFirst. Everything else — all /api/**, Supabase
//    auth/rest/realtime/storage, RSC/flight, signed Storage/Mux URLs,
//    payroll/manager/admin/archive, Google Maps, AI/transcode, and navigations
//    — has NO matching route, so Serwist passes it straight to the network
//    ("Without a default handler, unmatched requests will go against the
//    network."). That is the recon's NetworkOnly requirement, by omission.
//  - No navigation fallback / offline shell (that is Task 4).
//  - No update prompt, version compare, or auto-reload (that is Task 3). This
//    file only EXPOSES its build version to controlled clients on request.
//
// This file is compiled by esbuild (via src/app/serwist/[path]/route.ts) with
// the `webworker` lib, NOT by the app's tsc pass (it is excluded in tsconfig).

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Injected at build time by esbuild `define` in the Serwist route handler.
declare const __APP_BUILD_SHA__: string;

const BUILD_SHA =
  typeof __APP_BUILD_SHA__ === "string" && __APP_BUILD_SHA__ ? __APP_BUILD_SHA__ : "dev";

// Versioned cache-name prefix so a new deploy lands in fresh caches. Cleanup of
// stale `ct-app-*` caches on activate is intentionally left to Task 3 (update
// lifecycle); Serwist already prunes its own precache across revisions.
const CACHE_PREFIX = `ct-app-${BUILD_SHA}`;

// Expose the running SW's build version to controlled clients. Task 3 will
// query this (GET_SW_VERSION) and compare it against APP_BUILD_COMMIT_SHA to
// drive the update prompt. Read-only: no caching or reload behavior here.
self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === "GET_SW_VERSION") {
    event.ports[0]?.postMessage({ type: "SW_VERSION", version: BUILD_SHA });
  }
});

const runtimeCaching: RuntimeCaching[] = [
  {
    // Immutable, content-hashed build assets — safe to serve cache-first.
    matcher: ({ url, sameOrigin }) =>
      sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({ cacheName: `${CACHE_PREFIX}-static` }),
  },
  {
    // Public PWA assets (manifest + icons + favicon). Never documents.
    matcher: ({ url, sameOrigin, request }) =>
      sameOrigin &&
      request.destination !== "document" &&
      /^\/(manifest\.json|icon-192\.png|icon-512\.png|favicon\.ico)$/.test(url.pathname),
    handler: new CacheFirst({ cacheName: `${CACHE_PREFIX}-assets` }),
  },
  // NOTE: no catch-all route. Everything not matched above is passed through to
  // the network by Serwist (NetworkOnly by omission) — see the header comment.
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cacheName: `${CACHE_PREFIX}-precache` },
  skipWaiting: true,
  clientsClaim: true,
  // Enabled alongside the offline navigation fallback in Task 4; leaving it off
  // now avoids an unconsumed-preload warning since there is no nav handler yet.
  navigationPreload: false,
  runtimeCaching,
});

serwist.addEventListeners();
