"use client";

import { useSyncExternalStore } from "react";
import { useTranslation } from "@/lib/i18n";
import { loadOfflineEventQueue, type QueuedTimeEvent } from "@/lib/offline-time-events";
import {
  loadOfflineFieldActionQueue,
  type OfflineFieldAction,
} from "@/lib/offline-field-actions";
import { loadOfflineQueue, type OfflineUpload } from "@/lib/offline-uploads";
import { formatDateTime } from "@/lib/worker-utils";

// PWA Task 4 — the offline boot shell.
//
// A self-contained, network-free app shell: Check-Time chrome + a clear offline
// banner + the worker's queued offline work read from localStorage. It renders
// with no server data and no navigation, so it works from already-cached JS.
// Used by the static /offline route and by the offline-aware worker error
// boundary. It only READS the offline queues — it never mutates them.

type RawQueues = {
  events: QueuedTimeEvent[];
  actions: OfflineFieldAction[];
  uploads: OfflineUpload[];
};

const EMPTY_QUEUES: RawQueues = { events: [], actions: [], uploads: [] };

// Cached snapshot so useSyncExternalStore returns a stable reference between
// renders (a fresh array each call would loop). Recomputed only when a queue
// change is signalled. localStorage is read here — never during SSR, where
// getServerQueuesSnapshot returns the empty default.
let queuesCache: RawQueues = EMPTY_QUEUES;
let queuesDirty = true;

function subscribeQueues(onChange: () => void): () => void {
  const handler = () => {
    queuesDirty = true;
    onChange();
  };
  window.addEventListener("storage", handler);
  window.addEventListener("online", handler);
  window.addEventListener("offline", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("online", handler);
    window.removeEventListener("offline", handler);
  };
}

function getQueuesSnapshot(): RawQueues {
  if (queuesDirty) {
    queuesDirty = false;
    queuesCache = {
      events: loadOfflineEventQueue(),
      actions: loadOfflineFieldActionQueue(),
      uploads: loadOfflineQueue(),
    };
  }
  return queuesCache;
}

function getServerQueuesSnapshot(): RawQueues {
  return EMPTY_QUEUES;
}

type QueuedRow = { key: string; label: string; detail: string; status: string };

export function OfflineShell() {
  const { t } = useTranslation();
  const queues = useSyncExternalStore(
    subscribeQueues,
    getQueuesSnapshot,
    getServerQueuesSnapshot,
  );

  const rows: QueuedRow[] = [
    ...queues.events.map((event) => ({
      key: `time-${event.client_event_id}`,
      label: event.payload.event_type === "clock_in" ? t("offline.clockIn") : t("offline.clockOut"),
      detail: `${event.ui.projectName} · ${formatDateTime(event.payload.event_time)}`,
      status: event.status,
    })),
    ...queues.actions.map((action) => ({
      key: `field-${action.id}`,
      label: t("offline.fieldAction"),
      detail: action.kind,
      status: action.status,
    })),
    ...queues.uploads.map((upload) => ({
      key: `upload-${upload.id}`,
      label: t("offline.upload"),
      detail: upload.caption || upload.mode,
      status: upload.status,
    })),
  ];

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen max-w-[500px] flex-col border-x border-[var(--border-subtle)]">
        <header className="flex items-center gap-2 px-4 pb-3 pt-4">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-sm font-bold"
            style={{ background: "rgba(191, 162, 52, 0.16)", color: "var(--brand-yellow)" }}
            aria-hidden
          >
            CT
          </span>
          <h1 className="text-base font-bold">
            Check-<span className="text-brand">Time</span>
          </h1>
        </header>

        <main className="flex-1 px-4 pb-10">
          <section
            className="rounded-[var(--radius-md)] border px-4 py-4"
            style={{
              background: "rgba(245, 158, 11, 0.12)",
              borderColor: "rgba(245, 158, 11, 0.28)",
              color: "#f59e0b",
            }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <span aria-hidden>⚠</span>
              {t("offline.title")}
            </div>
            <p className="mt-1 text-xs font-medium text-[var(--text-secondary)]">
              {t("offline.subtitle")}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
              {t("offline.reassure")}
            </p>
          </section>

          <section className="mt-5">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              {t("offline.queuedTitle")}
              {rows.length > 0 ? ` (${rows.length})` : ""}
            </h2>
            <div className="mt-2 space-y-2">
              {rows.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-card)] px-3 py-3 text-sm text-[var(--text-secondary)]">
                  {t("offline.queuedEmpty")}
                </div>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {row.label}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                        {row.detail}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-[var(--radius-pill)] bg-[rgba(148,163,184,0.14)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      {row.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="button-base button-primary mt-6 w-full px-4 py-3 text-sm"
          >
            {t("offline.retry")}
          </button>
        </main>
      </div>
    </div>
  );
}
