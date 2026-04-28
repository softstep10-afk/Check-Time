/**
 * Browser-side offline queue for worker clock-in / clock-out events.
 *
 * When the worker hits clock-in or clock-out while offline (or while the
 * supabase insert fails with a network error), WorkerShell hands the
 * payload here. Items live in localStorage under OFFLINE_KEY so they
 * survive a page refresh; on the next 'online' event WorkerShell drains
 * the queue and replays each event against the time_events table.
 *
 * Dedup is achieved via metadata.client_event_id — a UUID generated on
 * the device the moment the worker tapped. The drain helper checks the
 * server first for any existing time_events row with the same
 * client_event_id and skips replay if found, so re-runs of the queue
 * cannot produce duplicate inserts.
 *
 * Strict scope (Phase 1):
 *   - localStorage only, no IndexedDB.
 *   - No DB schema or RLS changes — client_event_id rides along inside
 *     metadata, which is a jsonb column already.
 *   - No payroll changes — pending events live on the device until they
 *     sync, so they cannot reach computePayrollPreview / buildWorkerLines
 *     until they are real time_events rows.
 */

export const OFFLINE_KEY = "cc_offline_time_events";

export type QueuedTimeEventStatus = "pending" | "syncing" | "failed";

export interface QueuedTimeEventPayload {
  org_id: string;
  profile_id: string;
  project_id: string;
  event_type: "clock_in" | "clock_out";
  /** ISO timestamp captured on the device. Never overwritten on retry. */
  event_time: string;
  /**
   * "SRID=4326;POINT(lng lat)" when a real device fix was captured,
   * or null when the worker explicitly chose "Start without GPS"
   * (location_unverified path). We never fabricate coordinates.
   */
  gps_point: string | null;
  gps_accuracy_m: number | null;
  /**
   * "device" — real device GPS fix.
   * "unavailable" — worker started/closed shift without GPS because the
   *   device denied or could not produce a fix. Rendered as No-GPS in
   *   manager surfaces by deriveWorkerGpsStatus (gps_point is null).
   */
  gps_source: "device" | "unavailable";
  video_status: "not_required" | "pending";
  metadata: Record<string, unknown>;
}

export interface QueuedTimeEvent {
  /** UUID generated on the device. Becomes metadata.client_event_id on insert. */
  client_event_id: string;
  status: QueuedTimeEventStatus;
  retryCount: number;
  lastErrorMessage: string | null;
  lastAttemptAt: string | null;
  /** ISO timestamp when the event was queued. Diagnostic only. */
  queuedAt: string;
  payload: QueuedTimeEventPayload;
  /** Local-only UI hints — never sent to the server. */
  ui: {
    projectName: string;
  };
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadOfflineEventQueue(): QueuedTimeEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is QueuedTimeEvent =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as QueuedTimeEvent).client_event_id === "string" &&
        typeof (entry as QueuedTimeEvent).payload === "object",
    );
  } catch {
    return [];
  }
}

function persist(items: QueuedTimeEvent[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(OFFLINE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

export function clearOfflineEventQueue(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OFFLINE_KEY);
  } catch {
    // ignore
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface QueueArgs {
  client_event_id: string;
  payload: QueuedTimeEventPayload;
  projectName: string;
}

export function queueOfflineEvent(args: QueueArgs): QueuedTimeEvent {
  const item: QueuedTimeEvent = {
    client_event_id: args.client_event_id,
    status: "pending",
    retryCount: 0,
    lastErrorMessage: null,
    lastAttemptAt: null,
    queuedAt: new Date().toISOString(),
    payload: args.payload,
    ui: { projectName: args.projectName },
  };
  const next = [...loadOfflineEventQueue(), item];
  persist(next);
  return item;
}

export function removeOfflineEvent(clientEventId: string): QueuedTimeEvent[] {
  const remaining = loadOfflineEventQueue().filter(
    (item) => item.client_event_id !== clientEventId,
  );
  persist(remaining);
  return remaining;
}

export function markEventStatus(
  clientEventId: string,
  patch: Partial<Pick<QueuedTimeEvent, "status" | "retryCount" | "lastErrorMessage" | "lastAttemptAt">>,
): QueuedTimeEvent[] {
  const items = loadOfflineEventQueue();
  const next = items.map((item) =>
    item.client_event_id === clientEventId ? { ...item, ...patch } : item,
  );
  persist(next);
  return next;
}

// ── Replay helpers ─────────────────────────────────────────────────────────

/**
 * Sort queue by payload.event_time ASC so the DB trigger
 * trg_auto_close_session sees events in the same causal order the worker
 * tapped them. Out-of-order replay can leave a clock_out without a
 * matching clock_in, which buildManagerSessions silently drops.
 */
export function sortQueueByEventTimeAsc(items: QueuedTimeEvent[]): QueuedTimeEvent[] {
  return [...items].sort((a, b) =>
    a.payload.event_time.localeCompare(b.payload.event_time),
  );
}

/**
 * Heuristic: given an error from a supabase insert, decide whether it's
 * a network failure (queue + retry) or a hard error (surface, do not
 * queue). supabase-js typically returns network failures inside
 * `result.error` rather than throwing.
 */
export function isNetworkLikeError(
  error: { message?: string | null } | null | undefined,
): boolean {
  if (!error || typeof error.message !== "string") return false;
  const m = error.message.toLowerCase();
  return (
    m.includes("fetch") ||
    m.includes("network") ||
    m.includes("load failed") ||
    m.includes("connection") ||
    m.includes("offline") ||
    m.includes("timeout")
  );
}
