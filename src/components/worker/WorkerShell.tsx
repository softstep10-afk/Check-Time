"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { TaskStatus, TimeEvent } from "@/types/database";
import type {
  WorkerGeoPoint,
  WorkerGpsCheck,
  WorkerMediaItem,
  WorkerSession,
  WorkerShellData,
} from "@/lib/worker-types";
import {
  deriveClockState,
  deriveWorkerSummary,
  formatElapsedSeconds,
  formatEventDate,
  formatEventTime,
  formatDurationCompact,
  guessMediaType,
  haversineMeters,
  toSupabasePoint,
} from "@/lib/worker-utils";
import { buildSafeUploadName } from "@/lib/media-extension";
import { Timer, Camera, ClipboardCheck, CalendarClock, FolderKanban } from "lucide-react";
import { useTranslation, LanguageSwitcher } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";
import { NotificationBell } from "@/components/worker/NotificationBell";
import { MessageOverlay } from "@/components/worker/MessageOverlay";
import { GpsConsentModal } from "@/components/worker/GpsConsentModal";
import { useGpsTracking } from "@/lib/hooks/useGpsTracking";
import { readLatestConsent, writeConsent } from "@/lib/gps-consent";
import { closeOpenStoreVisits } from "@/lib/store-visits";
import { getAppGeofenceRadiusM, resolveProjectRadiusM } from "@/lib/geofence";
import { validateUploadFile } from "@/lib/upload-limits";
import {
  loadOfflineQueue,
  offlineUploadToFile,
  queueOfflineUpload,
  removeOfflineUpload,
  type OfflineUpload,
  type OfflineUploadMode,
} from "@/lib/offline-uploads";
import {
  isNetworkLikeError,
  loadOfflineEventQueue,
  markEventStatus,
  queueOfflineEvent,
  removeOfflineEvent,
  sortQueueByEventTimeAsc,
  type QueuedTimeEvent,
  type QueuedTimeEventPayload,
} from "@/lib/offline-time-events";
import type { AppMessage } from "@/lib/message-types";
import {
  buildTaskCompletionMetadata,
  countUnseenTasks,
  isTaskVisibleToWorker,
  loadTaskLastSeen,
  saveTaskLastSeen,
  shouldBlockCompletionFileUpload,
} from "@/lib/task-notifications";
import { uploadTaskAttachment } from "@/lib/task-attachments";
import { buildNoGpsMetadata } from "@/lib/worker-clock-metadata";

const navItems = [
  { href: "/clock", icon: Timer, label: "Clock", labelKey: "worker.navClock" as TranslationKey },
  { href: "/my-projects", icon: FolderKanban, label: "Projects", labelKey: "worker.navProjects" as TranslationKey },
  { href: "/journal", icon: Camera, label: "Journal", labelKey: "worker.navJournal" as TranslationKey },
  { href: "/my-tasks", icon: ClipboardCheck, label: "Tasks", labelKey: "worker.navTasks" as TranslationKey },
  { href: "/hours", icon: CalendarClock, label: "Hours", labelKey: "worker.navHours" as TranslationKey },
];

type BannerState = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

function checkoutLinkResponseHasProof(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const value = body as { linked?: unknown; mediaIds?: unknown };
  if (typeof value.linked === "number" && value.linked > 0) return true;
  return Array.isArray(value.mediaIds) && value.mediaIds.length > 0;
}

type UploadMode = "journal" | "checkout" | "before_leave" | "before_work";

type ClockOptions = {
  skipGps?: boolean;
  /**
   * Original GPS error kind that drove the worker to choose "Start
   * without GPS". When skipGps=true and gpsErrorKind is set, the
   * value is stamped into time_events.metadata so manager review
   * (shift-review, deriveShiftReview) can distinguish a denied
   * permission from an unavailable signal from a hardware-less
   * device. Optional — the existing "Skip" path on /clock that does
   * not first surface the prompt simply omits this.
   */
  gpsErrorKind?: GpsErrorKind;
  /**
   * Worker-provided checkout note. Persisted to time_events.metadata
   * so the manager Day Detail row can render it next to the closing
   * event, even when no checkout video was attached (require_video=false
   * shifts still benefit from "I left early because…" context).
   */
  note?: string;
};

type WorkerShellContextValue = {
  shell: WorkerShellData;
  activeSeconds: number;
  busyAction: string | null;
  banner: BannerState;
  lastGpsCheck: WorkerGpsCheck | null;
  muted: boolean;
  offlineQueueLength: number;
  isOnline: boolean;
  draining: boolean;
  dismissBanner: () => void;
  clockIn: (projectId: string, options?: ClockOptions) => Promise<void>;
  clockOut: (options?: ClockOptions) => Promise<void>;
  uploadMedia: (files: FileList | File[], caption: string, mode: UploadMode) => Promise<void>;
  updateTaskStatus: (
    taskId: string,
    nextStatus: TaskStatus,
    options?: {
      note?: string;
      submittedFromCompletionModal?: true;
      followUpRequired?: boolean;
      followUpNote?: string;
      files?: File[];
      projectId?: string | null;
      existingMetadata?: Record<string, unknown> | null;
    },
  ) => Promise<void>;
  toggleMute: () => void;
  drainOfflineQueue: () => Promise<void>;
  /**
   * Count of tasks that are visible to this worker AND newer than
   * the locally-stored "last seen" timestamp. Drives the bell badge
   * and the /my-tasks page banner. Cleared by markTasksSeen().
   */
  unseenTaskCount: number;
  /**
   * Stamp the worker's last-seen-tasks marker to "now" so the badge
   * drops to zero. Called on /my-tasks mount; safe to call multiple
   * times.
   */
  markTasksSeen: () => void;
};

const WorkerShellContext = createContext<WorkerShellContextValue | null>(null);

type GpsErrorKind = "denied" | "unavailable" | "unsupported";

class GpsError extends Error {
  constructor(public readonly kind: GpsErrorKind) {
    super(`gps_${kind}`);
    this.name = "GpsError";
  }
}

// Temporary diagnostic — emits origin + error details to the console on
// any geolocation failure, so remote-debugging a phone via
// `chrome://inspect#devices` can distinguish "insecure-origin block" from
// "OS-level permission denied". Remove once mobile GPS is confirmed working.
function logGpsFailure(label: string, err?: GeolocationPositionError) {
  if (typeof window === "undefined") return;
  const ctx = {
    label,
    isSecureContext: window.isSecureContext,
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    href: window.location.href,
    errorCode: err?.code,
    errorMessage: err?.message,
  };
  console.error("[GPS diagnostic]", ctx);
}

async function getCurrentPosition(): Promise<WorkerGeoPoint & { accuracy: number }> {
  if (!navigator.geolocation) {
    logGpsFailure("navigator.geolocation missing");
    throw new GpsError("unsupported");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (err: GeolocationPositionError) => {
        logGpsFailure("getCurrentPosition error", err);
        // Only code 1 (PERMISSION_DENIED) is an actual consent issue.
        // code 2 (POSITION_UNAVAILABLE) and code 3 (TIMEOUT) are transient
        // hardware/network failures and must not surface as "access denied".
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GpsError("denied"));
        } else {
          reject(new GpsError("unavailable"));
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 12_000,
      },
    );
  });
}

// ── Offline time-events helpers ──

/**
 * Replay the queued offline events onto the shell's session list so the
 * UI reflects "Clocked in (pending sync)" across refreshes. This mirrors
 * the pairing logic from buildWorkerSessions but works incrementally on
 * top of whatever the server already returned.
 */
function applyQueuedEventsToShell(
  current: WorkerShellData,
  queue: QueuedTimeEvent[],
): WorkerShellData {
  if (queue.length === 0) return current;
  const sorted = sortQueueByEventTimeAsc(queue);
  let working: WorkerSession[] = [...current.sessions];
  const projectsById = new Map(current.projects.map((p) => [p.id, p]));

  for (const item of sorted) {
    if (item.payload.event_type === "clock_in") {
      working = [
        {
          // Synthetic id — namespaced so it never collides with a real
          // time_events.id UUID and is easy to spot in console output.
          id: `pending:${item.client_event_id}`,
          projectId: item.payload.project_id,
          projectName:
            projectsById.get(item.payload.project_id)?.name ??
            item.ui.projectName,
          clockInEventId: `pending:${item.client_event_id}`,
          clockOutEventId: null,
          clockInTime: item.payload.event_time,
          clockOutTime: null,
          durationMinutes: 0,
          checkoutStatus: "not_required",
          startVideoStatus: item.payload.video_status,
        },
        ...working,
      ];
    } else if (item.payload.event_type === "clock_out") {
      const idx = working.findIndex((s) => s.clockOutTime === null);
      if (idx >= 0) {
        const open = working[idx];
        const durationMinutes = Math.max(
          0,
          Math.round(
            (new Date(item.payload.event_time).getTime() -
              new Date(open.clockInTime).getTime()) /
              60_000,
          ),
        );
        working[idx] = {
          ...open,
          clockOutEventId: `pending:${item.client_event_id}`,
          clockOutTime: item.payload.event_time,
          durationMinutes,
          checkoutStatus: item.payload.video_status,
        };
      }
    }
  }

  const nextClockState = deriveClockState(working);
  const nextSummary = deriveWorkerSummary(working);
  return {
    ...current,
    sessions: working,
    clockState: nextClockState,
    summary: nextSummary,
  };
}

// ── Web Audio sound effects ──

let sharedCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

function playTone(freq: number, duration: number, startAt: number, gain: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  vol.gain.setValueAtTime(gain, startAt);
  vol.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration);
}

function playClockInSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  playTone(880, 0.12, now, 0.08);
  playTone(1100, 0.15, now + 0.13, 0.08);
}

function playClockOutSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  playTone(660, 0.25, now, 0.07);
}

function playErrorSound() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const vol = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = 200;
  vol.gain.setValueAtTime(0.05, now);
  vol.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(vol);
  vol.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.18);
}

function normaliseFiles(files: FileList | File[]): File[] {
  return Array.from(files);
}

// Maps a GPS failure kind to the banner tone + translation key.
// - "denied"      → real consent/permission issue, red error banner
// - "unavailable" → transient timeout / POSITION_UNAVAILABLE, neutral info
// - "unsupported" → device has no geolocation at all, red error banner
function gpsBanner(kind: GpsErrorKind): {
  tone: "error" | "info";
  key: Parameters<ReturnType<typeof useTranslation>["t"]>[0];
} {
  if (kind === "denied") return { tone: "error", key: "gps.permissionDenied" };
  if (kind === "unsupported") return { tone: "error", key: "gps.unsupported" };
  return { tone: "info", key: "gps.locationUnavailable" };
}

export function useWorkerShell() {
  const context = useContext(WorkerShellContext);

  if (!context) {
    throw new Error("useWorkerShell must be used within WorkerShell.");
  }

  return context;
}

export function WorkerShell({
  children,
  initialData,
}: {
  children: React.ReactNode;
  initialData: WorkerShellData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);
  const [shell, setShell] = useState(initialData);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerState>(null);
  const [lastGpsCheck, setLastGpsCheck] = useState<WorkerGpsCheck | null>(null);
  // GPS-failure prompt shown when getCurrentPosition rejects. Replaces
  // the old "Tap to retry" banner that left the worker in a loop with no
  // way to record their shift. Worker can either retry or commit a
  // No-GPS event that the manager will see flagged.
  const [gpsPrompt, setGpsPrompt] = useState<
    | { kind: "clockIn"; projectId: string; errorKind: GpsErrorKind }
    | { kind: "clockOut"; errorKind: GpsErrorKind }
    | null
  >(null);
  // Time ticker. `mounted` gates every client-only rendering of the
  // elapsed timer so SSR and the first client render produce identical
  // HTML. `now` is seeded with a stable zero and replaced with Date.now()
  // only after mount.
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<number>(0);
  const { t } = useTranslation();

  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Sound mute state ──
  // Source of truth: profiles.notif_mode (Wave 7 migration 00009).
  // Falls back to localStorage when the column is absent or hasn't been
  // hydrated yet, so older deploys keep working.
  const [muted, setMuted] = useState<boolean>(() => {
    const fromProfile = (initialData.profile as { notif_mode?: string | null }).notif_mode;
    if (fromProfile === "silent") return true;
    if (fromProfile === "sound") return false;
    return true; // optimistic default; effect below corrects from localStorage
  });
  const audioUnlocked = useRef(false);

  useEffect(() => {
    const fromProfile = (initialData.profile as { notif_mode?: string | null }).notif_mode;
    if (fromProfile === "silent" || fromProfile === "sound") return;
    const stored = localStorage.getItem("check-time-muted");
    setMuted(stored === "true");
  }, [initialData.profile]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem("check-time-muted", String(next));
      // Persist to profiles.notif_mode best-effort. Tolerates the column
      // being absent before migration 00009 is applied.
      void (async () => {
        const mode = next ? "silent" : "sound";
        const result = await supabase
          .from("profiles")
          .update({ notif_mode: mode })
          .eq("id", shell.profile.id);
        if (result.error && /column .* notif_mode/i.test(result.error.message)) {
          // Column doesn't exist yet — localStorage is the only durable
          // store until 00009 runs.
        }
      })();
      return next;
    });
  }, [supabase, shell.profile.id]);

  // ── Offline queue (Wave 8) ─────────────────────────────────────────────
  const [offlineQueue, setOfflineQueue] = useState<OfflineUpload[]>([]);
  // Phase-1 offline queue for clock-in / clock-out events.
  const [offlineEventQueue, setOfflineEventQueue] = useState<QueuedTimeEvent[]>([]);
  // Optimistic default `true`; effect below syncs from navigator.onLine
  // after mount so SSR and hydration agree on the same starting value.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [draining, setDraining] = useState(false);

  // Hydrate queue once on mount.
  useEffect(() => {
    setOfflineQueue(loadOfflineQueue());
    // Time-events queue: hydrate state, then re-apply optimistic shell
    // state (clocked-in / clocked-out) from any queued events that
    // haven't synced yet. Server-rendered initialData doesn't see
    // pending events because they live only in localStorage on this
    // device — without this overlay a refresh would make the worker
    // look "off shift" even though their clock-in is queued.
    const eventQueue = loadOfflineEventQueue();
    setOfflineEventQueue(eventQueue);
    if (eventQueue.length === 0) return;
    setShell((current) => applyQueuedEventsToShell(current, eventQueue));
  }, []);

  // ── Online/offline listeners ─────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(window.navigator.onLine);
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Unlock AudioContext on first user interaction (mobile requirement)
  useEffect(() => {
    function unlock() {
      if (audioUnlocked.current) return;
      const ctx = getAudioCtx();
      if (ctx && ctx.state === "suspended") {
        void ctx.resume();
      }
      audioUnlocked.current = true;
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  // ── Message overlay for latest unread ──
  const [overlayMessage, setOverlayMessage] = useState<AppMessage | null>(null);

  const playSound = useCallback(
    (kind: "clock-in" | "clock-out" | "error") => {
      if (muted) return;
      if (kind === "clock-in") playClockInSound();
      else if (kind === "clock-out") playClockOutSound();
      else playErrorSound();
    },
    [muted],
  );

  // ── GPS live tracking ──
  // Init `false` on both server and client first render so SSR and hydration
  // match. The effect below seeds from localStorage cache, then the DB-check
  // effect below that confirms against the source of truth.
  const [gpsConsented, setGpsConsented] = useState<boolean>(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [iosTipShown, setIosTipShown] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // Seed from localStorage cache once mounted (fast first paint before the
  // DB round-trip below resolves).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem("check-time-gps-consent");
    if (cached === "true") setGpsConsented(true);
    else if (cached === "false") setGpsConsented(false);
  }, []);

  // DB is source of truth, localStorage is cache. "unknown" leaves the
  // existing boolean state alone (no UI block — modal opens lazily on
  // the first GPS-requiring action, same as before).
  //
  // Sync path: if localStorage says consented=true but the DB has no
  // row yet (e.g. the worker consented before the DB table existed,
  // or on another device that never synced), append a grant row now so
  // the audit trail and the manager's Location Data view catch up. All
  // failures are swallowed — GPS consent must never crash the shell.
  useEffect(() => {
    if (consentChecked) return;
    async function checkConsent() {
      try {
        const state = await readLatestConsent(supabase, shell.profile.id);
        if (state !== "unknown") {
          const granted = state === "granted";
          setGpsConsented(granted);
          if (typeof window !== "undefined") {
            localStorage.setItem("check-time-gps-consent", String(granted));
          }
        } else if (
          typeof window !== "undefined" &&
          localStorage.getItem("check-time-gps-consent") === "true"
        ) {
          const res = await writeConsent(supabase, {
            orgId: shell.profile.org_id,
            workerId: shell.profile.id,
            signedName: shell.profile.name,
            granted: true,
            userAgent: navigator.userAgent,
          });
          if (!res.ok) console.warn("consent sync failed:", res.error);
        }
      } catch (err) {
        console.warn("consent check failed:", err);
      }
      setConsentChecked(true);
    }
    void checkConsent();
  }, [supabase, shell.profile.id, shell.profile.org_id, shell.profile.name, consentChecked]);

  const gpsTrackingEnabled = gpsConsented && shell.clockState.isClockedIn;

  const handleGpsPosition = useCallback(
    (pos: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null }) => {
      // Fire-and-forget: a single dropped ping is harmless (next one is 20s
      // away). Errors are intentionally swallowed so the worker UI never
      // crashes on a transient network or RLS hiccup.
      void supabase
        .from("worker_live_locations")
        .insert({
          org_id: shell.profile.org_id,
          worker_id: shell.profile.id,
          shift_id: shell.clockState.openEventId ?? null,
          lat: pos.lat,
          lng: pos.lng,
          accuracy: pos.accuracy,
          heading: pos.heading,
          speed: pos.speed,
        })
        .then(({ error }) => {
          if (error) console.warn("worker_live_locations insert failed:", error.message);
        });
    },
    [supabase, shell.profile.org_id, shell.profile.id, shell.clockState.openEventId],
  );

  const { state: gpsState } = useGpsTracking({
    enabled: gpsTrackingEnabled,
    onPosition: handleGpsPosition,
  });

  // Show iOS tip once
  useEffect(() => {
    if (gpsTrackingEnabled && !iosTipShown) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS && !localStorage.getItem("check-time-ios-tip-shown")) {
        setIosTipShown(true);
        localStorage.setItem("check-time-ios-tip-shown", "true");
      }
    }
  }, [gpsTrackingEnabled, iosTipShown]);

  function handleGpsConsent(signedName: string) {
    void writeConsent(supabase, {
      orgId: shell.profile.org_id,
      workerId: shell.profile.id,
      signedName,
      granted: true,
      userAgent: navigator.userAgent,
    }).then((res) => {
      if (!res.ok) console.warn("consent grant failed:", res.error);
    });
    localStorage.setItem("check-time-gps-consent", "true");
    setGpsConsented(true);
    setShowConsentModal(false);
  }

  function handleGpsDecline() {
    void writeConsent(supabase, {
      orgId: shell.profile.org_id,
      workerId: shell.profile.id,
      signedName: shell.profile.name,
      granted: false,
      userAgent: navigator.userAgent,
    }).then((res) => {
      if (!res.ok) console.warn("consent decline failed:", res.error);
    });
    localStorage.setItem("check-time-gps-consent", "false");
    setGpsConsented(false);
    setShowConsentModal(false);
  }

  useEffect(() => {
    setShell(initialData);
  }, [initialData]);

  // ── Profile-change realtime subscription ──────────────────────────────
  // The worker's `shell.profile.require_video` (and other profile flags)
  // are loaded once when the layout server-renders. Without this listener,
  // a manager toggling "Require checkout video" off would not propagate to
  // a worker who's already on /clock — the worker keeps the stale value
  // until they hard-refresh, so they'd still be gated by the modal even
  // though the DB row says require_video=false.
  //
  // On an UPDATE to this worker's own profiles row, call router.refresh()
  // to re-run the (worker) layout server-side; that hands new initialData
  // to the shell, the existing setShell(initialData) effect above wires it
  // into state, and CheckoutModal reads the fresh require_video on its
  // next render. Mirrors the manager-side OverviewLiveIndicator pattern.
  useEffect(() => {
    const channel = supabase
      .channel(`worker-profile-${shell.profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${shell.profile.id}`,
        },
        () => {
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, router, shell.profile.id]);

  // ── Task notifications (unseen badge + new-task banner) ─────────────
  //
  // localStorage stores the worker's last-seen-tasks ISO timestamp.
  // Lazy-init: read once at mount, then update only via markTasksSeen
  // or the seed-on-first-load effect below. The seed avoids a flood
  // banner on a brand-new device where every existing task would
  // otherwise look "new".
  const [taskLastSeenAt, setTaskLastSeenAt] = useState<string | null>(() =>
    loadTaskLastSeen(shell.profile.id),
  );

  // Project access set used to test whether a project-level task
  // (assigned_to=null) is visible. Recomputed when the projects list
  // churns; cheap.
  const visibleProjectIds = useMemo(
    () => new Set(shell.projects.map((p) => p.id)),
    [shell.projects],
  );

  // Seed lastSeenAt to the most recent visible task on first load.
  // Prevents the badge from showing every old task as "new" on a fresh
  // device. Idempotent — only seeds when the value is still null.
  useEffect(() => {
    if (taskLastSeenAt) return;
    const result = countUnseenTasks(shell.tasks, null, {
      profileId: shell.profile.id,
      visibleProjectIds,
    });
    if (!result.latestCreatedAt) return;
    saveTaskLastSeen(shell.profile.id, result.latestCreatedAt);
    setTaskLastSeenAt(result.latestCreatedAt);
  }, [taskLastSeenAt, shell.tasks, shell.profile.id, visibleProjectIds]);

  const unseenTaskCount = useMemo(() => {
    return countUnseenTasks(shell.tasks, taskLastSeenAt, {
      profileId: shell.profile.id,
      visibleProjectIds,
    }).count;
  }, [shell.tasks, taskLastSeenAt, shell.profile.id, visibleProjectIds]);

  const markTasksSeen = useCallback(() => {
    const now = new Date().toISOString();
    saveTaskLastSeen(shell.profile.id, now);
    setTaskLastSeenAt(now);
  }, [shell.profile.id]);

  // ── Tasks realtime subscription ─────────────────────────────────────
  //
  // INSERT: a new task arriving for this worker (personal or project-
  // level) refreshes the shell so it appears in shell.tasks, and if the
  // row would be visible to this worker we also surface a banner +
  // optional sound. UPDATE: just refresh — status changes shouldn't
  // ping the banner.
  //
  // RLS on the tasks table already limits the broadcast payload to
  // rows this user can see, so an unfiltered subscription is safe;
  // the client-side visibility check is belt-and-suspenders for
  // edge-cases (e.g. a row updated by a manager that the worker can
  // see but didn't subscribe to project-wise).
  useEffect(() => {
    const channel = supabase
      .channel(`worker-tasks-${shell.profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tasks",
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            assigned_to: string | null;
            project_id: string | null;
            status: string;
            created_at: string;
            deleted_at?: string | null;
            title?: string | null;
          } | null;
          if (!row) return;
          if (
            !isTaskVisibleToWorker(row, {
              profileId: shell.profile.id,
              visibleProjectIds,
            })
          ) {
            return;
          }
          // Surface the new task — banner + sound (unless muted) +
          // shell refresh so it lands in shell.tasks.
          const projectName = row.project_id
            ? shell.projects.find((p) => p.id === row.project_id)?.name ?? null
            : null;
          const detail = projectName
            ? `${t("tasks.newTaskBanner")} · ${projectName}`
            : t("tasks.newTaskBanner");
          setBanner({ tone: "info", text: detail });
          if (!muted) {
            // Reuse the clock-in chime — short, distinct enough from the
            // checkout double-tone, and the AudioContext is already
            // unlocked once the worker has interacted with the shell.
            playClockInSound();
          }
          router.refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
        },
        () => {
          // No banner on edits / status changes — just keep the list
          // fresh so the worker sees re-assignments and re-priorities.
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, router, shell.profile.id, visibleProjectIds, shell.projects, muted, t]);

  useEffect(() => {
    if (!mounted) return;
    if (!shell.clockState.isClockedIn || !shell.clockState.clockInTime) {
      return;
    }

    setNow(Date.now()); // first sync post-mount
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [mounted, shell.clockState.clockInTime, shell.clockState.isClockedIn]);

  const activeSeconds =
    mounted && shell.clockState.isClockedIn && shell.clockState.clockInTime
      ? Math.max(
          0,
          Math.floor((now - new Date(shell.clockState.clockInTime).getTime()) / 1_000),
        )
      : 0;

  function dismissBanner() {
    setBanner(null);
  }

  async function handleSignOut() {
    setBusyAction("sign-out");

    try {
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function clockIn(projectId: string, options?: ClockOptions) {
    const project = shell.projects.find((entry) => entry.id === projectId);

    if (!project) {
      setBanner({ tone: "error", text: "Pick a project before clocking in." });
      return;
    }

    setBusyAction("clock-in");
    setBanner(null);

    try {
      // GPS capture, with fallback prompt path if the device denies / fails.
      // skipGps=true means the worker explicitly chose "Start without GPS"
      // from the prompt — we honor it and write a No-GPS time event.
      let gps: (WorkerGeoPoint & { accuracy: number }) | null = null;
      if (!options?.skipGps) {
        try {
          gps = await getCurrentPosition();
        } catch (err) {
          if (err instanceof GpsError) {
            setBusyAction(null);
            setGpsPrompt({ kind: "clockIn", projectId, errorKind: err.kind });
            playSound("error");
            return;
          }
          throw err;
        }
      }

      const timestamp = new Date().toISOString();

      // Resolve check-in radius: per-project gps_radius_m → app_settings → 75m.
      // Still resolved so the lastGpsCheck widget can render the configured
      // radius even on the no-GPS path (just with null distance).
      const appRadius = await getAppGeofenceRadiusM(supabase);
      const effectiveRadius = resolveProjectRadiusM(project, appRadius);

      if (gps && project.site) {
        const distanceMeters = haversineMeters(project.site, gps);
        const allowedDistance = effectiveRadius + Math.max(gps.accuracy, 25);

        setLastGpsCheck({
          action: "clock_in",
          projectId: project.id,
          projectName: project.name,
          position: { lat: gps.lat, lng: gps.lng },
          site: project.site,
          radiusMeters: effectiveRadius,
          distanceMeters: Math.round(distanceMeters),
          accuracy: gps.accuracy,
          withinFence: distanceMeters <= allowedDistance,
          capturedAt: timestamp,
        });

        if (distanceMeters > allowedDistance) {
          setBanner({
            tone: "error",
            text: `You are ${Math.round(distanceMeters)}m from ${project.name}. Move closer to clock in.`,
          });
          playSound("error");
          return;
        }
      } else if (gps) {
        setLastGpsCheck({
          action: "clock_in",
          projectId: project.id,
          projectName: project.name,
          position: { lat: gps.lat, lng: gps.lng },
          site: null,
          radiusMeters: effectiveRadius,
          distanceMeters: null,
          accuracy: gps.accuracy,
          withinFence: null,
          capturedAt: timestamp,
        });
      } else {
        // No-GPS path — clear the widget so stale data doesn't linger.
        setLastGpsCheck(null);
      }
      const client_event_id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

      // Reuse `profile.require_video` as the "video evidence" gate at
      // both ends of a shift: when on, the worker must upload a clip
      // before clock-in (start proof) AND before clock-out (end proof).
      // The clock_in event is created with video_status="pending" so
      // the manager-side review can flag a stuck warning until the
      // /api/worker/link-checkin-video route stamps the orphan upload
      // and flips video_status to "uploaded".
      const startVideoStatus: "pending" | "not_required" =
        shell.profile.require_video ? "pending" : "not_required";

      // GPS-status fields surface to manager review via deriveShiftReview.
      // When the worker explicitly opts to start without GPS via the
      // prompt, options.gpsErrorKind carries the original failure reason
      // (denied / unavailable / unsupported) so the shift can be marked
      // gps_denied vs no_gps vs gps_unsupported in metadata. When the
      // worker has GPS, the helper returns an empty object so the
      // marker fields stay off entirely.
      const noGpsMetadata = buildNoGpsMetadata({
        skippedGps: !gps,
        errorKind: options?.gpsErrorKind ?? null,
      });

      const insertPayload: QueuedTimeEventPayload = {
        org_id: shell.profile.org_id,
        profile_id: shell.profile.id,
        project_id: project.id,
        event_type: "clock_in",
        event_time: timestamp,
        gps_point: gps ? toSupabasePoint(gps) : null,
        gps_accuracy_m: gps ? gps.accuracy : null,
        gps_source: gps ? "device" : "unavailable",
        video_status: startVideoStatus,
        metadata: {
          capturedBy: "worker-shell",
          gps,
          client_event_id,
          ...noGpsMetadata,
        },
      };

      // Offline-first guard — if the browser already says we're offline,
      // skip the network round-trip and queue immediately.
      const offlineFromStart =
        typeof window !== "undefined" && !window.navigator.onLine;

      let insertedEvent: TimeEvent | null = null;
      let networkFailed = offlineFromStart;
      let hardError: { message?: string | null } | null = null;

      if (!offlineFromStart) {
        try {
          const result = await supabase
            .from("time_events")
            .insert({ ...insertPayload, metadata: { ...insertPayload.metadata, queued_offline: false } })
            .select("*")
            .single<TimeEvent>();
          if (result.error) {
            if (
              isNetworkLikeError(result.error) ||
              (typeof window !== "undefined" && !window.navigator.onLine)
            ) {
              networkFailed = true;
            } else {
              hardError = result.error;
            }
          } else {
            insertedEvent = result.data;
          }
        } catch (caught) {
          // supabase-js usually packs network failures into result.error
          // but a thrown TypeError ("Failed to fetch") can still happen.
          networkFailed = true;
          if (caught instanceof Error) {
            console.warn("clock-in throw treated as network error:", caught.message);
          }
        }
      }

      if (hardError) {
        throw new Error(hardError.message ?? "Clock-in failed.");
      }

      if (!insertedEvent && networkFailed) {
        // ── Offline path: queue locally, optimistic shell state, banner.
        // Stamp gps_status=offline_pending_sync so the manager review
        // surface can distinguish "no fix yet" from "couldn't reach the
        // network" when the queue eventually drains.
        const offlineMarkers = buildNoGpsMetadata({
          skippedGps: !gps,
          errorKind: options?.gpsErrorKind ?? null,
          offlineQueued: true,
        });
        const queuedPayload: QueuedTimeEventPayload = {
          ...insertPayload,
          metadata: {
            ...insertPayload.metadata,
            queued_offline: true,
            ...offlineMarkers,
          },
        };
        queueOfflineEvent({
          client_event_id,
          payload: queuedPayload,
          projectName: project.name,
        });
        setOfflineEventQueue(loadOfflineEventQueue());

        const optimisticSession = {
          id: `pending:${client_event_id}`,
          projectId: project.id,
          projectName: project.name,
          clockInEventId: `pending:${client_event_id}`,
          clockOutEventId: null,
          clockInTime: timestamp,
          clockOutTime: null,
          durationMinutes: 0,
          checkoutStatus: "not_required" as const,
          startVideoStatus: startVideoStatus,
        };
        const nextSessionsOffline = [optimisticSession, ...shell.sessions];
        const nextClockStateOffline = deriveClockState(nextSessionsOffline);
        const nextSummaryOffline = deriveWorkerSummary(nextSessionsOffline);

        setShell((current) => ({
          ...current,
          profile: {
            ...current.profile,
            current_project: project.id,
            last_clock_in: timestamp,
          },
          sessions: nextSessionsOffline,
          clockState: nextClockStateOffline,
          summary: nextSummaryOffline,
        }));
        setBanner({
          tone: "info",
          text: gps ? t("worker.queuedClockIn") : t("worker.queuedClockInNoGps"),
        });
        playSound("clock-in");

        if (gps && !localStorage.getItem("check-time-gps-consent")) {
          setShowConsentModal(true);
        }
        return;
      }

      if (!insertedEvent) {
        throw new Error("Clock-in failed.");
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          last_clock_in: timestamp,
          current_project: project.id,
        })
        .eq("id", shell.profile.id);

      if (profileError) {
        console.warn("Profile sync failed after clock-in:", profileError.message);
      }

      const nextSessions = [
        {
          id: insertedEvent.id,
          projectId: project.id,
          projectName: project.name,
          clockInEventId: insertedEvent.id,
          clockOutEventId: null,
          clockInTime: timestamp,
          clockOutTime: null,
          durationMinutes: 0,
          checkoutStatus: "not_required" as const,
          startVideoStatus: startVideoStatus,
        },
        ...shell.sessions,
      ];

      const nextClockState = deriveClockState(nextSessions);
      const nextSummary = deriveWorkerSummary(nextSessions);

      setShell((current) => ({
        ...current,
        profile: {
          ...current.profile,
          current_project: project.id,
          last_clock_in: timestamp,
        },
        sessions: nextSessions,
        clockState: nextClockState,
        summary: nextSummary,
      }));
      setBanner({
        tone: gps ? "success" : "info",
        text: gps
          ? `Clocked into ${project.name}.`
          : t("worker.startedWithoutGps"),
      });
      playSound("clock-in");

      // Only seed the consent modal when a real fix was captured. On the
      // No-GPS path the device couldn't produce a fix anyway — there's
      // no point prompting for tracking consent.
      if (gps && !localStorage.getItem("check-time-gps-consent")) {
        setShowConsentModal(true);
      }

      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clock-in failed.";
      setBanner({ tone: "error", text: message });
      playSound("error");
    } finally {
      setBusyAction(null);
    }
  }

  async function clockOut(options?: ClockOptions) {
    if (!shell.clockState.isClockedIn || !shell.clockState.currentProjectId) {
      setBanner({ tone: "error", text: "There is no active shift to close." });
      return;
    }

    setBusyAction("clock-out");
    setBanner(null);

    try {
      let gps: (WorkerGeoPoint & { accuracy: number }) | null = null;
      if (!options?.skipGps) {
        try {
          gps = await getCurrentPosition();
        } catch (err) {
          if (err instanceof GpsError) {
            setBusyAction(null);
            setGpsPrompt({ kind: "clockOut", errorKind: err.kind });
            playSound("error");
            return;
          }
          throw err;
        }
      }

      const timestamp = new Date().toISOString();
      const videoStatus: WorkerSession["checkoutStatus"] = shell.profile.require_video
        ? "pending"
        : "not_required";

      const client_event_id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

      const trimmedNote = options?.note?.trim() ?? "";
      const insertPayload: QueuedTimeEventPayload = {
        org_id: shell.profile.org_id,
        profile_id: shell.profile.id,
        project_id: shell.clockState.currentProjectId,
        event_type: "clock_out",
        event_time: timestamp,
        gps_point: gps ? toSupabasePoint(gps) : null,
        gps_accuracy_m: gps ? gps.accuracy : null,
        gps_source: gps ? "device" : "unavailable",
        video_status: videoStatus,
        metadata: {
          capturedBy: "worker-shell",
          gps,
          client_event_id,
          ...(gps ? {} : { location_unverified: true }),
          ...(trimmedNote ? { checkout_note: trimmedNote } : {}),
        },
      };

      const offlineFromStart =
        typeof window !== "undefined" && !window.navigator.onLine;

      let insertedEvent: TimeEvent | null = null;
      let networkFailed = offlineFromStart;
      let hardError: { message?: string | null } | null = null;

      if (!offlineFromStart) {
        try {
          const result = await supabase
            .from("time_events")
            .insert({ ...insertPayload, metadata: { ...insertPayload.metadata, queued_offline: false } })
            .select("*")
            .single<TimeEvent>();
          if (result.error) {
            if (
              isNetworkLikeError(result.error) ||
              (typeof window !== "undefined" && !window.navigator.onLine)
            ) {
              networkFailed = true;
            } else {
              hardError = result.error;
            }
          } else {
            insertedEvent = result.data;
          }
        } catch (caught) {
          networkFailed = true;
          if (caught instanceof Error) {
            console.warn("clock-out throw treated as network error:", caught.message);
          }
        }
      }

      if (hardError) {
        throw new Error(hardError.message ?? "Clock-out failed.");
      }

      if (!insertedEvent && networkFailed) {
        // ── Offline path: queue locally, optimistic shell state, banner.
        const queuedPayload: QueuedTimeEventPayload = {
          ...insertPayload,
          metadata: { ...insertPayload.metadata, queued_offline: true },
        };
        queueOfflineEvent({
          client_event_id,
          payload: queuedPayload,
          projectName: shell.clockState.currentProjectName ?? "",
        });
        setOfflineEventQueue(loadOfflineEventQueue());

        const nextSessionsOffline = shell.sessions.map((session) => {
          if (session.clockOutTime || session.clockInEventId !== shell.clockState.openEventId) {
            return session;
          }
          const durationMinutes = Math.max(
            0,
            Math.round(
              (new Date(timestamp).getTime() - new Date(session.clockInTime).getTime()) / 60_000,
            ),
          );
          return {
            ...session,
            clockOutEventId: `pending:${client_event_id}`,
            clockOutTime: timestamp,
            durationMinutes,
            checkoutStatus: videoStatus,
          };
        });
        const nextClockStateOffline = deriveClockState(nextSessionsOffline);
        const nextSummaryOffline = deriveWorkerSummary(nextSessionsOffline);

        setShell((current) => ({
          ...current,
          profile: {
            ...current.profile,
            current_project: null,
          },
          sessions: nextSessionsOffline,
          clockState: nextClockStateOffline,
          summary: nextSummaryOffline,
        }));

        setBanner({
          tone: "info",
          text: gps ? t("worker.queuedClockOut") : t("worker.queuedClockOutNoGps"),
        });
        playSound("clock-out");
        return;
      }

      if (!insertedEvent) {
        throw new Error("Clock-out failed.");
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          current_project: null,
        })
        .eq("id", shell.profile.id);

      if (profileError) {
        console.warn("Profile sync failed after clock-out:", profileError.message);
      }

      // Close any open store_visit rows so the worker isn't permanently
      // "inside" a store after their shift ends.
      await closeOpenStoreVisits(supabase, shell.profile.id, timestamp);

      // Link the worker's "before you leave" videos to this clock_out
      // event. The video was inserted with time_event_id=null before
      // the worker tapped Confirm; now that the clock_out row exists,
      // we stamp the orphan rows so the manager-side shift-review can
      // resolve checkout proof through the event.
      //
      // The actual UPDATE runs server-side at /api/worker/link-checkout-video
      // because public.media has SELECT/INSERT policies but no
      // worker-safe UPDATE policy — a direct supabase.from('media')
      // .update() from this client returns success-with-zero-rows under
      // RLS. The route uses the service-role admin client and re-asserts
      // every constraint (uploaded_by, project, org, is_checkout,
      // repair window) before writing. It also recognizes checkout media
      // already linked to this event, which lets a Journal retry clear
      // video_status=pending without touching the original file.
      //
      // Best-effort: a non-2xx response here is logged but never
      // unwinds the successful clock-out. The video stays as an orphan
      // is_checkout=true row a future retry / sweep can pick up.
      let linkedCheckoutProof = false;
      try {
        const linkResp = await fetch("/api/worker/link-checkout-video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeEventId: insertedEvent.id }),
          keepalive: true,
        });
        if (!linkResp.ok) {
          const detail = await linkResp.text().catch(() => "");
          console.warn(
            `[checkout-link] HTTP ${linkResp.status}: ${detail.slice(0, 200)}`,
          );
        } else {
          const body = (await linkResp.json().catch(() => null)) as unknown;
          linkedCheckoutProof = checkoutLinkResponseHasProof(body);
        }
      } catch (linkErr) {
        console.warn("[checkout-link] fetch threw:", linkErr);
      }

      const resolvedCheckoutStatus: WorkerSession["checkoutStatus"] =
        videoStatus === "pending" && linkedCheckoutProof ? "uploaded" : videoStatus;

      const nextSessions = shell.sessions.map((session) => {
        if (session.clockOutTime || session.clockInEventId !== shell.clockState.openEventId) {
          return session;
        }

        const durationMinutes = Math.max(
          0,
          Math.round(
            (new Date(timestamp).getTime() - new Date(session.clockInTime).getTime()) / 60_000,
          ),
        );

        return {
          ...session,
          clockOutEventId: insertedEvent.id,
          clockOutTime: timestamp,
          durationMinutes,
          checkoutStatus: resolvedCheckoutStatus,
        };
      });

      const nextClockState = deriveClockState(nextSessions);
      const nextSummary = deriveWorkerSummary(nextSessions);

      setShell((current) => ({
        ...current,
        profile: {
          ...current.profile,
          current_project: null,
        },
        sessions: nextSessions,
        clockState: nextClockState,
        summary: nextSummary,
      }));

      setBanner({
        tone: !gps ? "info" : shell.profile.require_video ? "info" : "success",
        text: !gps
          ? t("worker.closedWithoutGps")
          : shell.profile.require_video
            ? linkedCheckoutProof
              ? "Shift closed. Checkout video uploaded."
              : "Shift closed. Checkout video is waiting in Journal."
            : "Clocked out.",
      });
      playSound("clock-out");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Clock-out failed.";
      setBanner({ tone: "error", text: message });
      playSound("error");
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadMedia(
    files: FileList | File[],
    caption: string,
    mode: UploadMode,
  ) {
    const selectedFiles = normaliseFiles(files);

    if (selectedFiles.length === 0) {
      setBanner({ tone: "error", text: "Choose a file before uploading." });
      return;
    }

    // Wave 8 client validation: friendly per-kind size + MIME error before
    // we hit Supabase Storage.
    for (const file of selectedFiles) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const error = validation.error;
        if (error.reason === "too_large") {
          const key =
            error.kind === "photo"
              ? "uploads.tooLargePhoto"
              : error.kind === "video"
                ? "uploads.tooLargeVideo"
                : "uploads.tooLargePdf";
          setBanner({ tone: "error", text: t(key) });
        } else {
          setBanner({
            tone: "error",
            text: t("uploads.unsupportedType").replace("{kind}", error.mime),
          });
        }
        playSound("error");
        return;
      }
    }

    const targetProjectId =
      mode === "checkout"
        ? shell.clockState.pendingCheckoutProjectId
        : shell.clockState.currentProjectId;

    if (!targetProjectId) {
      setBanner({
        tone: "error",
        text:
          mode === "checkout"
            ? "There is no pending checkout video."
            : "Clock into a project before adding to the journal.",
      });
      return;
    }

    // Wave 8 offline queue: when the browser reports we're offline,
    // serialize the files into localStorage instead of hitting Storage.
    // The window 'online' listener below will drain the queue.
    if (typeof window !== "undefined" && !window.navigator.onLine) {
      let degradedAny = false;
      for (const file of selectedFiles) {
        const result = await queueOfflineUpload({
          file,
          mode: mode as OfflineUploadMode,
          projectId: targetProjectId,
          profileId: shell.profile.id,
          orgId: shell.profile.org_id,
          caption,
        });
        if (!result.ok) {
          setBanner({
            tone: "error",
            text:
              result.reason === "storage_full"
                ? "Offline storage full — connect to upload."
                : "Couldn't queue file offline.",
          });
          return;
        }
        if (result.degraded) degradedAny = true;
        setOfflineQueue(result.queue);
      }
      setBanner({
        tone: "info",
        text: degradedAny ? t("uploads.queuedTooLarge") : t("uploads.queued"),
      });
      return;
    }

    setBusyAction(
      mode === "checkout"
        ? "checkout-video"
        : mode === "before_leave"
          ? "before-leave-video"
          : mode === "before_work"
            ? "before-work-video"
            : "journal-upload",
    );
    setBanner(null);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const uploadedEntries: WorkerMediaItem[] = [];

      for (const file of selectedFiles) {
        // buildSafeUploadName guarantees a playable extension (.mp4 / .mov /
        // .webm / etc.) when the OS picker hands us an empty file.name.
        // Without it, an iPhone capture with no name produced an extension-
        // less storage path, the manager's signed-URL flow had no hint of
        // the real format, and downloads landed on disk as raw binary.
        const safeName = buildSafeUploadName(file, mode);
        const storagePath = `${shell.profile.org_id}/${targetProjectId}/${today}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(storagePath, file, {
            upsert: false,
            cacheControl: "3600",
            // Without an explicit contentType, Supabase Storage falls back
            // to application/octet-stream when the filename has no clean
            // extension (iOS captures sometimes ship as `checkout-…` with
            // no .mp4). Browsers then play the signed URL as binary →
            // black frame, no audio. Use the browser-detected MIME so the
            // signed URL serves the right Content-Type header.
            contentType: file.type || undefined,
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const mediaType = guessMediaType(file);
        const { data: mediaRow, error: mediaError } = await supabase
          .from("media")
          .insert({
            org_id: shell.profile.org_id,
            project_id: targetProjectId,
            uploaded_by: shell.profile.id,
            media_type: mediaType,
            storage_path: storagePath,
            filename: file.name,
            file_size: file.size,
            mime_type: file.type,
            caption: caption.trim() || null,
            // before_leave videos are also "checkout proof" videos — the
            // worker just hasn't pressed Clock Out yet. Tagging them with
            // is_checkout lets the team page videoUploadedToday indicator
            // and the gate logic both detect them. before_work videos
            // are the start-of-shift counterpart — is_checkout=false so
            // the link-checkin-video route's predicate filter picks
            // them up without colliding with checkout candidates.
            is_checkout: mode === "checkout" || mode === "before_leave",
            time_event_id:
              mode === "checkout" ? shell.clockState.pendingCheckoutEventId : null,
            metadata: {
              uploadedBy: "worker-shell",
              ...(mode === "before_leave" ? { kind: "before_leave" } : {}),
              ...(mode === "before_work" ? { kind: "before_work" } : {}),
            },
          })
          .select("*")
          .single<WorkerMediaItem>();

        if (mediaError || !mediaRow) {
          throw new Error(mediaError?.message ?? "Media record insert failed.");
        }

        // Fire-and-forget Mux transcode kickoff for video uploads. iPhone
        // captures land here as HEVC inside a .mov container, which
        // Chrome / Edge / Firefox can't decode. The route creates a Mux
        // asset from the original and writes the Mux identifier into
        // metadata.mux_playback_id (NOT metadata.playback_path —
        // playback_path is reserved for a real Storage path of a
        // transcoded copy and is signed through the 'media' bucket).
        // selectMediaPlayback exposes the Mux ID separately as
        // muxPlaybackId for any future signed-Mux-URL minting layer.
        // We do not await — checkout and journal upload UX must not be
        // blocked by Mux ingest latency.
        if (mediaType === "video") {
          fetch("/api/media/transcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaId: mediaRow.id }),
            keepalive: true,
          }).catch((err) =>
            console.warn("[transcode] kickoff failed:", err),
          );
        }

        uploadedEntries.push({
          ...mediaRow,
          projectName:
            shell.projects.find((project) => project.id === targetProjectId)?.name ?? null,
        });
      }

      if (mode === "checkout" && shell.clockState.pendingCheckoutEventId) {
        try {
          const linkResp = await fetch("/api/worker/link-checkout-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timeEventId: shell.clockState.pendingCheckoutEventId,
            }),
            keepalive: true,
          });
          if (!linkResp.ok) {
            const detail = await linkResp.text().catch(() => "");
            console.warn(
              `[checkout-link] post-checkout upload HTTP ${linkResp.status}: ${detail.slice(0, 200)}`,
            );
          }
        } catch (linkErr) {
          console.warn("[checkout-link] post-checkout upload threw:", linkErr);
        }
      }

      // Sister of the checkout link above: fires the start-video
      // linker so the worker's "before work" upload is stamped with
      // the active clock_in's time_event_id and the event row's
      // video_status flips from "pending" to "uploaded". Without this
      // call, the manager's "start video required" banner stays stuck
      // even after a successful upload.
      if (mode === "before_work" && shell.clockState.pendingStartVideoEventId) {
        try {
          const linkResp = await fetch("/api/worker/link-checkin-video", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timeEventId: shell.clockState.pendingStartVideoEventId,
            }),
            keepalive: true,
          });
          if (!linkResp.ok) {
            const detail = await linkResp.text().catch(() => "");
            console.warn(
              `[checkin-link] post-checkin upload HTTP ${linkResp.status}: ${detail.slice(0, 200)}`,
            );
          }
        } catch (linkErr) {
          console.warn("[checkin-link] post-checkin upload threw:", linkErr);
        }
      }

      const nextSessions =
        mode === "checkout"
          ? shell.sessions.map((session) => {
              if (
                session.clockOutEventId &&
                session.clockOutEventId === shell.clockState.pendingCheckoutEventId
              ) {
                return {
                  ...session,
                  checkoutStatus: "uploaded" as const,
                };
              }

              return session;
            })
          : mode === "before_work"
            ? shell.sessions.map((session) => {
                // Optimistically flip the open shift's start gate so
                // the JournalPage warning clears immediately while the
                // link route is still processing on the server.
                if (
                  session.clockInEventId &&
                  session.clockInEventId === shell.clockState.pendingStartVideoEventId
                ) {
                  return {
                    ...session,
                    startVideoStatus: "uploaded" as const,
                  };
                }
                return session;
              })
            : shell.sessions;

      const nextClockState = deriveClockState(nextSessions);

      setShell((current) => ({
        ...current,
        media: [...uploadedEntries, ...current.media],
        sessions: nextSessions,
        clockState: nextClockState,
      }));
      setBanner({
        tone: "success",
        text:
          mode === "checkout"
            ? "Checkout video uploaded."
            : mode === "before_work"
              ? t("journal.startVideoUploaded")
              : `${selectedFiles.length} journal ${selectedFiles.length === 1 ? "item" : "items"} saved.`,
      });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      setBanner({ tone: "error", text: message });
    } finally {
      setBusyAction(null);
    }
  }

  async function updateTaskStatus(
    taskId: string,
    nextStatus: TaskStatus,
    options?: {
      note?: string;
      submittedFromCompletionModal?: true;
      followUpRequired?: boolean;
      followUpNote?: string;
      files?: File[];
      projectId?: string | null;
      existingMetadata?: Record<string, unknown> | null;
    },
  ) {
    setBusyAction(`task-${taskId}`);
    setBanner(null);

    try {
      if (nextStatus === "done" && !options?.submittedFromCompletionModal) {
        throw new Error(t("tasks.completionModalRequired"));
      }

      const completedAt = nextStatus === "done" ? new Date().toISOString() : null;
      // Compose the completion-evidence payload before the metadata
      // merge: files upload through the existing
      // /lib/task-attachments.uploadTaskAttachment path, which already
      // handles RLS + media-table inserts. The returned media.id values
      // get stamped into tasks.metadata.completion_media_ids so the
      // manager UI can resolve them via the existing task-attachments
      // helpers.
      const existing = shell.tasks.find((task) => task.id === taskId);
      const taskProjectId = existing?.project_id ?? options?.projectId ?? null;
      const existingMetadata = options?.existingMetadata ?? existing?.metadata ?? null;
      const completionMediaIds: string[] = [];
      if (
        nextStatus === "done" &&
        shouldBlockCompletionFileUpload({
          projectId: taskProjectId,
          fileCount: options?.files?.length ?? 0,
        })
      ) {
        throw new Error(t("tasks.completionFilesNeedProject"));
      }
      if (
        nextStatus === "done" &&
        options?.files &&
        options.files.length > 0 &&
        taskProjectId
      ) {
        for (const file of options.files) {
          const result = await uploadTaskAttachment(supabase, {
            orgId: shell.profile.org_id,
            projectId: taskProjectId,
            uploadedBy: shell.profile.id,
            file,
          });
          if (result.ok) {
            completionMediaIds.push(result.mediaId);
          } else {
            // Surface the storage failure but keep going with whatever
            // already uploaded — half-uploaded evidence is better than
            // dropping the whole completion.
            console.warn("[task-completion] file upload failed:", result.error);
          }
        }
      }

      const nextMetadata =
        nextStatus === "done"
          ? buildTaskCompletionMetadata(existingMetadata, {
              note: options?.note ?? null,
              followUpRequired: options?.followUpRequired ?? false,
              followUpNote: options?.followUpNote ?? null,
              completionMediaIds,
              completedById: shell.profile.id,
            })
          : null;
      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        completed_at: completedAt,
        completed_by: nextStatus === "done" ? shell.profile.id : null,
      };
      if (nextMetadata !== null) {
        updatePayload.metadata = nextMetadata;
      }

      const { error } = await supabase
        .from("tasks")
        .update(updatePayload)
        .eq("id", taskId);

      if (error) {
        throw new Error(error.message);
      }

      setShell((current) => ({
        ...current,
        tasks: current.tasks.map((task) => {
          if (task.id !== taskId) {
            return task;
          }

          return {
            ...task,
            status: nextStatus,
            completed_at: completedAt,
            completed_by: nextStatus === "done" ? current.profile.id : null,
            metadata: nextMetadata ?? task.metadata,
          };
        }),
      }));
      const successMessage =
        nextStatus === "done"
          ? options?.followUpRequired
            ? t("tasks.completedWithFollowUp")
            : completionMediaIds.length > 0 || options?.note
              ? t("tasks.completedWithEvidence")
              : t("tasks.completedSimple")
          : t("tasks.taskUpdated");
      setBanner({ tone: "success", text: successMessage });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task update failed.";
      setBanner({ tone: "error", text: message });
    } finally {
      setBusyAction(null);
    }
  }

  // Drain the offline queue: best-effort, item-by-item. Skips thumb-only
  // media entries (worker must re-pick the file). Removes each item from
  // localStorage on a successful Storage upload.
  //
  // Time-events drain runs first so the worker's session row exists in
  // the DB before any related media (checkout videos) are inserted —
  // media.time_event_id can then resolve to a real row. Replay order is
  // payload.event_time ASC so the DB trigger trg_auto_close_session
  // sees events in causal order.
  const drainOfflineQueue = useCallback(async () => {
    const mediaItems = loadOfflineQueue();
    const eventItems = sortQueueByEventTimeAsc(loadOfflineEventQueue());
    if (mediaItems.length === 0 && eventItems.length === 0) return;
    setDraining(true);
    try {
      // ── Phase 1: time events ────────────────────────────────────────
      for (const item of eventItems) {
        markEventStatus(item.client_event_id, {
          status: "syncing",
          lastAttemptAt: new Date().toISOString(),
        });

        // Layer B dedup: ask the server if a row with this client_event_id
        // already exists. If so, skip insert and just remove from queue.
        const { data: existing } = await supabase
          .from("time_events")
          .select("id")
          .eq("profile_id", item.payload.profile_id)
          .filter("metadata->>client_event_id", "eq", item.client_event_id)
          .limit(1)
          .maybeSingle<{ id: string }>();
        if (existing) {
          setOfflineEventQueue(removeOfflineEvent(item.client_event_id));
          continue;
        }

        const { error: insertError } = await supabase
          .from("time_events")
          .insert(item.payload);

        if (insertError) {
          markEventStatus(item.client_event_id, {
            status: isNetworkLikeError(insertError) ? "pending" : "failed",
            retryCount: item.retryCount + 1,
            lastErrorMessage: insertError.message,
          });
          setOfflineEventQueue(loadOfflineEventQueue());
          continue;
        }

        setOfflineEventQueue(removeOfflineEvent(item.client_event_id));
      }

      // ── Phase 2: media ─────────────────────────────────────────────
      for (const item of mediaItems) {
        const file = offlineUploadToFile(item);
        if (!file) continue; // thumb-only, needs re-pick
        const today = new Date().toISOString().slice(0, 10);
        const safeName = buildSafeUploadName(file, item.mode);
        const storagePath = `${item.orgId}/${item.projectId}/${today}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(storagePath, file, {
            upsert: false,
            cacheControl: "3600",
            contentType: file.type || undefined,
          });
        if (uploadError) continue;

        const queuedMediaType = guessMediaType(file);
        const { data: insertedRow, error: insertError } = await supabase
          .from("media")
          .insert({
            org_id: item.orgId,
            project_id: item.projectId,
            uploaded_by: item.profileId,
            media_type: queuedMediaType,
            storage_path: storagePath,
            filename: file.name,
            file_size: file.size,
            mime_type: file.type,
            caption: item.caption || null,
            is_checkout: item.mode === "checkout" || item.mode === "before_leave",
            time_event_id: null,
            metadata: {
              uploadedBy: "worker-shell",
              offlineQueued: true,
              ...(item.mode === "before_leave" ? { kind: "before_leave" } : {}),
            },
          })
          .select("id")
          .single<{ id: string }>();
        if (insertError || !insertedRow) continue;

        // Fire-and-forget Mux transcode kickoff for queued video drains
        // — same contract as the online path. Never awaited.
        if (queuedMediaType === "video") {
          fetch("/api/media/transcode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaId: insertedRow.id }),
            keepalive: true,
          }).catch((err) =>
            console.warn("[transcode] kickoff failed:", err),
          );
        }

        const remaining = removeOfflineUpload(item.id);
        setOfflineQueue(remaining);
      }
      router.refresh();
    } finally {
      setDraining(false);
    }
  }, [router, supabase]);

  // Auto-drain when the browser flips back online.
  useEffect(() => {
    if (!isOnline) return;
    if (offlineQueue.length === 0 && offlineEventQueue.length === 0) return;
    void drainOfflineQueue();
  }, [isOnline, offlineQueue.length, offlineEventQueue.length, drainOfflineQueue]);

  const value: WorkerShellContextValue = {
    shell,
    activeSeconds,
    busyAction,
    banner,
    lastGpsCheck,
    muted,
    offlineQueueLength: offlineQueue.length,
    isOnline,
    draining,
    dismissBanner,
    clockIn,
    clockOut,
    uploadMedia,
    updateTaskStatus,
    toggleMute,
    drainOfflineQueue,
    unseenTaskCount,
    markTasksSeen,
  };

  return (
    <WorkerShellContext.Provider value={value}>
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="mx-auto flex min-h-screen max-w-[500px] flex-col border-x border-[var(--border-subtle)]">
          <header className="px-4 pb-3 pt-3">
            {/* Top worker block — intentionally minimal:
                - Worker name only
                - Compact on/off indicator pill
                - Action buttons (mute / notif / language / sign out)
                The previous version was a sticky header with a 3-card
                Today/Week/Sessions grid. Those metrics live on /hours
                already (HoursPage), so they were removed here so the
                Clock page is not dominated by status chrome on mobile.
                Header scrolls with page (no `sticky`). */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-base font-bold text-[var(--text-primary)]">
                  {shell.profile.name}
                </h1>
                <span
                  className="shrink-0 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                  style={{
                    background: shell.clockState.isClockedIn
                      ? "rgba(46, 166, 122, 0.14)"
                      : "rgba(107, 114, 128, 0.14)",
                    color: shell.clockState.isClockedIn
                      ? "var(--green)"
                      : "var(--text-muted)",
                  }}
                >
                  {shell.clockState.isClockedIn ? t("common.live") : t("clock.ready")}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="inline-flex items-center justify-center rounded-[var(--radius-sm)] border px-2 py-1.5 text-sm"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "transparent",
                    color: "var(--text-secondary)",
                  }}
                  aria-label={muted ? t("sound.unmute") : t("sound.mute")}
                  title={muted ? t("sound.unmute") : t("sound.mute")}
                >
                  {muted ? "\ud83d\udd07" : "\ud83d\udd0a"}
                </button>
                <NotificationBell
                  profileId={shell.profile.id}
                  onUrgentArrival={setOverlayMessage}
                  unseenTaskCount={unseenTaskCount}
                />
                <LanguageSwitcher />
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={busyAction === "sign-out"}
                  className="button-base button-secondary px-3 py-2 text-xs"
                >
                  {busyAction === "sign-out" ? t("common.signingOut") : t("common.signOut")}
                </button>
              </div>
            </div>

            {offlineQueue.length > 0 ? (
              <div
                className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5 text-[11px] font-semibold"
                style={{
                  background: isOnline
                    ? "rgba(15, 168, 120, 0.14)"
                    : "rgba(245, 158, 11, 0.14)",
                  color: isOnline ? "var(--green)" : "#f59e0b",
                }}
              >
                <span aria-hidden>{isOnline ? "↻" : "⚠"}</span>
                {(isOnline && draining
                  ? t("uploads.retrying")
                  : t("uploads.offlineBanner")
                ).replace("{count}", String(offlineQueue.length))}
              </div>
            ) : null}

            {offlineEventQueue.length > 0 ? (
              <div
                className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5 text-[11px] font-semibold"
                style={{
                  background: isOnline
                    ? "rgba(15, 168, 120, 0.14)"
                    : "rgba(245, 158, 11, 0.14)",
                  color: isOnline ? "var(--green)" : "#f59e0b",
                }}
              >
                <span aria-hidden>{isOnline && draining ? "↻" : "⏳"}</span>
                {(isOnline && draining
                  ? t("worker.syncingShifts")
                  : t("worker.pendingShiftSync")
                ).replace("{count}", String(offlineEventQueue.length))}
              </div>
            ) : null}

            {banner ? (
              <div
                className="mt-3 flex items-start justify-between gap-3 rounded-[var(--radius-md)] px-3 py-3 text-sm"
                style={{
                  background:
                    banner.tone === "success"
                      ? "var(--green-bg)"
                      : banner.tone === "error"
                        ? "var(--red-bg)"
                        : "var(--blue-bg)",
                  color:
                    banner.tone === "success"
                      ? "var(--green)"
                      : banner.tone === "error"
                        ? "var(--red)"
                        : "var(--blue)",
                }}
              >
                <span>{banner.text}</span>
                <button
                  type="button"
                  onClick={dismissBanner}
                  className="shrink-0 border-none bg-transparent p-0 text-[11px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: "inherit" }}
                >
                  {t("common.dismiss")}
                </button>
              </div>
            ) : null}

            {/* Pending-checkout-video banner only shows when the worker's
                CURRENT profile.require_video is on. A previously-pending
                session whose checkoutStatus is "pending" stays in DB after
                a manager flips require_video off, but we should not keep
                nagging the worker for a video the manager no longer wants.
                This banner respects the live setting (synced via the
                profile realtime channel above). */}
            {shell.clockState.pendingCheckoutEventId && shell.profile.require_video ? (
              <div
                className="mt-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm"
                style={{
                  background: "rgba(191, 162, 52, 0.12)",
                  borderColor: "rgba(191, 162, 52, 0.22)",
                  color: "var(--brand-yellow)",
                }}
              >
                {t("worker.checkoutVideoNeeded")} {shell.clockState.pendingCheckoutProjectName}.
              </div>
            ) : null}

            {gpsTrackingEnabled && gpsState === "active" ? (
              <div
                className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2.5 text-sm"
                style={{ background: "rgba(46, 166, 122, 0.12)", color: "var(--green)" }}
              >
                <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--green)" }} />
                {t("gps.sharingActive")}
              </div>
            ) : null}

            {gpsState === "denied" ? (
              // Tracking-watch denied while clocked in. The previous behavior
              // here was a window.location.reload() that did nothing for a
              // worker whose OS-level GPS permission was off — they were
              // trapped in the red retry-only banner. Now this opens the
              // gpsPrompt modal in clockOut mode so the worker can either
              // retry GPS (after fixing settings) or close their shift
              // without GPS via the explicit "Clock out without GPS" path.
              <button
                type="button"
                onClick={() => setGpsPrompt({ kind: "clockOut", errorKind: "denied" })}
                className="mt-3 w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm"
                style={{ background: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" }}
              >
                {t("gps.trackingOffTapForOptions")}
              </button>
            ) : null}

            {iosTipShown && gpsTrackingEnabled ? (
              <div
                className="mt-3 rounded-[var(--radius-md)] px-3 py-2.5 text-xs"
                style={{ background: "rgba(59, 130, 246, 0.1)", color: "var(--blue)" }}
              >
                {t("gps.iosTip")}
              </div>
            ) : null}
          </header>

          <main className="flex-1 px-4 pb-24 pt-4">
            {children}
          </main>

          <nav
            className="worker-nav fixed bottom-0 left-0 right-0 z-30"
            style={{
              background: "rgba(24, 28, 39, 0.98)",
              backdropFilter: "blur(10px)",
              borderTop: "1px solid var(--border-default)",
            }}
          >
            <div className="mx-auto flex max-w-[500px] justify-around px-3 pb-3 pt-2">
              {navItems.map((item) => {
                const active = pathname === item.href;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => router.push(item.href)}
                    data-active={active}
                    className="worker-nav-item flex min-w-[58px] flex-col items-center gap-1 rounded-[var(--radius-md)] px-2 py-2"
                    style={{
                      background: active ? "rgba(191, 162, 52, 0.12)" : "transparent",
                      color: active ? "var(--brand-yellow)" : "var(--text-muted)",
                    }}
                  >
                    <item.icon size={20} strokeWidth={1.8} />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                      {t(item.labelKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
      {overlayMessage ? (
        <MessageOverlay
          message={overlayMessage}
          onDismiss={() => setOverlayMessage(null)}
        />
      ) : null}
      {showConsentModal ? (
        <GpsConsentModal
          workerName={shell.profile.name}
          onAccept={handleGpsConsent}
          onDecline={handleGpsDecline}
        />
      ) : null}
      {gpsPrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setGpsPrompt(null)}
        >
          <div
            className="surface-card w-full max-w-[420px] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-[var(--text-primary)]">
              {t("worker.gpsPromptTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t(gpsBanner(gpsPrompt.errorKind).key)}
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t("worker.gpsPromptHint")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const captured = gpsPrompt;
                  setGpsPrompt(null);
                  if (captured.kind === "clockIn") {
                    void clockIn(captured.projectId);
                  } else {
                    void clockOut();
                  }
                }}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
              >
                {t("worker.gpsPromptRetry")}
              </button>
              <button
                type="button"
                onClick={() => {
                  const captured = gpsPrompt;
                  setGpsPrompt(null);
                  // Forward the original errorKind so the time_event
                  // metadata records WHY GPS was skipped (denied vs
                  // unavailable vs unsupported). Manager review surfaces
                  // pick the kind off metadata.gps_error_kind.
                  if (captured.kind === "clockIn") {
                    void clockIn(captured.projectId, {
                      skipGps: true,
                      gpsErrorKind: captured.errorKind,
                    });
                  } else {
                    void clockOut({ skipGps: true, gpsErrorKind: captured.errorKind });
                  }
                }}
                className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "rgba(245,158,11,0.4)", color: "#f59e0b" }}
              >
                {gpsPrompt.kind === "clockIn"
                  ? t("worker.gpsPromptStartWithoutGps")
                  : t("worker.gpsPromptClockOutWithoutGps")}
              </button>
              <button
                type="button"
                onClick={() => setGpsPrompt(null)}
                className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </WorkerShellContext.Provider>
  );
}

export function WorkerSessionMeta({
  start,
  end,
  duration,
}: {
  start: string;
  end: string | null;
  duration: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-xs text-[var(--text-secondary)]">
      {formatEventDate(start)} • {formatEventTime(start)}
      {end ? ` - ${formatEventTime(end)}` : ` - ${t("common.live").toLowerCase()}`} • {formatDurationCompact(duration)}
    </div>
  );
}
