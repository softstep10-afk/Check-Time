import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_KEY,
  loadOfflineEventQueue,
  markEventStatus,
  queueOfflineEvent,
  removeOfflineEvent,
  sortQueueByEventTimeAsc,
  type QueuedTimeEventPayload,
} from "@/lib/offline-time-events";

// PWA Task 5 — /clock offline queue. Pins the cc_offline_time_events write/read/
// dedup-identity behavior that lets a worker clock in/out with no network. Schema
// and drain semantics are load-bearing for the crew's queued work, so this only
// exercises the public API — it does not change any of it.

function installStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function payload(overrides: Partial<QueuedTimeEventPayload> = {}): QueuedTimeEventPayload {
  return {
    org_id: "org-1",
    profile_id: "worker-1",
    project_id: "proj-1",
    event_type: "clock_in",
    event_time: "2026-07-06T15:00:00.000Z",
    gps_point: null,
    gps_accuracy_m: null,
    gps_source: "unavailable",
    video_status: "not_required",
    metadata: {},
    ...overrides,
  };
}

describe("offline time-event queue (/clock)", () => {
  it("queues a clock event under cc_offline_time_events with its client_event_id", () => {
    const store = installStorage();

    const item = queueOfflineEvent({
      client_event_id: "evt-1",
      payload: payload(),
      projectName: "North Site",
    });

    expect(item.client_event_id).toBe("evt-1");
    expect(item.status).toBe("pending");
    expect(item.ui.projectName).toBe("North Site");
    expect(store.has(OFFLINE_KEY)).toBe(true);

    const queue = loadOfflineEventQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].client_event_id).toBe("evt-1");
    expect(queue[0].payload.event_type).toBe("clock_in");
  });

  it("accumulates distinct client_event_ids (clock-in then clock-out)", () => {
    installStorage();
    queueOfflineEvent({ client_event_id: "in-1", payload: payload({ event_type: "clock_in" }), projectName: "A" });
    queueOfflineEvent({ client_event_id: "out-1", payload: payload({ event_type: "clock_out" }), projectName: "A" });

    const ids = loadOfflineEventQueue().map((e) => e.client_event_id);
    expect(ids).toEqual(["in-1", "out-1"]);
  });

  it("removes and patches by client_event_id only (dedup identity)", () => {
    installStorage();
    queueOfflineEvent({ client_event_id: "keep", payload: payload(), projectName: "A" });
    queueOfflineEvent({ client_event_id: "drop", payload: payload(), projectName: "A" });

    const afterRemove = removeOfflineEvent("drop");
    expect(afterRemove.map((e) => e.client_event_id)).toEqual(["keep"]);
    expect(loadOfflineEventQueue().map((e) => e.client_event_id)).toEqual(["keep"]);

    const afterMark = markEventStatus("keep", { status: "failed", lastErrorMessage: "boom" });
    expect(afterMark[0].status).toBe("failed");
    expect(afterMark[0].lastErrorMessage).toBe("boom");
  });

  it("sorts by event_time ascending so replay preserves clock-in → clock-out order", () => {
    const later = payload({ event_type: "clock_out", event_time: "2026-07-06T17:00:00.000Z" });
    const earlier = payload({ event_type: "clock_in", event_time: "2026-07-06T09:00:00.000Z" });
    const sorted = sortQueueByEventTimeAsc([
      { client_event_id: "b", status: "pending", retryCount: 0, lastErrorMessage: null, lastAttemptAt: null, queuedAt: "", payload: later, ui: { projectName: "A" } },
      { client_event_id: "a", status: "pending", retryCount: 0, lastErrorMessage: null, lastAttemptAt: null, queuedAt: "", payload: earlier, ui: { projectName: "A" } },
    ]);
    expect(sorted.map((e) => e.client_event_id)).toEqual(["a", "b"]);
  });
});
