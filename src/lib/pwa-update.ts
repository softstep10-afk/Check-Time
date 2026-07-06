// Pure, framework-free helpers for the PWA update-delivery layer (Task 3).
// Kept DOM-free so the decisions can be unit-tested without a service worker.
// The React glue lives in src/lib/hooks/usePwaUpdate.ts and the banner in
// WorkerShell; the SW-side cache cleanup lives in src/app/sw.ts.

/**
 * True when the running service worker's build SHA differs from the SHA the
 * currently-loaded app was built with — i.e. a newer deploy is live and the tab
 * is running stale JS. Both must be present; a missing/empty value never
 * reports an update (avoids false positives in envs without a build SHA).
 */
export function isNewerSwVersion(
  swVersion: string | null | undefined,
  appVersion: string | null | undefined,
): boolean {
  return Boolean(swVersion && appVersion && swVersion !== appVersion);
}

/**
 * True when any offline queue still holds unsynced work. While this is true the
 * update must NOT auto-reload (a reload would drop the tab mid-sync) — the banner
 * shows "held for sync" instead of offering the one-tap reload. Mirrors the
 * three localStorage queues: cc_offline_time_events, cc_offline_field_actions,
 * cc_offline_uploads.
 */
export function hasPendingOfflineWork(sizes: {
  timeEvents: number;
  fieldActions: number;
  uploads: number;
}): boolean {
  return sizes.timeEvents > 0 || sizes.fieldActions > 0 || sizes.uploads > 0;
}
