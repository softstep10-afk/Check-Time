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
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { closeOpenStoreVisits } from "@/lib/store-visits";
import { getAppGeofenceRadiusM, resolveProjectRadiusM } from "@/lib/geofence";
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
  dismissBanner: () => void;
  clockIn: (projectId: string) => Promise<void>;
  clockOut: () => Promise<void>;
  uploadMedia: (files: FileList | File[], caption: string, mode: UploadMode) => Promise<void>;
  updateTaskStatus: (taskId: string, nextStatus: TaskStatus) => Promise<void>;
};

const WorkerShellContext = createContext<WorkerShellContextValue | null>(null);

async function getCurrentPosition(): Promise<WorkerGeoPoint & { accuracy: number }> {
  if (!navigator.geolocation) {
    throw new Error("This device does not support GPS.");
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
      () => reject(new Error("Location access is required to record this shift.")),
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
  const [now, setNow] = useState(() => Date.now());
  const { t } = useTranslation();

  // ── Sound mute state ──
  const [muted, setMuted] = useState(true); // start true, read localStorage in effect
  const audioUnlocked = useRef(false);

  useEffect(() => {
    const stored = localStorage.getItem("check-time-muted");
    setMuted(stored === "true");
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      localStorage.setItem("check-time-muted", String(next));
      return next;
    });
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
  const [gpsConsented, setGpsConsented] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("check-time-gps-consent") === "true";
  });
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [iosTipShown, setIosTipShown] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  // Check consent from DB on mount (localStorage is cache, DB is source of truth)
  useEffect(() => {
    if (AUTH_BYPASS_ENABLED || consentChecked) return;
    async function checkConsent() {
      const { data } = await supabase
        .from("worker_location_consents")
        .select("consented")
        .eq("worker_id", shell.profile.id)
        .order("signed_at", { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        const consented = (data[0] as { consented: boolean }).consented;
        setGpsConsented(consented);
        localStorage.setItem("check-time-gps-consent", String(consented));
      }
      setConsentChecked(true);
    }
    void checkConsent();
  }, [supabase, shell.profile.id, consentChecked]);

  const gpsTrackingEnabled = gpsConsented && shell.clockState.isClockedIn;

  const handleGpsPosition = useCallback(
    (pos: { lat: number; lng: number; accuracy: number; heading: number | null; speed: number | null }) => {
      if (AUTH_BYPASS_ENABLED) return; // No GPS posting in demo mode
      void supabase.from("worker_live_locations").insert({
        org_id: shell.profile.org_id,
        worker_id: shell.profile.id,
        shift_id: shell.clockState.openEventId ?? null,
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        heading: pos.heading,
        speed: pos.speed,
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
    // Persist to DB
    if (!AUTH_BYPASS_ENABLED) {
      void supabase.from("worker_location_consents").insert({
        org_id: shell.profile.org_id,
        worker_id: shell.profile.id,
        signed_name: signedName,
        consented: true,
        consent_version: 1,
        user_agent: navigator.userAgent,
      });
    }
    // Cache in localStorage
    localStorage.setItem("check-time-gps-consent", "true");
    setGpsConsented(true);
    setShowConsentModal(false);
  }

  function handleGpsDecline() {
    // Persist to DB
    if (!AUTH_BYPASS_ENABLED) {
      void supabase.from("worker_location_consents").insert({
        org_id: shell.profile.org_id,
        worker_id: shell.profile.id,
        signed_name: shell.profile.name,
        consented: false,
        consent_version: 1,
        user_agent: navigator.userAgent,
      });
    }
    localStorage.setItem("check-time-gps-consent", "false");
    setGpsConsented(false);
    setShowConsentModal(false);
  }

  useEffect(() => {
    setShell(initialData);
  }, [initialData]);

  useEffect(() => {
    if (!shell.clockState.isClockedIn || !shell.clockState.clockInTime) {
      return;
    }

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [shell.clockState.clockInTime, shell.clockState.isClockedIn]);

  const activeSeconds =
    shell.clockState.isClockedIn && shell.clockState.clockInTime
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

  const value: WorkerShellContextValue = {
    shell,
    activeSeconds,
    busyAction,
    banner,
    lastGpsCheck,
    dismissBanner,
    clockIn,
    clockOut,
    uploadMedia,
    updateTaskStatus,
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
                    ? `${shell.clockState.currentProjectName} • ${formatElapsedSeconds(activeSeconds)}`
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
                <NotificationBell profileId={shell.profile.id} />
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
