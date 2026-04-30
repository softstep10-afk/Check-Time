"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime, formatDurationCompact } from "@/lib/worker-utils";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
} from "@/lib/manager-types";
import type { Media, ProjectAssignment, Task, UserRole } from "@/types/database";
import type { StoreVisit } from "@/lib/store-types";
import { Camera, Store } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { SendMessageForm } from "@/components/manager/SendMessageForm";
import { DayDetailModal } from "@/components/manager/DayDetailModal";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import { normalizeStoragePath } from "@/lib/task-attachments";
import {
  SHIFT_REVIEW_COLOR,
  type ShiftReview,
  type ShiftReviewStatus,
} from "@/lib/shift-review";

const roleOptions: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "subcontractor",
  "manager",
  "admin",
];

type WorkerMediaRow = Media & { projectName: string | null };

type DailyTotal = {
  date: string;
  minutes: number;
  otLevel: "ok" | "warning" | "critical";
};

export function TeamMemberPage({
  orgId,
  managerId,
  profile,
  projects,
  assignments,
  tasks,
  sessions,
  storeVisits,
  media,
  hasGpsBySessionId,
  weekGpsMinutes,
  weekNoGpsMinutes,
  dailyTotals,
  excludedProjectIds,
  currentShiftReview,
}: {
  orgId: string;
  managerId: string;
  profile: ManagerProfileSummary;
  projects: ManagerProjectSummary[];
  assignments: ProjectAssignment[];
  tasks: Task[];
  sessions: ManagerSession[];
  storeVisits: StoreVisit[];
  media: WorkerMediaRow[];
  hasGpsBySessionId: Record<string, boolean>;
  weekGpsMinutes: number;
  weekNoGpsMinutes: number;
  dailyTotals: DailyTotal[];
  excludedProjectIds: string[];
  currentShiftReview: ShiftReview | null;
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
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const { t } = useTranslation();

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
  // Mirrors ProjectDetailPage.openProjectMediaItem: open a tab synchronously
  // inside the click to dodge mobile popup blockers, then sign the path
  // against the private 'media' bucket and navigate the tab to it.
  async function openMediaItem(item: { id: string; storage_path: string }) {
    if (typeof window === "undefined") return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      setMessage(t("projectDetail.mediaOpenFailed"));
      setMessageType("error");
      return;
    }
    const normalized = normalizeStoragePath(item.storage_path);
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600);
    if (error || !data?.signedUrl) {
      tab.close();
      setMessage(t("projectDetail.mediaOpenFailed"));
      setMessageType("error");
      return;
    }
    tab.location.href = data.signedUrl;
  }

  const unpaidMinutes = useMemo(() => {
    let total = 0;
    for (const session of sessions) {
      if (session.clockOutTime) total += session.durationMinutes;
    }
    return total;
  }, [sessions]);
  const unpaidHours = Math.round((unpaidMinutes / 60) * 100) / 100;

  const assignedProjectIds = new Set(assignments.map((assignment) => assignment.project_id));
  const activeProjects = projects.filter((project) => project.status !== "archived");

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
  // Controlled state for the two profile-edit toggles. Uncontrolled
  // `defaultChecked` only takes effect on initial mount; after
  // router.refresh() the input keeps whatever the user last toggled
  // even if the new server prop disagrees. Mirror the prop so the UI
  // always reflects the latest persisted profile.
  const [requireVideoUi, setRequireVideoUi] = useState(profile.require_video);
  const [isActiveUi, setIsActiveUi] = useState(profile.is_active);
  useEffect(() => {
    setRequireVideoUi(profile.require_video);
  }, [profile.require_video]);
  useEffect(() => {
    setIsActiveUi(profile.is_active);
  }, [profile.is_active]);

  async function handleUpdateProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? profile.name;
    const role = (formData.get("role")?.toString() ?? profile.role) as UserRole;
    const hourlyRateRaw = formData.get("hourly_rate")?.toString().trim() ?? "";
    const hourlyRate = hourlyRateRaw ? Number.parseFloat(hourlyRateRaw) : null;
    const requireVideo = requireVideoUi;
    const isActive = isActiveUi;

    setBusyKey("profile");
    setMessage("");

    // .select(...).single() so we can detect a silent RLS denial: if the
    // policy filter excludes this row from the manager's UPDATE, supabase
    // returns no error AND no row, and the prior code surfaced "saved!"
    // while the DB never changed. Reading back the persisted values lets
    // us assert the toggles really moved before declaring success.
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({
        name,
        role,
        require_video: requireVideo,
        is_active: isActive,
        hourly_rate: Number.isFinite(hourlyRate) ? hourlyRate : null,
      })
      .eq("id", profile.id)
      .select("require_video, is_active")
      .single();

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    if (!updated) {
      setMessage(t("permissions.saveFailed"));
      setBusyKey(null);
      return;
    }

    setRequireVideoUi(updated.require_video);
    setIsActiveUi(updated.is_active);
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
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
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
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
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
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
              <input
                name="hourly_rate"
                type="number"
                step="0.01"
                defaultValue={profile.hourly_rate ?? ""}
                placeholder={t("projects.hourlyRate")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  name="require_video"
                  checked={requireVideoUi}
                  onChange={(event) => setRequireVideoUi(event.target.checked)}
                />
                {t("teamMember.requireCheckoutVideo")}
              </label>
              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  name="is_active"
                  checked={isActiveUi}
                  onChange={(event) => setIsActiveUi(event.target.checked)}
                />
                {t("teamMember.allowPinAccess")}
              </label>
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

        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.week")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                  {formatDurationCompact(profile.weekMinutes)}
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
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.rate")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                  ${Number(profile.hourly_rate ?? 0).toFixed(2)}
                </div>
              </div>
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

      {/* ── Reset Hours to Zero ── */}
      <section>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
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

      {/* ── Send Message ── */}
      <section id="message">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="mb-4 text-lg font-bold text-[var(--text-primary)]">{t("messages.send")}</h2>
          <SendMessageForm
            orgId={orgId}
            senderId={managerId}
            recipientId={profile.id}
            recipientName={profile.name}
          />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.recentShifts")}</h2>
          <div className="mt-4 space-y-3">
            {sessions.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noShifts")}
              </div>
            ) : (
              sessions.map((session) => {
                const dayKey = session.clockInTime.slice(0, 10);
                const hasGps = hasGpsBySessionId[session.id] ?? false;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setDayDetailDate(dayKey)}
                    className="block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-left transition-colors hover:border-[var(--brand-yellow)]"
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
          <div className="flex items-center gap-2">
            <Camera size={16} style={{ color: "var(--brand-yellow)" }} />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("teamMember.journalEntries")}
            </h2>
          </div>
          <div className="mt-4 space-y-2">
            {media.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("teamMember.noJournal")}
              </div>
            ) : (
              media.map((entry) => (
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
                  <div className="mt-2 flex justify-end gap-2">
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
                      onClick={() => setFlagModalMediaId(entry.id)}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                      style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                    >
                      🚩 {t("flags.flagForReview")}
                    </button>
                  </div>
                </div>
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
        adjustments={[]}
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
    </div>
  );
}
