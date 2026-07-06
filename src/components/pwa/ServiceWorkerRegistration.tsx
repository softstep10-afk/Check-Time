"use client";

import { useEffect } from "react";

/**
 * PWA Task 2 — service-worker registration only.
 *
 * Registers the Serwist worker app-wide (scope "/") with updateViaCache: "none"
 * so the browser never reuses a stale worker script from the HTTP cache. Mounted
 * in providers.tsx (app-wide client concerns), deliberately separate from
 * WorkerShell's queue/message logic.
 *
 * Production only: a worker with skipWaiting + clientsClaim + precache would
 * hijack Turbopack chunk requests in dev and break HMR. Gating to production
 * keeps the dev workflow unchanged and means the worker stays inert until a
 * prod deploy — which is why this branch waits for Task 3 (update delivery).
 *
 * No update prompt, version compare, or auto-reload here — that is Task 3.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/serwist/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error) => {
        console.warn("[pwa] service worker registration failed:", error);
      });
  }, []);

  return null;
}
