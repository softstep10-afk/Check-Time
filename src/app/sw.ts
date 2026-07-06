/// <reference lib="esnext" />
/// <reference lib="webworker" />

// PWA Task 2.1 — navigation-safe service worker.
//
// WHY THIS WORKER IS ASSET-ONLY:
// A service worker that lets its router touch navigation or RSC (React Server
// Component / "flight") requests can buffer Next.js's streamed responses and
// serialize SPA navigation behind the worker — the regression that got the first
// release reverted (menu clicks 5-23s while direct URL loads stayed fast). The
// prior worker's only navigation guard was `destination !== "document"`, which
// does NOT catch RSC soft-navigations (their destination is ""), and its Serwist
// precache route carried navigation URL heuristics (cleanURLs / directoryIndex).
//
// So this worker NEVER handles navigations or RSC traffic:
//   - NO precache (removed the PrecacheRoute and its navigation heuristics);
//   - every runtime matcher hard-excludes navigations and ALL RSC signals via
//     isNavigationOrRscRequest();
//   - no catch-all, no default handler, no navigation fallback.
// The SW calls respondWith ONLY for same-origin /_next/static/** and the named
// public PWA assets. Everything else — navigations, RSC, /api, Supabase, signed
// URLs, maps, AI — is untouched: no respondWith, browser-native, streaming intact.
//
// Compiled by esbuild via src/app/serwist/[path]/route.ts (webworker lib), not
// the app's tsc pass (excluded in tsconfig).

import type { RuntimeCaching } from "serwist";
import { CacheFirst, Serwist } from "serwist";

declare const self: ServiceWorkerGlobalScope;

// Injected at build time by esbuild `define` in the Serwist route handler.
declare const __APP_BUILD_SHA__: string;

const BUILD_SHA =
  typeof __APP_BUILD_SHA__ === "string" && __APP_BUILD_SHA__ ? __APP_BUILD_SHA__ : "dev";

// Versioned cache-name prefix so a new deploy lands in fresh caches. The activate
// handler drops caches from previous deploys.
const CACHE_PREFIX = `ct-app-${BUILD_SHA}`;

// True for a top-level navigation OR any Next RSC/flight request. These MUST
// bypass the SW entirely — matching one here would let respondWith buffer a
// streamed response and stall SPA navigation. Note that RSC soft-navigations are
// NOT `document` requests (destination is ""), so checking destination/mode alone
// is insufficient; we also inspect the RSC headers, the ?_rsc= param, and the
// flight Accept type.
function isNavigationOrRscRequest(request: Request, url: URL): boolean {
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    request.headers.has("RSC") ||
    request.headers.has("Next-Router-State-Tree") ||
    request.headers.has("Next-Url") ||
    url.searchParams.has("_rsc") ||
    (request.headers.get("Accept") ?? "").includes("text/x-component")
  );
}

// On activate, delete caches left by previous deploys (any `ct-app-*` that is not
// this build's `${CACHE_PREFIX}-*`). Cache Storage API only — it never reads or
// clears localStorage, so the offline queues/snapshots (cc_offline_time_events,
// cc_offline_field_actions, cc_offline_uploads, field-cache) are untouched.
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

// Expose the running SW's build version to controlled clients — the Task 3 update
// prompt compares it against APP_BUILD_COMMIT_SHA. Read-only; no caching/reload.
self.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type === "GET_SW_VERSION") {
    event.ports[0]?.postMessage({ type: "SW_VERSION", version: BUILD_SHA });
  }
});

const runtimeCaching: RuntimeCaching[] = [
  {
    // Immutable, content-hashed build assets. Never a navigation/RSC request.
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin &&
      !isNavigationOrRscRequest(request, url) &&
      url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({ cacheName: `${CACHE_PREFIX}-static` }),
  },
  {
    // Named public PWA assets only: manifest + icons + favicon.
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin &&
      !isNavigationOrRscRequest(request, url) &&
      /^\/(manifest\.json|icon-192\.png|icon-512\.png|favicon\.ico)$/.test(url.pathname),
    handler: new CacheFirst({ cacheName: `${CACHE_PREFIX}-assets` }),
  },
  // No catch-all, no precache, no navigation fallback: any request not matched
  // above (navigations, RSC, /api, Supabase, signed URLs, maps, AI — everything)
  // is passed straight to the network by the browser; the SW never respondWith's it.
];

const serwist = new Serwist({
  // No precache list is passed on purpose: Serwist's PrecacheRoute registers
  // navigation URL heuristics (cleanURLs / directoryIndex) that evaluate nav/RSC
  // requests — the class of bug that stalled SPA navigation. The CacheFirst
  // routes above cache /_next/static/** and the named assets on first fetch.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching,
});

serwist.addEventListeners();
