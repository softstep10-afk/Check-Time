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
//  - It EXPOSES its build version to controlled clients on request
//    (GET_SW_VERSION) and, on activate, cleans up previous-deploy caches. The
//    client-side update prompt / one-tap reload lives in WorkerShell (Task 3);
//    this file never reloads clients or touches localStorage.
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

// Versioned cache-name prefix so a new deploy lands in fresh caches (all of this
// SW's caches are `${CACHE_PREFIX}-*`). The activate handler below drops caches
// from previous deploys.
const CACHE_PREFIX = `ct-app-${BUILD_SHA}`;

// On activate, delete caches left by previous deploys (any `ct-app-*` that is not
// this build's `${CACHE_PREFIX}-*`). This only uses the Cache Storage API — it
// never reads or clears localStorage, so the offline queues/snapshots
// (cc_offline_time_events, cc_offline_field_actions, cc_offline_uploads, the
// field-cache snapshots) are untouched. Runs alongside Serwist's own activate
// listener (clientsClaim + precache pruning); service-worker listeners are additive.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("ct-app-") && !key.startsWith(`${CACHE_PREFIX}-`))
          .map((key) => caches.delete(key)),
      );
    })(),
  );
});

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
