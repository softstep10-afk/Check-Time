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

const roleOptions: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "subcontractor",
  "manager",
  "admin",
];

type WorkerMediaRow = Media & { projectName: string | null };

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

  async function handleUpdateProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? profile.name;
    const role = (formData.get("role")?.toString() ?? profile.role) as UserRole;
    const hourlyRateRaw = formData.get("hourly_rate")?.toString().trim() ?? "";
    const hourlyRate = hourlyRateRaw ? Number.parseFloat(hourlyRateRaw) : null;
    const requireVideo = formData.get("require_video") === "on";
    const isActive = formData.get("is_active") === "on";

    setBusyKey("profile");
    setMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({
        name,
        role,
        require_video: requireVideo,
        is_active: isActive,
        hourly_rate: Number.isFinite(hourlyRate) ? hourlyRate : null,
      })
      .eq("id", profile.id);

    if (error) {
      setMessage(error.message);
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
                <input type="checkbox" name="require_video" defaultChecked={profile.require_video} />
                {t("teamMember.requireCheckoutVideo")}
              </label>
              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                <input type="checkbox" name="is_active" defaultChecked={profile.is_active} />
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
            <div className="mt-4 text-sm text-[var(--text-secondary)]">
              {profile.currentProjectName ?? t("teamMember.noCurrentProject")}
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("teamMember.projectAssignments")}</h2>
              <div className="text-xs text-[var(--text-muted)]">{assignments.length} {t("common.assigned").toLowerCase()}</div>
            </div>
            <div className="mt-4 space-y-2">
              {activeProjects.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {t("teamMember.noActiveProjects")}
                </div>
              ) : (
                activeProjects.map((project) => {
                  const isAssigned = assignedProjectIds.has(project.id);
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
                          background: isAssigned
                            ? "var(--brand-yellow)"
                            : "var(--border-default)",
                        }}
                        aria-label={isAssigned ? `Unassign from ${project.name}` : `Assign to ${project.name}`}
                      >
                        <span
                          className="absolute top-0.5 block h-5 w-5 rounded-full bg-white transition-transform"
                          style={{
                            transform: isAssigned ? "translateX(22px)" : "translateX(2px)",
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
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => setDayDetailDate(dayKey)}
                    className="block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-left transition-colors hover:border-[var(--brand-yellow)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          {session.projectName}
                        </span>
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
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {entry.filename ?? entry.media_type}
                      </div>
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
                  <div className="mt-2 flex justify-end">
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
