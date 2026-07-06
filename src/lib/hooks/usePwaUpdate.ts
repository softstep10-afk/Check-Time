import { useEffect, useState } from "react";
import { isNewerSwVersion } from "@/lib/pwa-update";

// The SHA the currently-loaded app bundle was built with (inlined by next.config
// `env`). The service worker reports its own SHA via GET_SW_VERSION (Task 2); a
// mismatch means a newer deploy is live.
const APP_SHA = process.env.APP_BUILD_COMMIT_SHA ?? "";

// Don't re-hit the network with registration.update() more than this often —
// 'focus' and 'visibilitychange' can both fire on a single tab switch.
const MIN_UPDATE_CHECK_INTERVAL_MS = 8_000;

/**
 * Ask a specific service worker for its build SHA (the GET_SW_VERSION contract
 * exposed by src/app/sw.ts). Resolves null if the worker doesn't answer.
 */
function querySwVersion(worker: ServiceWorker | null): Promise<string | null> {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 2_000);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      const data = event.data as { type?: string; version?: string } | null;
      resolve(
        data?.type === "SW_VERSION" && typeof data.version === "string" ? data.version : null,
      );
    };
    try {
      worker.postMessage({ type: "GET_SW_VERSION" }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * PWA Task 3 — detects when the active/waiting service worker no longer matches
 * the loaded app's build (a new deploy is live), and nudges the browser to look
 * for a new worker on the events the recon lists (start / online / focus /
 * visible). Returns a sticky `updateAvailable` flag; the WorkerShell banner
 * decides how to surface it (one-tap reload vs. held-for-sync).
 *
 * This hook only READS the registration created by ServiceWorkerRegistration —
 * it never registers, reloads, or touches offline queues. Production only (there
 * is no service worker in dev).
 */
export function usePwaUpdate(): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!APP_SHA) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | null = null;
    let lastCheckAt = 0;

    // Compare the newest known worker's SHA against the loaded app's SHA.
    const evaluate = async () => {
      if (disposed || !registration) return;
      const candidate =
        registration.waiting ??
        registration.installing ??
        registration.active ??
        navigator.serviceWorker.controller;
      const swVersion = await querySwVersion(candidate);
      if (!disposed && isNewerSwVersion(swVersion, APP_SHA)) {
        setUpdateAvailable(true);
      }
    };

    // Nudge the browser to fetch a fresh worker script, then re-evaluate.
    const check = async () => {
      if (disposed || !registration) return;
      const now = Date.now();
      if (now - lastCheckAt < MIN_UPDATE_CHECK_INTERVAL_MS) return;
      lastCheckAt = now;
      try {
        await registration.update();
      } catch {
        // Offline / transient — the version compare below still runs.
      }
      void evaluate();
    };

    const onOnline = () => void check();
    const onFocus = () => void check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onControllerChange = () => void evaluate();

    navigator.serviceWorker.ready
      .then((reg) => {
        if (disposed) return;
        registration = reg;
        void check(); // on app start
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" || installing.state === "activated") {
              void evaluate();
            }
          });
        });
      })
      .catch(() => {
        // No active worker (e.g. first load before activation) — the listeners
        // below still catch a later controllerchange.
      });

    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return { updateAvailable };
}
