"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { formatDateTime, formatDurationCompact, formatEventTime } from "@/lib/worker-utils";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
} from "@/lib/manager-types";
import {
  TRANSFER_GAP_COLOR,
  type TransferGap,
} from "@/lib/manager-utils";
import {
  deriveWorkerHourBuckets,
  isPaidOrClosedAdjustment,
} from "@/lib/worker-hour-summary";
import { getEffectiveTaskStatus, isEffectiveOpenTask } from "@/lib/task-status";
import type { Media, ProjectAssignment, Task, UserRole } from "@/types/database";
import type { StoreVisit } from "@/lib/store-types";
import { ArrowRight, Camera, Store } from "lucide-react";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { canUpdateTeamRole } from "@/lib/role-permissions";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { SendMessageForm } from "@/components/manager/SendMessageForm";
import { DayDetailModal } from "@/components/manager/DayDetailModal";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import { normalizeStoragePath } from "@/lib/task-attachments";
import {
  EXTREME_SHIFT_MINUTES,
  LONG_SHIFT_MINUTES,
  SHIFT_REVIEW_COLOR,
  WARN_SHIFT_MINUTES,
  type ShiftReview,
  type ShiftReviewStatus,
} from "@/lib/shift-review";
import { selectMediaPlayback } from "@/lib/media-playback";
import {
  formatProfileSkillInput,
  mergeProfileSkillSettings,
  readProfileSkillSettings,
} from "@/lib/profile-skills";
import {
  MediaGalleryDrawer,
  type GalleryItem,
} from "@/components/shared/MediaGalleryDrawer";
import {
  MediaViewerModal,
  useMediaViewerOpenGuard,
  type ViewerMediaItem,
} from "@/components/shared/MediaViewerModal";

const roleOptions: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "sales",
  "subcontractor",
  "manager",
  "admin",
  "owner",
];

const OWNER_ADMIN_ROLES = new Set<UserRole>(["owner", "admin"]);

type WorkerMediaRow = Media & { projectName: string | null };

type WorkerMediaFolderKey =
  | "checkout"
  | "checkin"
  | "video"
  | "photo"
  | "document"
  | "receipt"
  | "other";

const WORKER_MEDIA_FOLDER_ORDER: WorkerMediaFolderKey[] = [
  "checkout",
  "checkin",
  "video",
  "photo",
  "document",
  "receipt",
  "other",
];

const WORKER_MEDIA_FOLDER_LABELS: Record<WorkerMediaFolderKey, TranslationKey> = {
  checkout: "teamMember.checkoutVideos",
  checkin: "teamMember.checkinVideos",
  video: "teamMember.journalVideos",
  photo: "teamMember.journalPhotos",
  document: "teamMember.journalDocuments",
  receipt: "teamMember.journalReceipts",
  other: "teamMember.journalOther",
};

function getWorkerMediaFolderKey(entry: WorkerMediaRow): WorkerMediaFolderKey {
  const metadata = (entry.metadata ?? null) as Record<string, unknown> | null;
  const kind = metadata?.kind;
  const category = metadata?.category;

  if (entry.media_type === "video" && entry.is_checkout) return "checkout";
  if (entry.media_type === "video" && kind === "before_work") return "checkin";
  if (kind === "receipt" || category === "receipt") return "receipt";
  if (entry.media_type === "photo") return "photo";
  if (entry.media_type === "video") return "video";
  if (entry.media_type === "pdf" || entry.media_type === "document") return "document";
  return "other";
}

type DailyTotal = {
  date: string;
  minutes: number;
  otLevel: "ok" | "warning" | "critical";
};

type WorkerClosureView = {
  payrollRunId: string;
  closedThrough: string;
  periodStart: string | null;
  periodEnd: string | null;
  status: string | null;
  totalHours: number | null;
  totalAmount: number | null;
};

function formatPayrollPeriodDate(value: string): string {
  const normalized = value.length <= 10 ? `${value}T12:00:00` : value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(normalized));
}

export function TeamMemberPage({
  orgId,
  managerId,
  managerName,
  managerRole,
  hasFinanceAccess,
  profile,
  projects,
  assignments,
  tasks,
  sessions,
  acknowledgedShiftEventIds,
  storeVisits,
  media,
  hasGpsBySessionId,
  weekGpsMinutes,
  weekNoGpsMinutes,
  dailyTotals,
  excludedProjectIds,
  currentShiftReview,
  transferGaps,
  workerAdjustments,
  workerClosures,
}: {
  orgId: string;
  managerId: string;
  managerName: string;
  managerRole: UserRole;
  hasFinanceAccess: boolean;
  profile: ManagerProfileSummary;
  projects: ManagerProjectSummary[];
  assignments: ProjectAssignment[];
  tasks: Task[];
  sessions: ManagerSession[];
  acknowledgedShiftEventIds: string[];
  storeVisits: StoreVisit[];
  media: WorkerMediaRow[];
  hasGpsBySessionId: Record<string, boolean>;
  weekGpsMinutes: number;
  weekNoGpsMinutes: number;
  dailyTotals: DailyTotal[];
  excludedProjectIds: string[];
  currentShiftReview: ShiftReview | null;
  transferGaps: TransferGap[];
  workerAdjustments: Array<{
    id: string;
    projectId: string;
    projectName: string | null;
    eventTime: string;
    minutes: number;
    reason: string;
    kind: string | null;
  }>;
  workerClosures: WorkerClosureView[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [resetPinResult, setResetPinResult] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAdjustForm, setShowAdjustForm] = useState(false);
  const [adjustSign, setAdjustSign] = useState<"+" | "-">("+");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showUnpaidBreakdown, setShowUnpaidBreakdown] = useState(false);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [mediaViewerItem, setMediaViewerItem] = useState<ViewerMediaItem | null>(null);
  // Journal-timeline gallery drawer (open via "Open gallery" near the
  // Journal entries header). Filters live inside the drawer; the page
  // state only needs an open/closed flag.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const {
    canOpenViewerItem: canOpenMediaViewerItem,
    suppressViewerItem: suppressMediaViewerItem,
  } = useMediaViewerOpenGuard();
  const { t, locale } = useTranslation();
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
        style: "currency",
        currency: "USD",
      }),
    [locale],
  );
  const profileSkillSettings = useMemo(
    () => readProfileSkillSettings(profile.settings),
    [profile.settings],
  );

  const mediaIds = useMemo(() => media.map((m) => m.id), [media]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await fetchOpenFlagMediaIds(supabase, mediaIds);
      if (!cancelled) setOpenFlagIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, mediaIds]);

  async function refreshOpenFlags() {
    const ids = await fetchOpenFlagMediaIds(supabase, mediaIds);
    setOpenFlagIds(ids);
  }

  // Click-to-open for worker media (checkout videos + journal entries).
  // Keep the manager in-app: MediaViewerModal signs and previews the
  // selected storage object, while the separate Download action still
  // pulls the original file.
  function openMediaItem(item: WorkerMediaRow) {
    if (!canOpenMediaViewerItem(item.id)) return;
    setMediaViewerItem(item as unknown as ViewerMediaItem);
  }

  // Download fallback — for iPhone HEVC `.mov` clips that Chrome / Edge /
  // Firefox can't decode (frame goes black, audio silent, but duration
  // loads), and for older uploads whose storage Content-Type metadata
  // was wrong. Triggers a real file download via the bucket's signed
  // URL with `?download=...`, so the manager can play the original on
  // their phone, in QuickTime, or in VLC.
  async function downloadMediaItem(item: {
    id: string;
    storage_path: string;
    filename: string | null;
  }) {
    if (typeof window === "undefined") return;
    const normalized = normalizeStoragePath(item.storage_path);
    const fallbackName = normalized.split("/").pop() ?? "download";
    const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600, { download: downloadAs });
    if (error || !data?.signedUrl) {
      setMessage(t("projectDetail.mediaOpenFailed"));
      setMessageType("error");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = downloadAs;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // Journal timeline drawer feed — same media rows that already power the
  // existing "Journal entries" list, just shaped for the shared gallery
  // component (project / uploader names resolved). All filtering happens
  // inside the drawer.
  const galleryItems = useMemo<GalleryItem[]>(
    () =>
      media.map((entry) => ({
        id: entry.id,
        project_id: entry.project_id,
        uploaded_by: entry.uploaded_by ?? null,
        media_type: entry.media_type,
        storage_path: entry.storage_path,
        filename: entry.filename ?? null,
        mime_type: entry.mime_type ?? null,
        caption: entry.caption ?? null,
        is_checkout: Boolean(entry.is_checkout),
        time_event_id: entry.time_event_id ?? null,
        metadata: (entry.metadata ?? null) as Record<string, unknown> | null,
        created_at: entry.created_at,
        projectName: entry.projectName ?? null,
        uploaderName: profile.name,
      })),
    [media, profile.name],
  );

  const galleryProjectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of media) {
      if (entry.project_id && entry.projectName && !seen.has(entry.project_id)) {
        seen.set(entry.project_id, entry.projectName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [media]);

  const mediaSections = useMemo(() => {
    const byFolder = new Map<WorkerMediaFolderKey, WorkerMediaRow[]>(
      WORKER_MEDIA_FOLDER_ORDER.map((key) => [key, []]),
    );

    for (const entry of media) {
      const key = getWorkerMediaFolderKey(entry);
      byFolder.get(key)?.push(entry);
    }

    return WORKER_MEDIA_FOLDER_ORDER.map((key) => ({
      key,
      label: t(WORKER_MEDIA_FOLDER_LABELS[key]),
      items: (byFolder.get(key) ?? []).sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      ),
    })).filter((section) => section.items.length > 0);
  }, [media, t]);

  const latestClosure = useMemo(
    () =>
      workerClosures.reduce<WorkerClosureView | null>((latest, closure) => {
        const closedThroughMs = new Date(closure.closedThrough).getTime();
        if (!Number.isFinite(closedThroughMs)) return latest;
        if (
          !latest ||
          closedThroughMs > new Date(latest.closedThrough).getTime()
        ) {
          return closure;
        }
        return latest;
      }, null),
    [workerClosures],
  );
  const latestClosureMs = latestClosure
    ? new Date(latestClosure.closedThrough).getTime()
    : null;
  const acknowledgedShiftIdSet = useMemo(
    () => new Set(acknowledgedShiftEventIds),
    [acknowledgedShiftEventIds],
  );
  const sessionNeedsPayrollReview = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const session of sessions) {
      if (session.isOpen) {
        map.set(session.id, false);
        continue;
      }
      const acknowledged = Boolean(
        session.clockOutEventId &&
          acknowledgedShiftIdSet.has(session.clockOutEventId),
      );
      const hasGps = hasGpsBySessionId[session.id] ?? false;
      map.set(
        session.id,
        !acknowledged &&
          (
            !hasGps ||
            session.checkoutStatus === "pending" ||
            session.durationMinutes >= WARN_SHIFT_MINUTES
          ),
      );
    }
    return map;
  }, [sessions, acknowledgedShiftIdSet, hasGpsBySessionId]);
  // Hour buckets for the "Hour summary" panel below profile settings.
  // Suspicious closed shifts stay outside the paid/closed bucket until a
  // manager acknowledges them, even when a payroll closure cutoff exists.
  const hourBuckets = useMemo(
    () =>
      deriveWorkerHourBuckets({
        sessions: sessions.map((session) => ({
          clockInTime: session.clockInTime,
          clockOutTime: session.clockOutTime,
          durationMinutes: session.durationMinutes,
          reviewRequired: sessionNeedsPayrollReview.get(session.id) ?? false,
        })),
        adjustments: workerAdjustments,
        closures: workerClosures,
      }),
    [sessions, workerAdjustments, workerClosures, sessionNeedsPayrollReview],
  );
  const paidClosedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    if (latestClosureMs === null) return ids;
    for (const session of sessions) {
      if (!session.clockOutTime) continue;
      if (sessionNeedsPayrollReview.get(session.id)) continue;
      const outMs = new Date(session.clockOutTime).getTime();
      if (Number.isFinite(outMs) && outMs <= latestClosureMs) {
        ids.add(session.id);
      }
    }
    return ids;
  }, [sessions, latestClosureMs, sessionNeedsPayrollReview]);
  const sessionRows = useMemo(
    () => sessions.filter((session) => !paidClosedSessionIds.has(session.id)),
    [sessions, paidClosedSessionIds],
  );
  const closedProblemShifts = useMemo(
    () =>
      sessions.filter((session) => {
        if (session.isOpen) return false;
        if (paidClosedSessionIds.has(session.id)) return false;
        if (
          session.clockOutEventId &&
          acknowledgedShiftIdSet.has(session.clockOutEventId)
        ) {
          return false;
        }
        return (
          sessionNeedsPayrollReview.get(session.id) ||
          session.durationMinutes >= LONG_SHIFT_MINUTES ||
          session.checkoutStatus === "pending"
        );
      }),
    [sessions, paidClosedSessionIds, acknowledgedShiftIdSet, sessionNeedsPayrollReview],
  );
  const latestPaidPeriodLabel = latestClosure
    ? latestClosure.periodStart && latestClosure.periodEnd
      ? `${formatPayrollPeriodDate(latestClosure.periodStart)} - ${formatPayrollPeriodDate(latestClosure.periodEnd)}`
      : `${t("teamMember.closedThrough")} ${formatDateTime(latestClosure.closedThrough)}`
    : null;
  const latestPaidAmountLabel =
    latestClosure?.totalAmount !== null && latestClosure?.totalAmount !== undefined
      ? currencyFormatter.format(latestClosure.totalAmount)
      : null;
  const latestPaidHoursLabel =
    latestClosure?.totalHours !== null && latestClosure?.totalHours !== undefined
      ? `${latestClosure.totalHours.toFixed(2)}h`
      : null;
  const unpaidMinutes = hourBuckets.unpaidMinutes;
  const unpaidHours = Math.round((unpaidMinutes / 60) * 100) / 100;
  const unpaidAmount = Math.round((unpaidHours * Number(profile.hourly_rate ?? 0)) * 100) / 100;
  const sessionMinutes = useMemo(
    () =>
      sessions.reduce(
        (sum, session) => sum + session.durationMinutes,
        0,
      ),
    [sessions],
  );
  const adjustmentRows = useMemo(
    () =>
      workerAdjustments.filter((adjustment) => {
        if (adjustment.minutes === 0) return false;
        if (isPaidOrClosedAdjustment(adjustment)) return false;
        const adjustmentMs = new Date(adjustment.eventTime).getTime();
        return (
          latestClosureMs === null ||
          !Number.isFinite(adjustmentMs) ||
          adjustmentMs > latestClosureMs
        );
      }),
    [workerAdjustments, latestClosureMs],
  );
  const paidClosedAdjustmentRows = useMemo(
    () =>
      workerAdjustments
        .filter((adjustment) =>
          adjustment.minutes !== 0 && isPaidOrClosedAdjustment(adjustment),
        )
        .sort(
          (left, right) =>
            new Date(right.eventTime).getTime() - new Date(left.eventTime).getTime(),
        ),
    [workerAdjustments],
  );

  const assignedProjectIds = new Set(assignments.map((assignment) => assignment.project_id));
  const activeProjects = projects.filter((project) => !project.deleted_at && project.status !== "archived");
  const isOwnerAdminProfile = OWNER_ADMIN_ROLES.has(profile.role);
  const ownerProjectRows = activeProjects.slice(0, 8);
  const editableRoleOptions = useMemo(
    () =>
      roleOptions.filter(
        (role) =>
          role === profile.role ||
          canUpdateTeamRole(managerRole, profile.role, role),
      ),
    [managerRole, profile.role],
  );

  // Migration 00018 — per-worker visibility mode. Default to 'list' for
  // legacy / unmigrated rows so behavior matches today.
  const initialAccessMode: "list" | "all_active" =
    (profile as { project_access_mode?: "list" | "all_active" | null }).project_access_mode === "all_active"
      ? "all_active"
      : "list";
  const [accessMode, setAccessMode] = useState<"list" | "all_active">(initialAccessMode);
  const [excludedSet, setExcludedSet] = useState<Set<string>>(
    () => new Set(excludedProjectIds),
  );
  async function handleUpdateProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? profile.name;
    const role = (formData.get("role")?.toString() ?? profile.role) as UserRole;
    const roleIsOwnerAdmin = OWNER_ADMIN_ROLES.has(role);
    const hourlyRateRaw = hasFinanceAccess && !roleIsOwnerAdmin
      ? formData.get("hourly_rate")?.toString().trim() ?? ""
      : "";
    const requireVideo = roleIsOwnerAdmin ? false : formData.get("require_video") === "on";
    const isActive = formData.get("is_active") === "on";
    const workerSkillsText = formData.get("worker_skills_text")?.toString() ?? "";
    const workerCapabilitiesNote =
      formData.get("worker_capabilities_note")?.toString() ?? "";
    const nextSettings = mergeProfileSkillSettings(
      profile.settings,
      workerSkillsText,
      workerCapabilitiesNote,
    );

    setBusyKey("profile");
    setMessage("");

    const response = await fetch("/api/team/update-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId: profile.id,
        name,
        role,
        hourlyRate: hasFinanceAccess && !roleIsOwnerAdmin ? hourlyRateRaw : "",
        requireVideo,
        isActive,
        settings: nextSettings,
      }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("permissions.saveFailed"));
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("teamMember.profileUpdated"));
    router.refresh();
  }

  async function handleToggleAssignment(projectId: string) {
    setBusyKey(`toggle-${projectId}`);
    setMessage("");

    if (accessMode === "all_active") {
      // In 'all_active' mode the per-project switch toggles an exclusion.
      // Toggle ON  = project visible = ensure NO exclusion row exists.
      // Toggle OFF = project hidden  = INSERT an exclusion row.
      const isExcluded = excludedSet.has(projectId);
      if (isExcluded) {
        const { error } = await supabase
          .from("project_exclusions")
          .delete()
          .eq("profile_id", profile.id)
          .eq("project_id", projectId);
        if (error) {
          setMessage(error.message);
          setMessageType("error");
          setBusyKey(null);
          return;
        }
        const next = new Set(excludedSet);
        next.delete(projectId);
        setExcludedSet(next);
        setMessage(t("teamMember.projectAssigned"));
      } else {
        const { error } = await supabase.from("project_exclusions").insert({
          org_id: orgId,
          profile_id: profile.id,
          project_id: projectId,
        });
        if (error) {
          setMessage(error.message);
          setMessageType("error");
          setBusyKey(null);
          return;
        }
        const next = new Set(excludedSet);
        next.add(projectId);
        setExcludedSet(next);
        setMessage(t("teamMember.assignmentRemoved"));
      }
      setBusyKey(null);
      setMessageType("success");
      router.refresh();
      return;
    }

    // 'list' mode — original behavior, untouched.
    const existing = assignments.find((a) => a.project_id === projectId);

    if (existing) {
      const { error } = await supabase
        .from("project_assignments")
        .delete()
        .eq("id", existing.id);

      if (error) {
        setMessage(error.message);
        setMessageType("error");
        setBusyKey(null);
        return;
      }

      setMessage(t("teamMember.assignmentRemoved"));
    } else {
      const { error } = await supabase.from("project_assignments").insert({
        org_id: orgId,
        profile_id: profile.id,
        project_id: projectId,
      });

      if (error) {
        setMessage(error.message);
        setMessageType("error");
        setBusyKey(null);
        return;
      }

      setMessage(t("teamMember.projectAssigned"));
    }

    setMessageType("success");
    setBusyKey(null);
    router.refresh();
  }

  async function handleSetAccessMode(nextMode: "list" | "all_active") {
    if (nextMode === accessMode) return;

    // Surface the visibility delta before flipping. Going list → all_active
    // can grow the worker's project set significantly; going the other way
    // can shrink it. The manager should explicitly opt in.
    if (nextMode === "all_active") {
      const willGrow = activeProjects.filter(
        (project) => !assignedProjectIds.has(project.id) && !excludedSet.has(project.id),
      ).length;
      if (willGrow > 0) {
        const ok = window.confirm(
          t("teamMember.accessModeAllActiveConfirm").replace("{count}", String(willGrow)),
        );
        if (!ok) return;
      }
    } else {
      const visibleNow = activeProjects.filter(
        (project) => !excludedSet.has(project.id),
      ).length;
      if (visibleNow > 0) {
        const ok = window.confirm(
          t("teamMember.accessModeListConfirm").replace("{count}", String(visibleNow)),
        );
        if (!ok) return;
      }
    }

    setBusyKey("access-mode");
    setMessage("");
    const { error } = await supabase
      .from("profiles")
      .update({ project_access_mode: nextMode })
      .eq("id", profile.id);
    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      return;
    }
    setAccessMode(nextMode);
    setMessage(t("teamMember.accessModeUpdated"));
    setMessageType("success");
    setBusyKey(null);
    router.refresh();
  }

  async function handleResetPin() {
    setBusyKey("reset-pin");
    setMessage("");
    setResetPinResult(null);

    const response = await fetch("/api/team/reset-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: profile.id }),
    });
    const result = (await response.json()) as { error?: string; pin?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("teamMember.couldNotResetPin"));
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setResetPinResult(result.pin ?? null);
    setMessage(`${t("teamMember.pinResetSuccess")} ${result.pin}`);
    setMessageType("success");
  }

  async function handleToggleActive() {
    setBusyKey("toggle-active");
    setMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({ is_active: !profile.is_active })
      .eq("id", profile.id);

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(profile.is_active ? t("teamMember.workerDeactivated") : t("teamMember.workerReactivated"));
    setMessageType("success");
    router.refresh();
  }

  async function handleDeleteWorker() {
    setBusyKey("delete");
    setMessage("");

    const response = await fetch("/api/team/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: profile.id, deleteAuthUser: true }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("teamMember.couldNotRemove"));
      setMessageType("error");
      setBusyKey(null);
      setShowDeleteConfirm(false);
      return;
    }

    setBusyKey(null);
    router.push("/team");
    router.refresh();
  }

  async function handlePayWorkerNow() {
    if (unpaidMinutes <= 0) {
      setMessage(t("teamMember.payWorkerNoBalance"));
      setMessageType("info");
      return;
    }

    const amountLabel = currencyFormatter.format(unpaidAmount);
    const ok = window.confirm(
      t("teamMember.payWorkerConfirm")
        .replace("{name}", profile.name)
        .replace("{hours}", formatDurationCompact(unpaidMinutes))
        .replace("{amount}", amountLabel),
    );
    if (!ok) return;

    setBusyKey("pay-worker");
    setMessage("");

    const response = await fetch("/api/team/pay-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: profile.id }),
    });
    const result = (await response.json()) as {
      error?: string;
      reviewProjects?: string[];
      totalHours?: number;
      totalAmount?: number;
      periodStart?: string;
      periodEnd?: string;
    };

    if (!response.ok) {
      setMessage(
        result.error === "unreviewed_shifts"
          ? t("teamMember.payWorkerReviewFirst").replace(
              "{projects}",
              (result.reviewProjects ?? []).join(", ") || profile.name,
            )
          : result.error?.includes("payroll_overlap")
            ? t("payroll.alreadyPaidDbBlock")
            : result.error ?? t("teamMember.payWorkerFailed"),
      );
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    const paidAmount = currencyFormatter.format(result.totalAmount ?? unpaidAmount);
    const paidHours =
      typeof result.totalHours === "number"
        ? `${result.totalHours.toFixed(2)}h`
        : formatDurationCompact(unpaidMinutes);
    setMessage(
      t("teamMember.payWorkerSuccess")
        .replace("{hours}", paidHours)
        .replace("{amount}", paidAmount),
    );
    setMessageType("success");
    setBusyKey(null);
    router.refresh();
  }

  async function handleResetToZero() {
    const minutesToZero = unpaidMinutes;
    if (minutesToZero <= 0) {
      setMessage(t("member.resetNothing"));
      setMessageType("info");
      setShowResetConfirm(false);
      return;
    }

    // Use the worker's currently-assigned project, or first active project,
    // or the first known project — adjustments need a project_id.
    const projectId =
      profile.current_project ??
      activeProjects[0]?.id ??
      projects[0]?.id ??
      null;

    if (!projectId) {
      setMessage("No project found to attach the reset adjustment to.");
      setMessageType("error");
      setShowResetConfirm(false);
      return;
    }

    setBusyKey("reset-zero");
    setMessage("");

    const reason = t("member.resetReason");
    const { error } = await supabase.from("time_events").insert({
      org_id: orgId,
      profile_id: profile.id,
      project_id: projectId,
      event_type: "adjust" as const,
      event_time: new Date().toISOString(),
      gps_point: null,
      gps_accuracy_m: null,
      gps_source: null,
      video_status: "not_required" as const,
      metadata: {
        adjustedBy: managerId,
        adjustMinutes: -minutesToZero,
        reason,
        showToWorker: true,
        kind: "reset_to_zero",
      },
    });

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      setShowResetConfirm(false);
      return;
    }

    setBusyKey(null);
    setShowResetConfirm(false);
    setMessage(t("member.resetSuccess"));
    setMessageType("success");
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "worker_hours_manual_close",
      targetType: "profile",
      targetId: profile.id,
      beforeData: {
        worker_name: profile.name,
        unpaid_minutes: minutesToZero,
        before_unpaid_minutes: minutesToZero,
        before_unpaid_hours: Number((minutesToZero / 60).toFixed(2)),
      },
      afterData: {
        worker_name: profile.name,
        project_id: projectId,
        adjust_minutes: -minutesToZero,
        after_unpaid_minutes: 0,
        after_unpaid_hours: 0,
        reason,
        kind: "reset_to_zero",
        changed_by: managerName,
        changed_by_role: managerRole,
      },
    });
    router.refresh();
  }

  async function handleAdjustHours(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const hours = Number.parseFloat(formData.get("hours")?.toString() ?? "0");
    const projectId = formData.get("project_id")?.toString() ?? "";
    const reason = formData.get("reason")?.toString().trim() ?? "";
    const showToWorker = formData.get("show_to_worker") === "on";

    if (!hours || !Number.isFinite(hours) || hours <= 0) return;
    if (!projectId) return;
    if (!reason) return;

    const signedMinutes = adjustSign === "+" ? Math.round(hours * 60) : -Math.round(hours * 60);
    const beforeUnpaidMinutes = hourBuckets.unpaidMinutes;
    const afterUnpaidMinutes = beforeUnpaidMinutes + signedMinutes;

    setBusyKey("adjust");
    setMessage("");

    const { error } = await supabase.from("time_events").insert({
      org_id: orgId,
      profile_id: profile.id,
      project_id: projectId,
      event_type: "adjust" as const,
      event_time: new Date().toISOString(),
      gps_point: null,
      gps_accuracy_m: null,
      gps_source: null,
      video_status: "not_required" as const,
      metadata: {
        adjustedBy: managerId,
        adjustMinutes: signedMinutes,
        reason,
        showToWorker,
      },
    });

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    form.reset();
    setBusyKey(null);
    setShowAdjustForm(false);
    setMessage(t("member.adjustmentApplied"));
    setMessageType("success");
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "worker_hours_adjusted",
      targetType: "profile",
      targetId: profile.id,
      beforeData: {
        worker_name: profile.name,
        before_unpaid_minutes: beforeUnpaidMinutes,
        before_unpaid_hours: Number((beforeUnpaidMinutes / 60).toFixed(2)),
      },
      afterData: {
        worker_name: profile.name,
        project_id: projectId,
        adjust_minutes: signedMinutes,
        after_unpaid_minutes: afterUnpaidMinutes,
        after_unpaid_hours: Number((afterUnpaidMinutes / 60).toFixed(2)),
        reason,
        show_to_worker: showToWorker,
        changed_by: managerName,
        changed_by_role: managerRole,
      },
    });
    router.refresh();
  }

  if (isOwnerAdminProfile) {
    return (
      <div className="team-member-profile-screen mx-auto max-w-[1200px] space-y-5 p-5">
        <section className="space-y-2">
          <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("teamMember.backToTeam")}
          </Link>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">{profile.name}</h1>
          <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
            {t("teamMember.ownerAdminDescription")}
          </p>
        </section>

        {message ? (
          <div
            className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
            style={{
              background: messageType === "error"
                ? "rgba(212, 81, 94, 0.12)"
                : messageType === "success"
                  ? "rgba(15, 168, 120, 0.16)"
                  : "rgba(191, 162, 52, 0.12)",
              color: messageType === "error"
                ? "var(--red)"
                : messageType === "success"
                  ? "var(--green)"
                  : "var(--brand-yellow)",
            }}
          >
            {message}
          </div>
        ) : null}

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.profileSettings")}</h2>
              <form className="mt-4 grid gap-3" onSubmit={handleUpdateProfile}>
                <TextInputWithVoice
                  name="name"
                  defaultValue={profile.name}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <select
                    name="role"
                    defaultValue={profile.role}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  >
                    {editableRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {t(`roles.${role}` as TranslationKey)}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                    <input
                      key={`is-active-${profile.id}-${profile.is_active ? "yes" : "no"}`}
                      type="checkbox"
                      name="is_active"
                      defaultChecked={profile.is_active}
                    />
                    {t("teamMember.allowPinAccess")}
                  </label>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[rgba(191,162,52,0.24)] bg-[rgba(191,162,52,0.08)] px-3 py-3 text-xs leading-5 text-[var(--text-secondary)]">
                  {t("teamMember.ownerAdminAccessHint")}
                </div>
                <div className="grid gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("teamMember.skillsLabel")}
                  </label>
                  <TextInputWithVoice
                    name="worker_skills_text"
                    defaultValue={formatProfileSkillInput(profile.settings)}
                    placeholder={t("teamMember.skillsPlaceholder")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("teamMember.capabilitiesNoteLabel")}
                  </label>
                  <TextInputWithVoice
                    multiline
                    rows={3}
                    name="worker_capabilities_note"
                    defaultValue={profileSkillSettings.note}
                    placeholder={t("teamMember.capabilitiesNotePlaceholder")}
                    className="min-h-[90px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    {t("teamMember.skillsHelp")}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={busyKey === "profile"}
                  className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
                  style={{
                    background: busyKey === "profile" ? "var(--border-default)" : "var(--brand-yellow)",
                    color: busyKey === "profile" ? "var(--text-muted)" : "var(--text-inverse)",
                  }}
                >
                  {busyKey === "profile" ? t("common.saving") : t("teamMember.saveProfile")}
                </button>
              </form>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-default)] pt-4">
                <button
                  type="button"
                  onClick={() => void handleResetPin()}
                  disabled={busyKey === "reset-pin"}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "var(--brand-yellow)", color: "var(--brand-yellow)" }}
                >
                  {busyKey === "reset-pin" ? t("teamMember.resetting") : t("teamMember.resetPin")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleActive()}
                  disabled={busyKey === "toggle-active"}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{
                    borderColor: profile.is_active ? "rgba(212, 81, 94, 0.3)" : "rgba(15, 168, 120, 0.3)",
                    color: profile.is_active ? "var(--red)" : "var(--green)",
                  }}
                >
                  {profile.is_active ? t("teamMember.deactivate") : t("team.reactivate")}
                </button>
              </div>

              {resetPinResult ? (
                <div
                  className="mt-3 rounded-[var(--radius-md)] px-3 py-3 text-sm font-semibold"
                  style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                >
                  New PIN: {resetPinResult} — {t("teamMember.newPinShare")}
                </div>
              ) : null}
            </div>

            <div className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("teamMember.ownerAdminRoleCard")}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("team.roleLabel")}
                  </div>
                  <div className="mt-1 text-sm font-bold uppercase text-[var(--brand-yellow)]">
                    {profile.role}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("team.financeAccess")}
                  </div>
                  <div className="mt-1 text-sm font-bold" style={{ color: profile.financeAccess ? "var(--green)" : "var(--text-muted)" }}>
                    {profile.financeAccess ? t("team.financeAlways") : t("sidebar.limitedAccess")}
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
                {t("teamMember.ownerAdminNoWorkerStats")}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("teamMember.ownerProjectControl")}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("teamMember.ownerProjectControlHint")}
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("projects.activeProjects")}
                  </div>
                  <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {activeProjects.filter((project) => project.status === "active").length}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("common.tasks")}
                  </div>
                  <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                    {projects.reduce((sum, project) => sum + project.openTaskCount, 0)}
                  </div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("teamMember.projectAccess")}
                  </div>
                  <div className="mt-1 text-xl font-bold text-[var(--green)]">
                    {t("teamMember.ownerAllProjects")}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {ownerProjectRows.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                    {t("teamMember.noActiveProjects")}
                  </div>
                ) : (
                  ownerProjectRows.map((project) => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2.5 hover:border-[var(--brand-yellow)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                          {project.name}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                          {project.address ?? t("common.noAddress")}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--brand-yellow)]">
                        {project.openTaskCount} {t("common.tasks").toLowerCase()}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Link
                href="/projects"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-3 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand-yellow)]"
              >
                {t("common.openProjects")}
              </Link>
              {hasFinanceAccess ? (
                <Link
                  href="/payroll"
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-3 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand-yellow)]"
                >
                  {t("manager.navPayroll")}
                </Link>
              ) : null}
              <Link
                href="/admin/settings"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-3 text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--brand-yellow)]"
              >
                {t("admin.settings.title")}
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="team-member-profile-screen mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
          {t("teamMember.backToTeam")}
        </Link>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">{profile.name}</h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("teamMember.description")}
        </p>
      </section>

      {currentShiftReview && currentShiftReview.status !== "normal" ? (
        (() => {
          const reviewLabelMap: Record<ShiftReviewStatus, string> = {
            normal: t("shiftReview.normal"),
            long_shift: t("shiftReview.longShift"),
            gps_stale: t("shiftReview.gpsStale"),
            gps_lost: t("shiftReview.gpsLost"),
            no_gps: t("shiftReview.noGps"),
            needs_review: t("shiftReview.needsReview"),
            video_missing: t("shiftReview.videoMissing"),
          };
          return (
            <section
              className="rounded-[var(--radius-md)] border px-3 py-3 text-sm"
              style={{
                borderColor: SHIFT_REVIEW_COLOR[currentShiftReview.status],
                background: "rgba(212, 81, 94, 0.06)",
              }}
            >
              <div
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: SHIFT_REVIEW_COLOR[currentShiftReview.status] }}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: SHIFT_REVIEW_COLOR[currentShiftReview.status] }}
                />
                {reviewLabelMap[currentShiftReview.status]}
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("shiftReview.tooltipReasons").replace(
                  "{list}",
                  currentShiftReview.reasons.map((r) => reviewLabelMap[r]).join(", "),
                )}
              </div>
            </section>
          );
        })()
      ) : null}

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background: messageType === "error"
              ? "rgba(212, 81, 94, 0.12)"
              : messageType === "success"
                ? "rgba(15, 168, 120, 0.16)"
                : "rgba(191, 162, 52, 0.12)",
            color: messageType === "error"
              ? "var(--red)"
              : messageType === "success"
                ? "var(--green)"
                : "var(--brand-yellow)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-4">
        <div className="surface-card p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.profileSettings")}</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleUpdateProfile}>
            <TextInputWithVoice
              name="name"
              defaultValue={profile.name}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                name="role"
                defaultValue={profile.role}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                {editableRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {t(`roles.${role}` as TranslationKey)}
                  </option>
                ))}
              </select>
              {hasFinanceAccess ? (
                <input
                  name="hourly_rate"
                  type="number"
                  step="0.01"
                  defaultValue={profile.hourly_rate ?? ""}
                  placeholder={t("projects.hourlyRate")}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input
                  key={`require-video-${profile.id}-${profile.require_video ? "yes" : "no"}`}
                  type="checkbox"
                  name="require_video"
                  defaultChecked={profile.require_video}
                />
                {t("teamMember.requireCheckoutVideo")}
              </label>
              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input
                  key={`is-active-${profile.id}-${profile.is_active ? "yes" : "no"}`}
                  type="checkbox"
                  name="is_active"
                  defaultChecked={profile.is_active}
                />
                {t("teamMember.allowPinAccess")}
              </label>
            </div>
            <div className="grid gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t("teamMember.skillsLabel")}
              </label>
              <TextInputWithVoice
                name="worker_skills_text"
                defaultValue={formatProfileSkillInput(profile.settings)}
                placeholder={t("teamMember.skillsPlaceholder")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="grid gap-2">
              <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t("teamMember.capabilitiesNoteLabel")}
              </label>
              <TextInputWithVoice
                multiline
                rows={3}
                name="worker_capabilities_note"
                defaultValue={profileSkillSettings.note}
                placeholder={t("teamMember.capabilitiesNotePlaceholder")}
                className="min-h-[90px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <p className="text-xs leading-5 text-[var(--text-muted)]">
                {t("teamMember.skillsHelp")}
              </p>
            </div>
            <button
              type="submit"
              disabled={busyKey === "profile"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: busyKey === "profile" ? "var(--border-default)" : "var(--brand-yellow)",
                color: busyKey === "profile" ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busyKey === "profile" ? t("common.saving") : t("teamMember.saveProfile")}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border-default)] pt-4">
            <button
              type="button"
              onClick={() => void handleResetPin()}
              disabled={busyKey === "reset-pin"}
              className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--brand-yellow)", color: "var(--brand-yellow)" }}
            >
              {busyKey === "reset-pin" ? t("teamMember.resetting") : t("teamMember.resetPin")}
            </button>
            <button
              type="button"
              onClick={() => void handleToggleActive()}
              disabled={busyKey === "toggle-active"}
              className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
              style={{
                borderColor: profile.is_active ? "rgba(212, 81, 94, 0.3)" : "rgba(15, 168, 120, 0.3)",
                color: profile.is_active ? "var(--red)" : "var(--green)",
              }}
            >
              {profile.is_active ? t("teamMember.deactivate") : t("team.reactivate")}
            </button>
          </div>

          {resetPinResult ? (
            <div
              className="mt-3 rounded-[var(--radius-md)] px-3 py-3 text-sm font-semibold"
              style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
            >
              New PIN: {resetPinResult} — {t("teamMember.newPinShare")}
            </div>
          ) : null}
        </div>

        <section id="message" className="surface-card p-4">
          <h2 className="mb-4 text-lg font-bold text-[var(--text-primary)]">{t("messages.send")}</h2>
          <SendMessageForm
            orgId={orgId}
            senderId={managerId}
            senderName={managerName}
            senderRole={managerRole}
            recipientId={profile.id}
            recipientName={profile.name}
            projects={activeProjects.map((project) => ({
              id: project.id,
              name: project.name,
              status: project.status,
            }))}
            onSent={() => router.refresh()}
          />
        </section>

        {/* ── Operational summary ──
            Fills the empty space below profile settings on wide screens.
            Compact, click-through views of the worker's current load.
            Detailed expanded sections still live further down the page. */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("teamMember.operationalSummary")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("teamMember.operationalSummaryHint")}
          </p>

          {/* Latest 5 closed shifts. Severity badge mirrors shift-review:
              red ≥ 24h, amber 16h–24h, otherwise nothing. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("teamMember.recentShifts")}
            </div>
            <div className="mt-2 space-y-1.5">
              {sessionRows.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  {t("teamMember.noShifts")}
                </div>
              ) : (
                sessionRows.slice(0, 5).map((session) => {
                  const isExtreme = session.durationMinutes >= EXTREME_SHIFT_MINUTES;
                  const isLong = session.durationMinutes >= LONG_SHIFT_MINUTES;
                  const missingVideo = session.checkoutStatus === "pending";
                  const noGps = !(hasGpsBySessionId[session.id] ?? false);
                  return (
                    <div
                      key={`summary-${session.id}`}
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5"
                      style={{
                        borderColor: isExtreme
                          ? "rgba(212, 81, 94, 0.45)"
                          : isLong
                            ? "rgba(245, 158, 11, 0.35)"
                            : "var(--border-default)",
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {session.projectName}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {formatEventTime(session.clockInTime)}
                          {session.clockOutTime
                            ? ` → ${formatEventTime(session.clockOutTime)}`
                            : ` · ${t("common.live").toLowerCase()}`}
                          {noGps ? ` · ${t("shiftReview.noGps")}` : ""}
                          {missingVideo ? ` · ${t("shiftReview.videoMissing")}` : ""}
                        </div>
                      </div>
                      <span
                        className="shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                        style={
                          isExtreme
                            ? { background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }
                            : isLong
                              ? { background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }
                              : { background: "rgba(148, 163, 184, 0.10)", color: "var(--text-muted)" }
                        }
                      >
                        {formatDurationCompact(session.durationMinutes)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Open tasks — assigned to this worker. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("teamMember.assignedTasks")}
            </div>
            <div className="mt-2 space-y-1.5">
              {(() => {
                const openTasks = tasks.filter(isEffectiveOpenTask).slice(0, 5);
                if (openTasks.length === 0) {
                  return (
                    <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      {t("teamMember.noTasks")}
                    </div>
                  );
                }
                return openTasks.map((task) => {
                  const project = task.project_id
                    ? projects.find((p) => p.id === task.project_id)
                    : null;
                  return (
                    <div
                      key={`summary-task-${task.id}`}
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                          {task.title}
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {project?.name ?? t("common.generalTask")} · {getEffectiveTaskStatus(task)}
                        </div>
                      </div>
                      <span
                        className="shrink-0 whitespace-nowrap rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                        style={{
                          background:
                            task.priority === "urgent" || task.priority === "high"
                              ? "rgba(239, 68, 68, 0.14)"
                              : task.priority === "medium"
                                ? "rgba(245, 158, 11, 0.14)"
                                : "rgba(34, 197, 94, 0.14)",
                          color:
                            task.priority === "urgent" || task.priority === "high"
                              ? "#ef4444"
                              : task.priority === "medium"
                                ? "#f59e0b"
                                : "#22c55e",
                        }}
                      >
                        {task.priority}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Recent uploads — quick visual confirmation of the worker's
              activity without scrolling to the full Journal section. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("teamMember.recentMaterials")}
            </div>
            <div className="mt-2 space-y-1.5">
              {media.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  {t("teamMember.noJournal")}
                </div>
              ) : (
                media.slice(0, 5).map((entry) => (
                  <div
                    key={`summary-media-${entry.id}`}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-2.5 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => void openMediaItem(entry)}
                        className="block w-full truncate text-left text-xs font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline focus:underline"
                      >
                        {entry.filename ?? entry.media_type}
                      </button>
                      <div className="text-[10px] text-[var(--text-muted)]">
                        {entry.projectName ?? t("common.general")} · {formatEventTime(entry.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void openMediaItem(entry)}
                        className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          borderColor: "rgba(191, 162, 52, 0.4)",
                          color: "var(--brand-yellow)",
                        }}
                        title={t("messages.openFile")}
                      >
                        ↗
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadMediaItem(entry)}
                        className="rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          borderColor: "var(--border-default)",
                          color: "var(--text-primary)",
                        }}
                        title={t("messages.downloadFile")}
                      >
                        ⬇
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Compact "journal" — last few activity facts. Sourced from
              the same shift / media data already on the page; nothing
              here writes back to the audit log. */}
          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("teamMember.activityJournal")}
            </div>
            <div className="mt-2 space-y-1">
              {(() => {
                type ActivityRow = {
                  key: string;
                  ts: string;
                  text: string;
                };
                const rows: ActivityRow[] = [];
                for (const session of sessions) {
                  rows.push({
                    key: `act-in-${session.id}`,
                    ts: session.clockInTime,
                    text: `${t("feed.clockIn")} · ${session.projectName}`,
                  });
                  if (session.clockOutTime) {
                    rows.push({
                      key: `act-out-${session.id}`,
                      ts: session.clockOutTime,
                      text: `${t("feed.clockOut")} · ${session.projectName}`,
                    });
                  }
                }
                for (const m of media) {
                  rows.push({
                    key: `act-media-${m.id}`,
                    ts: m.created_at,
                    text: `${t("feed.mediaUploaded")} · ${m.filename ?? m.media_type}`,
                  });
                }
                rows.sort(
                  (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
                );
                const top = rows.slice(0, 6);
                if (top.length === 0) {
                  return (
                    <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      {t("teamMember.noJournal")}
                    </div>
                  );
                }
                return top.map((row) => (
                  <div
                    key={row.key}
                    className="flex items-baseline gap-2 px-2.5 py-1 text-xs"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-[var(--text-muted)]">
                      {formatEventTime(row.ts)}
                    </span>
                    <span className="truncate text-[var(--text-secondary)]">{row.text}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <div className={`grid gap-3 ${hasFinanceAccess ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.week")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.currentWeekMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.tasks")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">{profile.openTaskCount}</div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.live")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                  {profile.currentSessionMinutes === null
                    ? t("common.off")
                    : formatDurationCompact(profile.currentSessionMinutes)}
                </div>
              </div>
              {hasFinanceAccess ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.rate")}</div>
                  <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                    ${Number(profile.hourly_rate ?? 0).toFixed(2)}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("teamMember.gpsHours")}</div>
                <div className="mt-1 text-sm font-bold" style={{ color: "var(--green)" }}>
                  {formatDurationCompact(weekGpsMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("teamMember.noGpsHours")}</div>
                <div className="mt-1 text-sm font-bold" style={{ color: weekNoGpsMinutes > 0 ? "#f59e0b" : "var(--text-muted)" }}>
                  {formatDurationCompact(weekNoGpsMinutes)}
                </div>
              </div>
            </div>
            {dailyTotals.length > 0 ? (
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.dailyTotals")}
                </div>
                <div className="mt-2 space-y-1">
                  {dailyTotals.map((day) => (
                    <div key={day.date} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-[var(--text-secondary)]">{day.date}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[var(--text-primary)]">
                          {formatDurationCompact(day.minutes)}
                        </span>
                        {day.otLevel !== "ok" ? (
                          <span
                            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                            style={{
                              background:
                                day.otLevel === "critical"
                                  ? "rgba(239, 68, 68, 0.15)"
                                  : "rgba(245, 158, 11, 0.15)",
                              color: day.otLevel === "critical" ? "#ef4444" : "#f59e0b",
                            }}
                          >
                            {day.otLevel === "critical"
                              ? t("teamMember.overtime13h")
                              : t("teamMember.overtime11h")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-4 text-sm text-[var(--text-secondary)]">
              {profile.currentProjectName ?? t("teamMember.noCurrentProject")}
            </div>
          </div>

          {/* ── Hour summary buckets ──
              Surfaces today / yesterday / current week / previous week /
              current month, plus the paid-or-closed bucket the
              "reset_to_zero" adjustment writes into. Without this card,
              a worker like Vasya whose period was closed shows a 0m
              "current week" with no explanation. */}
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("teamMember.hourSummary")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("teamMember.hourSummaryHint")}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketToday")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.todayMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketYesterday")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.yesterdayMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketCurrentWeek")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.currentWeekMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketLastTwoWeeks")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.lastTwoWeeksMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketPreviousWeek")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.previousWeekMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketCurrentMonth")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.currentMonthMinutes)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("teamMember.bucketTotalWorked")}
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(hourBuckets.totalWorkedMinutes)}
                </div>
              </div>
            </div>
            {hasFinanceAccess ? (
              <>
                <Link
                  href="/payroll/history"
                  className="mt-3 flex items-start justify-between gap-3 rounded-[var(--radius-md)] border p-3 transition-colors hover:border-[var(--green)]"
                  style={{
                    background: "rgba(15, 168, 120, 0.10)",
                    borderColor: "rgba(15, 168, 120, 0.28)",
                    color: "var(--green)",
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-[10px] font-semibold uppercase tracking-[0.16em]">
                      {t("teamMember.payrollHistoryShortcut")}
                    </span>
                    <span className="mt-1 block text-sm font-bold text-[var(--text-primary)]">
                      {t("teamMember.openPayrollHistory")}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                      {t("teamMember.payrollHistoryShortcutHint")}
                    </span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold">
                      {latestPaidPeriodLabel ?? t("teamMember.noOpenBalance")}
                      {latestPaidAmountLabel ? ` · ${latestPaidAmountLabel}` : ""}
                    </span>
                  </span>
                  <ArrowRight size={16} className="mt-1 shrink-0" />
                </Link>

                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-[var(--text-primary)]">
                        {t("teamMember.currentPayPeriod")}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                        {t("teamMember.currentPayPeriodHint")}
                      </p>
                    </div>
                    <div className="rounded-[var(--radius-sm)] border px-3 py-2 text-right" style={{ borderColor: "rgba(191, 162, 52, 0.24)" }}>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand-yellow)" }}>
                        {t("teamMember.bucketUnpaid")}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                        {currencyFormatter.format(unpaidAmount)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div
                    className="rounded-[var(--radius-md)] p-3"
                    style={{ background: "rgba(15, 168, 120, 0.10)" }}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--green)" }}>
                      {t("teamMember.bucketPaidClosed")}
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold" style={{ color: "var(--green)" }}>
                      {formatDurationCompact(hourBuckets.paidOrClosedMinutes)}
                    </div>
                    {latestPaidAmountLabel || latestPaidHoursLabel ? (
                      <div className="mt-1 text-[10px] font-semibold text-[var(--text-primary)]">
                        {[latestPaidHoursLabel, latestPaidAmountLabel].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                    {latestPaidPeriodLabel ? (
                      <div className="mt-2 text-[10px] leading-snug text-[var(--text-secondary)]">
                        {t("teamMember.lastPaidPeriod")}: {latestPaidPeriodLabel}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUnpaidBreakdown((open) => !open)}
                    className="rounded-[var(--radius-md)] p-3 text-left transition-colors hover:border-[var(--brand-yellow)]"
                    style={{
                      background: "rgba(191, 162, 52, 0.10)",
                      border: "1px solid rgba(191, 162, 52, 0.24)",
                    }}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--brand-yellow)" }}>
                      {t("teamMember.bucketUnpaid")}
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold" style={{ color: "var(--brand-yellow)" }}>
                      {formatDurationCompact(hourBuckets.unpaidMinutes)}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-[var(--text-primary)]">
                      {t("teamMember.unpaidAmount")}: {currencyFormatter.format(unpaidAmount)}
                    </div>
                    <div className="mt-2 text-[10px] font-semibold text-[var(--text-secondary)]">
                      {showUnpaidBreakdown
                        ? t("teamMember.hideUnpaidBreakdown")
                        : t("teamMember.showUnpaidBreakdown")}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowUnpaidBreakdown((open) => !open)}
                    className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-left transition-colors hover:border-[var(--brand-yellow)]"
                    style={{ border: "1px solid var(--border-default)" }}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("teamMember.bucketAdjustments")}
                    </div>
                    <div
                      className="mt-1 font-mono text-sm font-bold"
                      style={{
                        color:
                          hourBuckets.adjustmentsTotalMinutes < 0
                            ? "var(--red)"
                            : hourBuckets.adjustmentsTotalMinutes > 0
                              ? "var(--green)"
                              : "var(--text-primary)",
                      }}
                    >
                      {hourBuckets.adjustmentsTotalMinutes >= 0 ? "+" : "−"}
                      {formatDurationCompact(Math.abs(hourBuckets.adjustmentsTotalMinutes))}
                    </div>
                    {adjustmentRows.length > 0 ? (
                      <div className="mt-2 text-[10px] text-[var(--text-secondary)]">
                        {adjustmentRows.length} {t("hours.entries")}
                      </div>
                    ) : null}
                  </button>
                  {unpaidMinutes > 0 ? (
                    <button
                      type="button"
                      onClick={() => void handlePayWorkerNow()}
                      disabled={busyKey === "pay-worker"}
                      className="flex rounded-[var(--radius-md)] p-3 text-left transition-colors hover:border-[var(--brand-yellow)] disabled:cursor-not-allowed disabled:opacity-70"
                      style={{
                        background: "rgba(191, 162, 52, 0.16)",
                        border: "1px solid rgba(191, 162, 52, 0.3)",
                        color: "var(--brand-yellow)",
                      }}
                    >
                      <span className="flex w-full flex-col">
                        <span className="text-[10px] uppercase tracking-[0.16em]">
                          {t("teamMember.payOff")}
                        </span>
                        <span className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                          {busyKey === "pay-worker"
                            ? t("common.saving")
                            : t("teamMember.payWorkerNow")}
                        </span>
                        <span className="mt-2 text-[10px] font-semibold text-[var(--text-primary)]">
                          {formatDurationCompact(unpaidMinutes)} = {currencyFormatter.format(unpaidAmount)}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div
                      className="flex rounded-[var(--radius-md)] p-3"
                      style={{
                        background: "rgba(15, 168, 120, 0.10)",
                        border: "1px solid rgba(15, 168, 120, 0.28)",
                        color: "var(--green)",
                      }}
                    >
                      <span className="flex w-full flex-col">
                        <span className="text-[10px] uppercase tracking-[0.16em]">
                          {t("teamMember.payrollClosed")}
                        </span>
                        <span className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                          {t("teamMember.noOpenBalance")}
                        </span>
                        <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold">
                          {latestPaidPeriodLabel ?? t("teamMember.noOpenBalance")}
                          {latestPaidAmountLabel ? ` · ${latestPaidAmountLabel}` : ""}
                        </span>
                      </span>
                    </div>
                  )}
                </div>

                {showUnpaidBreakdown ? (
                  <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">
                          {t("teamMember.unpaidBreakdownTitle")}
                        </div>
                        <p className="mt-1 text-xs text-[var(--text-secondary)]">
                          {t("teamMember.unpaidBreakdownHint")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (unpaidMinutes > 0) void handlePayWorkerNow();
                          else router.push("/payroll/history");
                        }}
                        disabled={busyKey === "pay-worker"}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-70"
                        style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                      >
                        {unpaidMinutes > 0
                          ? `${t("teamMember.payOff")} · ${currencyFormatter.format(unpaidAmount)}`
                          : t("teamMember.openPayrollHistory")}
                        <ArrowRight size={13} />
                      </button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.03)] p-2">
                        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {t("teamMember.breakdownClosedShifts")}
                        </div>
                        <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                          {formatDurationCompact(sessionMinutes)}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[rgba(15,168,120,0.10)] p-2">
                        <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--green)" }}>
                          {t("teamMember.breakdownPaidAdjustments")}
                        </div>
                        <div className="mt-1 font-mono text-sm font-bold" style={{ color: "var(--green)" }}>
                          {formatDurationCompact(hourBuckets.paidOrClosedMinutes)}
                        </div>
                      </div>
                      <div className="rounded-[var(--radius-sm)] bg-[rgba(191,162,52,0.10)] p-2">
                        <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--brand-yellow)" }}>
                          {t("teamMember.breakdownOpenBalance")}
                        </div>
                        <div className="mt-1 font-mono text-sm font-bold" style={{ color: "var(--brand-yellow)" }}>
                          {formatDurationCompact(hourBuckets.unpaidMinutes)}
                        </div>
                      </div>
                    </div>

                    {paidClosedAdjustmentRows.length > 0 ? (
                      <div className="mt-4">
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          {t("teamMember.breakdownPaidAdjustments")}
                        </div>
                        <div className="grid gap-1.5 md:grid-cols-2">
                          {paidClosedAdjustmentRows.map((adjustment) => {
                            const positive = adjustment.minutes >= 0;
                            return (
                              <div
                                key={`paid-closed-${adjustment.id}`}
                                className="rounded-[var(--radius-sm)] border px-3 py-2"
                                style={{
                                  borderColor: "rgba(15,168,120,0.20)",
                                  background: "rgba(15,168,120,0.06)",
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                      {adjustment.projectName ?? t("common.general")}
                                    </div>
                                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                      {formatDateTime(adjustment.eventTime)}
                                    </div>
                                    {adjustment.reason ? (
                                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                        {adjustment.reason}
                                      </div>
                                    ) : null}
                                  </div>
                                  <span
                                    className="shrink-0 whitespace-nowrap font-mono text-xs font-bold"
                                    style={{ color: positive ? "var(--green)" : "var(--red)" }}
                                  >
                                    {positive ? "+" : "−"}
                                    {formatDurationCompact(Math.abs(adjustment.minutes))}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 xl:grid-cols-2">
                      <div>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          {t("teamMember.breakdownShiftRows")}
                        </div>
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                          {sessionRows.length === 0 ? (
                            <div className="rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                              {t("teamMember.noShifts")}
                            </div>
                          ) : (
                            sessionRows.map((session) => (
                              <button
                                key={`breakdown-${session.id}`}
                                type="button"
                                onClick={() => setDayDetailDate(session.clockInTime.slice(0, 10))}
                                className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-left hover:border-[var(--brand-yellow)]"
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">
                                    {session.projectName}
                                  </span>
                                  <span className="block text-[10px] text-[var(--text-muted)]">
                                    {formatDateTime(session.clockInTime)}
                                    {session.clockOutTime
                                      ? ` - ${formatDateTime(session.clockOutTime)}`
                                      : ` - ${t("common.live").toLowerCase()}`}
                                  </span>
                                </span>
                                <span className="shrink-0 font-mono text-xs font-bold text-[var(--text-primary)]">
                                  {formatDurationCompact(session.durationMinutes)}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                          {t("teamMember.breakdownAdjustmentRows")}
                        </div>
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                          {adjustmentRows.length === 0 ? (
                            <div className="rounded-[var(--radius-sm)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                              {t("teamMember.noAdjustments")}
                            </div>
                          ) : (
                            adjustmentRows.map((adjustment) => {
                              const positive = adjustment.minutes >= 0;
                              const paidClosed = isPaidOrClosedAdjustment(adjustment);
                              return (
                                <div
                                  key={adjustment.id}
                                  className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                        {adjustment.projectName ?? t("common.general")}
                                      </div>
                                      <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                        {formatDateTime(adjustment.eventTime)}
                                        {paidClosed ? ` - ${t("teamMember.bucketPaidClosed")}` : ""}
                                      </div>
                                      {adjustment.reason ? (
                                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                                          {adjustment.reason}
                                        </div>
                                      ) : null}
                                    </div>
                                    <span
                                      className="shrink-0 whitespace-nowrap font-mono text-xs font-bold"
                                      style={{ color: positive ? "var(--green)" : "var(--red)" }}
                                    >
                                      {positive ? "+" : "−"}
                                      {formatDurationCompact(Math.abs(adjustment.minutes))}
                                    </span>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.projectAccess")}</h2>
              <div className="text-xs text-[var(--text-muted)]">
                {accessMode === "all_active"
                  ? `${activeProjects.filter((p) => !excludedSet.has(p.id)).length} ${t("common.assigned").toLowerCase()}`
                  : `${assignments.length} ${t("common.assigned").toLowerCase()}`}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => void handleSetAccessMode("list")}
                disabled={busyKey === "access-mode"}
                className="flex w-full items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left"
                style={{
                  borderColor:
                    accessMode === "list" ? "var(--brand-yellow)" : "var(--border-default)",
                  background:
                    accessMode === "list" ? "rgba(191, 162, 52, 0.08)" : "transparent",
                }}
                aria-pressed={accessMode === "list"}
              >
                <span
                  className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2"
                  style={{
                    borderColor:
                      accessMode === "list" ? "var(--brand-yellow)" : "var(--text-muted)",
                    background:
                      accessMode === "list" ? "var(--brand-yellow)" : "transparent",
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    {t("teamMember.accessModeListLabel")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                    {t("teamMember.accessModeListHint")}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleSetAccessMode("all_active")}
                disabled={busyKey === "access-mode"}
                className="flex w-full items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left"
                style={{
                  borderColor:
                    accessMode === "all_active" ? "var(--brand-yellow)" : "var(--border-default)",
                  background:
                    accessMode === "all_active" ? "rgba(191, 162, 52, 0.08)" : "transparent",
                }}
                aria-pressed={accessMode === "all_active"}
              >
                <span
                  className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full border-2"
                  style={{
                    borderColor:
                      accessMode === "all_active" ? "var(--brand-yellow)" : "var(--text-muted)",
                    background:
                      accessMode === "all_active" ? "var(--brand-yellow)" : "transparent",
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    {t("teamMember.accessModeAllActiveLabel")}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">
                    {t("teamMember.accessModeAllActiveHint")}
                  </span>
                </span>
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {activeProjects.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {t("teamMember.noActiveProjects")}
                </div>
              ) : (
                activeProjects.map((project) => {
                  // In 'list' mode the toggle reflects project_assignments
                  // membership (ON = visible). In 'all_active' mode the toggle
                  // reflects "NOT in exclusions" (ON = visible). Either way
                  // the visual contract for the manager is "ON = worker can
                  // see this project".
                  const isVisible =
                    accessMode === "all_active"
                      ? !excludedSet.has(project.id)
                      : assignedProjectIds.has(project.id);
                  const isBusy = busyKey === `toggle-${project.id}`;

                  return (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/projects/${project.id}`}
                          className="text-sm font-semibold text-[var(--text-primary)]"
                        >
                          {project.name}
                        </Link>
                        {project.address ? (
                          <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                            {project.address}
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleToggleAssignment(project.id)}
                        disabled={isBusy}
                        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
                        style={{
                          background: isVisible
                            ? "var(--brand-yellow)"
                            : "var(--border-default)",
                        }}
                        aria-label={
                          isVisible
                            ? `Hide ${project.name} from this worker`
                            : `Show ${project.name} to this worker`
                        }
                      >
                        <span
                          className="absolute top-0.5 block h-5 w-5 rounded-full bg-white transition-transform"
                          style={{
                            transform: isVisible ? "translateX(22px)" : "translateX(2px)",
                          }}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Transfer gaps ── Project-to-project move alerts for this
          worker. detectTransferGaps already enforces severity thresholds
          (>30m warning, >90m critical) so we just render. */}
      {transferGaps.length > 0 ? (
        <section
          className="rounded-[var(--radius-lg)] border p-4"
          style={{
            background: "rgba(245, 158, 11, 0.06)",
            borderColor: "rgba(245, 158, 11, 0.25)",
          }}
        >
          <div className="flex items-center gap-2">
            <ArrowRight size={16} style={{ color: "#f59e0b" }} />
            <h2 className="text-lg font-bold" style={{ color: "#f59e0b" }}>
              {t("teamMember.transferGapsTitle")}
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t("teamMember.transferGapsHint")}
          </p>
          <div className="mt-4 space-y-2">
            {transferGaps.map((gap) => {
              const isCritical = gap.severity === "critical";
              const rowBg = isCritical
                ? "rgba(212, 81, 94, 0.10)"
                : "rgba(245, 158, 11, 0.08)";
              const pillBg = isCritical
                ? "rgba(212, 81, 94, 0.16)"
                : "rgba(245, 158, 11, 0.18)";
              const pillColor = TRANSFER_GAP_COLOR[gap.severity];
              return (
                <div
                  key={gap.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5"
                  style={{ background: rowBg }}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-sm">
                    <Link
                      href={`/projects/${gap.fromProjectId}`}
                      className="font-medium text-[var(--text-primary)]"
                    >
                      {gap.fromProject}
                    </Link>
                    <span className="text-[var(--text-secondary)]">→</span>
                    <Link
                      href={`/projects/${gap.toProjectId}`}
                      className="font-medium text-[var(--text-primary)]"
                    >
                      {gap.toProject}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">
                      {formatEventTime(gap.outTime)} - {formatEventTime(gap.inTime)}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.1em]"
                      style={{ background: pillBg, color: pillColor }}
                    >
                      {isCritical
                        ? t("overview.gapCriticalLabel")
                        : t("overview.gapWarningLabel")}
                    </span>
                    <span
                      className="whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold"
                      style={{ background: pillBg, color: pillColor }}
                    >
                      {formatDurationCompact(gap.gapMinutes)} {t("overview.gapDuration")}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ── Adjust Hours ── */}
      <section>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("member.adjustHours")}</h2>
            {!showAdjustForm ? (
              <button
                type="button"
                onClick={() => setShowAdjustForm(true)}
                className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--brand-yellow)", color: "var(--brand-yellow)" }}
              >
                {t("member.adjustHours")}
              </button>
            ) : null}
          </div>

          {showAdjustForm ? (
            <form className="mt-4 grid gap-3" onSubmit={handleAdjustHours}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustSign("+")}
                  className="flex-1 rounded-[var(--radius-md)] border px-3 py-3 text-sm font-semibold transition-colors"
                  style={{
                    borderColor: adjustSign === "+" ? "var(--green)" : "var(--border-default)",
                    background: adjustSign === "+" ? "rgba(15, 168, 120, 0.12)" : "var(--bg-primary)",
                    color: adjustSign === "+" ? "var(--green)" : "var(--text-secondary)",
                  }}
                >
                  + {t("member.addHours")}
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustSign("-")}
                  className="flex-1 rounded-[var(--radius-md)] border px-3 py-3 text-sm font-semibold transition-colors"
                  style={{
                    borderColor: adjustSign === "-" ? "var(--red)" : "var(--border-default)",
                    background: adjustSign === "-" ? "rgba(212, 81, 94, 0.12)" : "var(--bg-primary)",
                    color: adjustSign === "-" ? "var(--red)" : "var(--text-secondary)",
                  }}
                >
                  − {t("member.subtractHours")}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  name="hours"
                  type="number"
                  step="0.25"
                  min="0.25"
                  placeholder={t("member.hours")}
                  required
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <select
                  name="project_id"
                  required
                  defaultValue=""
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                >
                  <option value="" disabled>
                    {t("overview.colProject")}
                  </option>
                  {activeProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
              <TextInputWithVoice
                multiline
                name="reason"
                required
                placeholder={t("member.adjustReason")}
                className="min-h-[80px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <label className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  name="show_to_worker"
                  defaultChecked
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-yellow)]"
                />
                <span className="space-y-0.5">
                  <span className="block font-semibold">{t("member.showToWorker")}</span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t("member.showToWorkerHelp")}
                  </span>
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyKey === "adjust"}
                  className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
                  style={{
                    background: busyKey === "adjust" ? "var(--border-default)" : "var(--brand-yellow)",
                    color: busyKey === "adjust" ? "var(--text-muted)" : "var(--text-inverse)",
                  }}
                >
                  {busyKey === "adjust" ? t("member.applying") : t("member.applyAdjustment")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAdjustForm(false)}
                  className="rounded-[var(--radius-sm)] border px-4 py-3 text-sm font-semibold"
                  style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>

      {hasFinanceAccess ? (
        <section>
          <div className="surface-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {t("member.resetToZero")}
                </h2>
                <p className="mt-1 max-w-[60ch] text-sm text-[var(--text-secondary)]">
                  {t("member.resetToZeroDesc")}
                </p>
              </div>
              <span className="font-mono text-sm font-bold" style={{ color: "var(--brand-yellow)" }}>
                {unpaidHours.toFixed(2)}h
              </span>
            </div>
            {!showResetConfirm ? (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                disabled={unpaidMinutes <= 0 || busyKey === "reset-zero"}
                className="mt-4 rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold disabled:opacity-50"
                style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
              >
                {t("member.resetToZero")}
              </button>
            ) : (
              <div
                className="mt-4 rounded-[var(--radius-md)] border p-3"
                style={{ borderColor: "rgba(212, 81, 94, 0.3)", background: "rgba(212, 81, 94, 0.06)" }}
              >
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("member.resetConfirmHeadline").replace("{name}", profile.name)}
                </div>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {t("member.resetConfirmBody").replace("{hours}", unpaidHours.toFixed(2))}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleResetToZero()}
                    disabled={busyKey === "reset-zero"}
                    className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold"
                    style={{ background: "var(--red)", color: "white" }}
                  >
                    {busyKey === "reset-zero" ? t("common.saving") : t("member.resetConfirmCta")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    disabled={busyKey === "reset-zero"}
                    className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.recentShifts")}</h2>
            {closedProblemShifts.length > 0 ? (
              <span
                className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]"
                style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
              >
                {closedProblemShifts.length} {t("shiftReview.needsReview")}
              </span>
            ) : null}
          </div>
          {closedProblemShifts.length > 0 ? (
            <div
              className="mt-3 rounded-[var(--radius-md)] border px-3 py-2 text-xs text-[var(--text-secondary)]"
              style={{
                borderColor: "rgba(212, 81, 94, 0.24)",
                background: "rgba(212, 81, 94, 0.06)",
              }}
            >
              {t("teamMember.closedShiftWarning")}
            </div>
          ) : null}
          <div className="mt-4 space-y-3">
            {sessions.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noShifts")}
              </div>
            ) : (
              sessions.map((session) => {
                const dayKey = session.clockInTime.slice(0, 10);
                const hasGps = hasGpsBySessionId[session.id] ?? false;
                const isLong = session.durationMinutes >= LONG_SHIFT_MINUTES;
                const isExtreme = session.durationMinutes >= EXTREME_SHIFT_MINUTES;
                const missingVideo = session.checkoutStatus === "pending";
                // Extreme closed shifts (>= 24h) deserve a permanent red
                // border so a 144h forgotten-clock-out doesn't look like
                // a normal entry in the recent-shifts list.
                const rowBorder = isExtreme
                  ? "rgba(212, 81, 94, 0.45)"
                  : "var(--border-default)";
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setDayDetailDate(dayKey)}
                    className="block w-full rounded-[var(--radius-md)] border p-3 text-left transition-colors hover:border-[var(--brand-yellow)]"
                    style={{ borderColor: rowBorder }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{ background: hasGps ? "var(--green)" : "#f59e0b" }}
                            title={hasGps ? "GPS" : "No GPS"}
                          />
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {session.projectName}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {formatDateTime(session.clockInTime)}
                          {session.clockOutTime ? ` - ${formatDateTime(session.clockOutTime)}` : ` - ${t("common.live").toLowerCase()}`}
                        </div>
                        {isLong || missingVideo ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {isLong ? (
                              <span
                                className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                                style={
                                  isExtreme
                                    ? { background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }
                                    : { background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }
                                }
                              >
                                {isExtreme
                                  ? t("shiftReview.needsReview")
                                  : t("shiftReview.longShift")}
                              </span>
                            ) : null}
                            {missingVideo ? (
                              <span
                                className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                                style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
                              >
                                {t("shiftReview.videoMissing")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                        {formatDurationCompact(session.durationMinutes)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.assignedTasks")}</h2>
          <div className="mt-4 space-y-3">
            {tasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noTasks")}
              </div>
            ) : (
              tasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {task.project_id ? (
                          <Link href={`/projects/${task.project_id}`} className="text-[var(--brand-yellow)]">
                            {t("common.openProject")}
                          </Link>
                        ) : (
                          t("common.generalTask")
                        )}
                        {" • "}
                        {task.status}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--brand-yellow)]">
                      {task.priority}
                    </div>
                  </div>
                  {task.description ? (
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">{task.description}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center gap-2">
            <Store size={16} style={{ color: "#f97316" }} />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("teamMember.storeVisitsThisWeek")}
            </h2>
          </div>
          <div className="mt-4 space-y-2">
            {storeVisits.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noStoreVisits")}
              </div>
            ) : (
              storeVisits.map((visit) => {
                const minutes = Math.max(1, Math.round((visit.duration_seconds ?? 0) / 60));
                return (
                  <div
                    key={visit.id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {visit.store_chain || "Store"}
                        <span className="ml-1 font-normal text-[var(--text-secondary)]">
                          ({visit.store_name})
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {formatDateTime(visit.entered_at)}
                        {visit.source_project_name ? ` · ${visit.source_project_name}` : ""}
                      </div>
                    </div>
                    <span
                      className="shrink-0 whitespace-nowrap font-mono text-sm font-semibold"
                      style={{ color: "var(--brand-yellow)" }}
                    >
                      {minutes} {t("teamMember.storeVisitMin")}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Camera size={16} style={{ color: "var(--brand-yellow)" }} />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("teamMember.journalEntries")}
              </h2>
            </div>
            {media.length > 0 ? (
              <button
                type="button"
                onClick={() => setGalleryOpen(true)}
                className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{
                  borderColor: "rgba(191, 162, 52, 0.4)",
                  color: "var(--brand-yellow)",
                }}
              >
                {t("gallery.openGallery")}
              </button>
            ) : null}
          </div>
          <div className="mt-4 space-y-2">
            {media.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noJournal")}
              </div>
            ) : (
              mediaSections.map((section, sectionIndex) => (
                <details
                  key={section.key}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.28)] p-3"
                  open={sectionIndex === 0}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    <span>{section.label}</span>
                    <span className="rounded-[var(--radius-pill)] bg-[rgba(191,162,52,0.12)] px-2 py-0.5 text-[var(--brand-yellow)]">
                      {section.items.length}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2">
                  {section.items.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                    >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => void openMediaItem(entry)}
                        className="text-left text-sm font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline focus:underline"
                      >
                        {entry.filename ?? entry.media_type}
                      </button>
                      <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {entry.projectName ?? t("common.general")} · {formatDateTime(entry.created_at)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <MediaFlagButton
                        mediaId={entry.id}
                        hasOpenFlag={openFlagIds.has(entry.id)}
                        onClick={() => setFlagModalMediaId(entry.id)}
                      />
                      <span
                        className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                        style={
                          entry.is_checkout
                            ? { background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }
                            : { background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }
                        }
                      >
                        {entry.is_checkout ? t("journal.checkout") : entry.media_type}
                      </span>
                    </div>
                  </div>
                  {entry.caption ? (
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">{entry.caption}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void openMediaItem(entry)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                      style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
                    >
                      ↗ {t("messages.openFile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void downloadMediaItem(entry)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                      style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                    >
                      ⬇ {t("messages.downloadFile")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFlagModalMediaId(entry.id)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                      style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                    >
                      🚩 {t("flags.flagForReview")}
                    </button>
                  </div>
                  {entry.media_type === "video" ? (
                    (() => {
                      const playback = selectMediaPlayback(entry);
                      let statusLabel: string | null = null;
                      let statusColor = "var(--text-muted)";
                      if (playback.isPlaybackVersion) {
                        statusLabel = t("mediaPlayback.previewReady");
                        statusColor = "var(--green)";
                      } else if (playback.transcodingStatus === "pending") {
                        statusLabel = t("mediaPlayback.previewPending");
                        statusColor = "#f59e0b";
                      } else if (playback.transcodingStatus === "failed") {
                        statusLabel = t("mediaPlayback.previewFailed");
                        statusColor = "var(--red)";
                      }
                      return (
                        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 text-right">
                          {statusLabel ? (
                            <span
                              className="text-[10px] font-semibold"
                              style={{ color: statusColor }}
                            >
                              {statusLabel}
                            </span>
                          ) : null}
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {t("messages.videoMaybeUnsupported")}
                          </p>
                        </div>
                      );
                    })()
                  ) : null}
                    </div>
                  ))}
                  </div>
                </details>
              ))
            )}
          </div>
        </div>
      </section>

      <section>
        <div className="rounded-[var(--radius-lg)] border border-[rgba(212,81,94,0.3)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold" style={{ color: "var(--red)" }}>
            {t("teamMember.dangerZone")}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t("teamMember.dangerDesc")}
          </p>

          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="mt-4 rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold"
              style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
            >
              {t("teamMember.removeFromTeam")}
            </button>
          ) : (
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {t("teamMember.confirmRemove")} {profile.name}?
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("teamMember.confirmRemoveDesc")}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleDeleteWorker()}
                  disabled={busyKey === "delete"}
                  className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold"
                  style={{ background: "var(--red)", color: "white" }}
                >
                  {busyKey === "delete" ? t("teamMember.removing") : t("teamMember.yesRemove")}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold"
                  style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <DayDetailModal
        open={dayDetailDate !== null}
        date={dayDetailDate}
        sessions={sessions}
        tasks={tasks}
        media={media}
        adjustments={workerAdjustments}
        onClose={() => setDayDetailDate(null)}
      />

      <MediaFlagModal
        open={flagModalMediaId !== null}
        mediaId={flagModalMediaId}
        viewerRole="manager"
        viewerId={managerId}
        onClose={() => setFlagModalMediaId(null)}
        onMutate={() => void refreshOpenFlags()}
      />

      <MediaViewerModal
        item={mediaViewerItem}
        onClose={() => {
          const itemId = mediaViewerItem?.id;
          setMediaViewerItem(null);
          suppressMediaViewerItem(itemId);
        }}
      />

      <MediaGalleryDrawer
        open={galleryOpen}
        title={profile.name}
        items={galleryItems}
        projectOptions={galleryProjectOptions}
        onClose={() => setGalleryOpen(false)}
      />
    </div>
  );
}
