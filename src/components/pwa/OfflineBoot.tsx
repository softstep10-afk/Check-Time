"use client";

import { useEffect } from "react";

// PWA Task 4 — warm the /offline boot shell into the browser HTTP cache while
// online, so it can be served when the network is gone WITHOUT the service worker
// intercepting a navigation (the Task 2.1 guardrail forbids SW nav handling). The
// SW's /_next/static CacheFirst already covers the shell's chunks; this covers the
// document. Fire-and-forget, production only, once a service worker is active.
export function OfflineBoot() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!navigator.onLine) return;

    navigator.serviceWorker.ready
      .then(() => fetch("/offline", { credentials: "same-origin" }))
      .catch(() => {
        // Best-effort cache warming — a failure just means the shell isn't
        // pre-cached this session; nothing user-facing depends on it succeeding.
      });
  }, []);

  return null;
}
