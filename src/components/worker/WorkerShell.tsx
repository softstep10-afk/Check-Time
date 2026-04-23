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
  slugifyFilename,
  toSupabasePoint,
} from "@/lib/worker-utils";
import { Timer, Camera, ClipboardCheck, CalendarClock } from "lucide-react";
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
import type { AppMessage } from "@/lib/message-types";

const navItems = [
  { href: "/clock", icon: Timer, label: "Clock", labelKey: "worker.navClock" as TranslationKey },
  { href: "/journal", icon: Camera, label: "Journal", labelKey: "worker.navJournal" as TranslationKey },
  { href: "/my-tasks", icon: ClipboardCheck, label: "Tasks", labelKey: "worker.navTasks" as TranslationKey },
  { href: "/hours", icon: CalendarClock, label: "Hours", labelKey: "worker.navHours" as TranslationKey },
];

type BannerState = {
  tone: "success" | "error" | "info";
  text: string;
} | null;

type UploadMode = "journal" | "checkout" | "before_leave";

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
  clockIn: (projectId: string) => Promise<void>;
  clockOut: () => Promise<void>;
  uploadMedia: (files: FileList | File[], caption: string, mode: UploadMode) => Promise<void>;
  updateTaskStatus: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
  toggleMute: () => void;
  drainOfflineQueue: () => Promise<void>;
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
  // Optimistic default `true`; effect below syncs from navigator.onLine
  // after mount so SSR and hydration agree on the same starting value.
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [draining, setDraining] = useState(false);

  // Hydrate queue once on mount.
  useEffect(() => {
    setOfflineQueue(loadOfflineQueue());
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
  useEffect(() => {
    if (consentChecked) return;
    async function checkConsent() {
      const state = await readLatestConsent(supabase, shell.profile.id);
      if (state !== "unknown") {
        const granted = state === "granted";
        setGpsConsented(granted);
        localStorage.setItem("check-time-gps-consent", String(granted));
      }
      setConsentChecked(true);
    }
    void checkConsent();
  }, [supabase, shell.profile.id, consentChecked]);

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

  async function clockIn(projectId: string) {
    const project = shell.projects.find((entry) => entry.id === projectId);

    if (!project) {
      setBanner({ tone: "error", text: "Pick a project before clocking in." });
      return;
    }

    setBusyAction("clock-in");
    setBanner(null);

    try {
      const gps = await getCurrentPosition();
      const timestamp = new Date().toISOString();

      // Resolve check-in radius: per-project gps_radius_m → app_settings → 75m.
      const appRadius = await getAppGeofenceRadiusM(supabase);
      const effectiveRadius = resolveProjectRadiusM(project, appRadius);

      if (project.site) {
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
      } else {
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
      }
      const insertPayload = {
        org_id: shell.profile.org_id,
        profile_id: shell.profile.id,
        project_id: project.id,
        event_type: "clock_in" as const,
        event_time: timestamp,
        gps_point: toSupabasePoint(gps),
        gps_accuracy_m: gps.accuracy,
        gps_source: "device",
        video_status: "not_required" as const,
        metadata: {
          capturedBy: "worker-shell",
          gps,
        },
      };

      const { data: insertedEvent, error } = await supabase
        .from("time_events")
        .insert(insertPayload)
        .select("*")
        .single<TimeEvent>();

      if (error || !insertedEvent) {
        throw new Error(error?.message ?? "Clock-in failed.");
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
      setBanner({ tone: "success", text: `Clocked into ${project.name}.` });
      playSound("clock-in");

      // Show consent modal on first-ever clock-in if not yet decided
      if (!localStorage.getItem("check-time-gps-consent")) {
        setShowConsentModal(true);
      }

      router.refresh();
    } catch (error) {
      if (error instanceof GpsError) {
        const { tone, key } = gpsBanner(error.kind);
        setBanner({ tone, text: t(key) });
        playSound("error");
        return;
      }
      const message = error instanceof Error ? error.message : "Clock-in failed.";
      setBanner({ tone: "error", text: message });
      playSound("error");
    } finally {
      setBusyAction(null);
    }
  }

  async function clockOut() {
    if (!shell.clockState.isClockedIn || !shell.clockState.currentProjectId) {
      setBanner({ tone: "error", text: "There is no active shift to close." });
      return;
    }

    setBusyAction("clock-out");
    setBanner(null);

    try {
      const gps = await getCurrentPosition();
      const timestamp = new Date().toISOString();
      const videoStatus: WorkerSession["checkoutStatus"] = shell.profile.require_video
        ? "pending"
        : "not_required";

      const { data: insertedEvent, error } = await supabase
        .from("time_events")
        .insert({
          org_id: shell.profile.org_id,
          profile_id: shell.profile.id,
          project_id: shell.clockState.currentProjectId,
          event_type: "clock_out" as const,
          event_time: timestamp,
          gps_point: toSupabasePoint(gps),
          gps_accuracy_m: gps.accuracy,
          gps_source: "device",
          video_status: videoStatus,
          metadata: {
            capturedBy: "worker-shell",
            gps,
          },
        })
        .select("*")
        .single<TimeEvent>();

      if (error || !insertedEvent) {
        throw new Error(error?.message ?? "Clock-out failed.");
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
          checkoutStatus: videoStatus,
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
        tone: shell.profile.require_video ? "info" : "success",
        text: shell.profile.require_video
          ? "Shift closed. Checkout video is waiting in Journal."
          : "Clocked out.",
      });
      playSound("clock-out");
      router.refresh();
    } catch (error) {
      if (error instanceof GpsError) {
        const { tone, key } = gpsBanner(error.kind);
        setBanner({ tone, text: t(key) });
        playSound("error");
        return;
      }
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
          : "journal-upload",
    );
    setBanner(null);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const uploadedEntries: WorkerMediaItem[] = [];

      for (const file of selectedFiles) {
        const safeName = slugifyFilename(file.name || `${mode}-${Date.now()}`);
        const storagePath = `${shell.profile.org_id}/${targetProjectId}/${today}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(storagePath, file, {
            upsert: false,
            cacheControl: "3600",
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
            // and the gate logic both detect them.
            is_checkout: mode === "checkout" || mode === "before_leave",
            time_event_id:
              mode === "checkout" ? shell.clockState.pendingCheckoutEventId : null,
            metadata: {
              uploadedBy: "worker-shell",
              ...(mode === "before_leave" ? { kind: "before_leave" } : {}),
            },
          })
          .select("*")
          .single<WorkerMediaItem>();

        if (mediaError || !mediaRow) {
          throw new Error(mediaError?.message ?? "Media record insert failed.");
        }

        uploadedEntries.push({
          ...mediaRow,
          projectName:
            shell.projects.find((project) => project.id === targetProjectId)?.name ?? null,
        });
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

  async function updateTaskStatus(taskId: string, nextStatus: TaskStatus) {
    setBusyAction(`task-${taskId}`);
    setBanner(null);

    try {
      const completedAt = nextStatus === "done" ? new Date().toISOString() : null;

      const { error } = await supabase
        .from("tasks")
        .update({
          status: nextStatus,
          completed_at: completedAt,
          completed_by: nextStatus === "done" ? shell.profile.id : null,
        })
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
          };
        }),
      }));
      setBanner({ tone: "success", text: "Task updated." });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Task update failed.";
      setBanner({ tone: "error", text: message });
    } finally {
      setBusyAction(null);
    }
  }

  // Drain the offline queue: best-effort, item-by-item. Skips thumb-only
  // entries (worker must re-pick the file). Removes each item from
  // localStorage on a successful Storage upload.
  const drainOfflineQueue = useCallback(async () => {
    const items = loadOfflineQueue();
    if (items.length === 0) return;
    setDraining(true);
    try {
      for (const item of items) {
        const file = offlineUploadToFile(item);
        if (!file) continue; // thumb-only, needs re-pick
        const today = new Date().toISOString().slice(0, 10);
        const safeName = slugifyFilename(file.name || `${item.mode}-${Date.now()}`);
        const storagePath = `${item.orgId}/${item.projectId}/${today}/${Date.now()}-${safeName}`;

        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(storagePath, file, { upsert: false, cacheControl: "3600" });
        if (uploadError) continue;

        const { error: insertError } = await supabase.from("media").insert({
          org_id: item.orgId,
          project_id: item.projectId,
          uploaded_by: item.profileId,
          media_type: guessMediaType(file),
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
        });
        if (insertError) continue;

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
    if (offlineQueue.length === 0) return;
    void drainOfflineQueue();
  }, [isOnline, offlineQueue.length, drainOfflineQueue]);

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
  };

  return (
    <WorkerShellContext.Provider value={value}>
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="mx-auto flex min-h-screen max-w-[500px] flex-col border-x border-[var(--border-subtle)]">
          <header
            className="sticky top-0 z-20 px-4 pb-4 pt-4"
            style={{
              background: "rgba(15, 17, 23, 0.96)",
              backdropFilter: "blur(12px)",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  {t("worker.flow")}
                </p>
                <h1 className="mt-1 text-[20px] font-bold text-[var(--text-primary)]">
                  {shell.profile.name}
                </h1>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {shell.clockState.isClockedIn && shell.clockState.currentProjectName
                    ? mounted
                      ? `${shell.clockState.currentProjectName} • ${formatElapsedSeconds(activeSeconds)}`
                      : shell.clockState.currentProjectName
                    : t("worker.readyToStart")}
                </p>
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

            <div className="mt-4 grid grid-cols-3 gap-2">
              <div
                className="metric-panel rounded-[var(--radius-lg)] px-3 py-3"
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("common.today")}
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(shell.summary.todayMinutes)}
                </div>
              </div>
              <div
                className="metric-panel rounded-[var(--radius-lg)] px-3 py-3"
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("common.thisWeek")}
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(shell.summary.weekMinutes)}
                </div>
              </div>
              <div
                className="metric-panel rounded-[var(--radius-lg)] px-3 py-3"
              >
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("common.sessions")}
                </div>
                <div className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">
                  {shell.summary.totalSessions}
                </div>
              </div>
            </div>

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

            {shell.clockState.pendingCheckoutEventId ? (
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
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-3 w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm"
                style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
              >
                {t("gps.permissionDenied")}
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
