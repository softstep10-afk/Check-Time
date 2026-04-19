"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, MessageSquare, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDurationCompact } from "@/lib/worker-utils";
import type { ManagerProfileSummary } from "@/lib/manager-types";
import type { UserRole } from "@/types/database";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function earnedAmount(profile: ManagerProfileSummary): number {
  const hours = profile.weekMinutes / 60;
  return Math.round(hours * Number(profile.hourly_rate ?? 0) * 100) / 100;
}

const roleOptions: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "subcontractor",
  "manager",
  "admin",
  "owner",
];

const ROLE_TAG_COLORS: Record<string, { bg: string; color: string }> = {
  worker: { bg: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" },
  driver: { bg: "rgba(34, 197, 94, 0.12)", color: "#22c55e" },
  supervisor: { bg: "rgba(59, 130, 246, 0.12)", color: "#3b82f6" },
  subcontractor: { bg: "rgba(168, 85, 247, 0.12)", color: "#a855f7" },
  manager: { bg: "rgba(59, 130, 246, 0.12)", color: "#3b82f6" },
  admin: { bg: "rgba(245, 158, 11, 0.12)", color: "#f59e0b" },
  owner: { bg: "rgba(245, 158, 11, 0.2)", color: "#f59e0b" },
};

const AVATAR_COLORS = ["#f59e0b", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#ec4899"];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function TeamPage({
  initialProfiles,
  hasAdminProvisioning,
  managerId,
}: {
  initialProfiles: ManagerProfileSummary[];
  hasAdminProvisioning: boolean;
  managerId: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [nameError, setNameError] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinValue, setPinValue] = useState(() =>
    String(Math.floor(1000 + Math.random() * 9000)),
  );
  const { t } = useTranslation();

  const totals = useMemo(() => {
    let minutes = 0;
    let earned = 0;
    for (const p of initialProfiles) {
      minutes += p.weekMinutes;
      earned += earnedAmount(p);
    }
    return { minutes, earned: Math.round(earned * 100) / 100 };
  }, [initialProfiles]);

  const visibleProfiles = useMemo(() => {
    let filtered = initialProfiles;

    if (roleFilter) {
      filtered = filtered.filter((p) => p.role === roleFilter);
    }

    const needle = query.trim().toLowerCase();
    if (needle) {
      filtered = filtered.filter((profile) => {
        return (
          profile.name.toLowerCase().includes(needle) ||
          profile.role.toLowerCase().includes(needle) ||
          profile.assignedProjectNames.some((project) =>
            project.toLowerCase().includes(needle),
          )
        );
      });
    }

    return filtered;
  }, [initialProfiles, query, roleFilter]);


  function validateName(value: string) {
    setNameError(value.trim() ? "" : t("team.nameRequired"));
  }

  function validatePin(value: string) {
    setPinValue(value);
    if (value && !/^\d*$/.test(value)) {
      setPinError(t("team.pinDigitsOnly"));
    } else if (value && value.length > 0 && value.length < 4) {
      setPinError(t("team.pinMinLength"));
    } else {
      setPinError("");
    }
  }

  async function handleCreateMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() ?? "";
    const pin = formData.get("pin")?.toString().trim() ?? "";

    if (!name) {
      setNameError(t("team.nameRequired"));
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setPinError(t("team.pinLength"));
      return;
    }

    const payload = {
      name,
      pin,
      role: formData.get("role")?.toString() ?? "worker",
      hourlyRate: formData.get("hourly_rate")?.toString().trim() ?? "",
      requireVideo: formData.get("require_video") === "on",
    };

    setBusyKey("create");
    setMessage("");

    const response = await fetch("/api/team/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string; name?: string; pin?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("team.couldNotCreate"));
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    form.reset();
    setPinValue("");
    setBusyKey(null);
    setMessage(`✓ ${result.name ?? name} created with PIN ${result.pin ?? pin}`);
    setMessageType("success");
    router.refresh();
  }

  async function handleRemoveProfile(profile: ManagerProfileSummary) {
    if (profile.id === managerId) return;
    if (typeof window !== "undefined" && !window.confirm(t("team.confirmRemove"))) return;

    setBusyKey(`remove-${profile.id}`);
    setMessage("");

    const { error } = await supabase
      .from("profiles")
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq("id", profile.id);

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("team.removed"));
    setMessageType("success");
    router.refresh();
  }

  async function handleToggleProfile(
    profileId: string,
    patch: {
      require_video?: boolean;
      is_active?: boolean;
    },
    successMessage: string,
  ) {
    setBusyKey(profileId);
    setMessage("");

    const { error } = await supabase.from("profiles").update(patch).eq("id", profileId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(successMessage);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("team.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("team.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("team.description")}
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

      {initialProfiles.filter((p) => p.id !== managerId).length === 0 && hasAdminProvisioning ? (
        <div
          className="rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center"
          style={{ borderColor: "var(--brand-yellow)" }}
        >
          <div className="text-lg font-bold text-[var(--text-primary)]">
            {t("team.addFirstWorker")}
          </div>
          <p className="mx-auto mt-2 max-w-[50ch] text-sm leading-6 text-[var(--text-secondary)]">
            {t("team.addFirstDesc")}
          </p>
          <div className="mt-3 text-2xl" style={{ color: "var(--brand-yellow)" }}>↓</div>
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("team.activeRoster")}</h2>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                {visibleProfiles.length} {t("team.profiles")}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("team.allCategories")}</option>
                <option value="worker">Worker</option>
                <option value="driver">Driver</option>
                <option value="supervisor">Supervisor</option>
                <option value="subcontractor">Subcontractor</option>
              </select>
              <TextInputWithVoice
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("team.searchTeam")}
                className="min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {visibleProfiles.map((profile) => (
              <article
                key={profile.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black"
                    style={{ background: avatarColor(profile.name) }}
                  >
                    {profile.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/team/${profile.id}`}
                        className="text-[13px] font-semibold text-[var(--text-primary)]"
                      >
                        {profile.name}
                      </Link>
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[9px] font-bold uppercase"
                        style={ROLE_TAG_COLORS[profile.role] ?? ROLE_TAG_COLORS.worker}
                      >
                        {profile.role}
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]">
                      PIN ****
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {/* Video indicator */}
                    <span
                      title={profile.videoUploadedToday ? t("team.videoToday") : t("team.noVideoToday")}
                      aria-label={profile.videoUploadedToday ? t("team.videoToday") : t("team.noVideoToday")}
                      className="inline-block h-3 w-3 rounded-full border"
                      style={{
                        background: profile.videoUploadedToday ? "var(--green)" : "transparent",
                        borderColor: profile.videoUploadedToday ? "var(--green)" : "var(--text-muted)",
                      }}
                    />
                    {/* Status pill */}
                    <span
                      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2.5 py-1 text-[10px] font-bold"
                      style={{
                        background: profile.isOnSite ? "rgba(34, 197, 94, 0.12)" : "rgba(107, 114, 128, 0.1)",
                        color: profile.isOnSite ? "#22c55e" : "var(--text-muted)",
                      }}
                    >
                      <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: "currentColor" }} />
                      {profile.isOnSite ? t("common.onSite") : t("team.offShift")}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-5">
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.week")}</div>
                    <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                      {formatDurationCompact(profile.weekMinutes)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.tasks")}</div>
                    <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                      {profile.openTaskCount}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.rate")}</div>
                    <div className="mt-1 font-mono text-sm font-bold" style={{ color: Number(profile.hourly_rate ?? 0) > 0 ? "var(--brand-yellow)" : "var(--text-muted)" }}>
                      ${Number(profile.hourly_rate ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("team.earned")}</div>
                    <div className="mt-1 font-mono text-sm font-bold" style={{ color: "#22c55e" }}>
                      ${(Math.round(profile.weekMinutes / 60 * Number(profile.hourly_rate ?? 0) * 100) / 100).toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2.5">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.assigned")}</div>
                    <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">
                      {profile.assignedProjectIds.length}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {profile.assignedProjectNames.length === 0 ? (
                    <span className="text-xs text-[var(--text-muted)]">{t("team.noActiveAssignments")}</span>
                  ) : (
                    profile.assignedProjectNames.map((projectName) => (
                      <span
                        key={projectName}
                        className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{
                          background: "rgba(191, 162, 52, 0.12)",
                          color: "var(--brand-yellow)",
                        }}
                      >
                        {projectName}
                      </span>
                    ))
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={`/team/${profile.id}`}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    <Pencil size={12} />
                    {t("team.actionEdit")}
                  </Link>
                  <Link
                    href={`/team/${profile.id}#message`}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "rgba(59, 130, 246, 0.3)", color: "var(--blue)" }}
                  >
                    <MessageSquare size={12} />
                    {t("team.actionMessage")}
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      void handleToggleProfile(
                        profile.id,
                        { require_video: !profile.require_video },
                        profile.require_video
                          ? t("team.videoDisabled")
                          : t("team.videoEnabled"),
                      )
                    }
                    disabled={busyKey === profile.id}
                    className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {profile.require_video ? t("team.videoRequired") : t("team.videoOptional")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleToggleProfile(
                        profile.id,
                        { is_active: !profile.is_active },
                        profile.is_active ? t("team.profilePaused") : t("team.profileReactivated"),
                      )
                    }
                    disabled={busyKey === profile.id}
                    className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{
                      borderColor: profile.is_active
                        ? "rgba(212, 81, 94, 0.3)"
                        : "rgba(15, 168, 120, 0.3)",
                      color: profile.is_active ? "var(--red)" : "var(--green)",
                    }}
                  >
                    {profile.is_active ? t("team.pauseAccess") : t("team.reactivate")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRemoveProfile(profile)}
                    disabled={busyKey === `remove-${profile.id}` || profile.id === managerId}
                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                  >
                    <Trash2 size={12} />
                    {t("team.actionRemove")}
                  </button>
                </div>
              </article>
            ))}
          </div>

          <div
            className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-3 text-xs"
            style={{ boxShadow: "0 -4px 14px rgba(0,0,0,0.18)" }}
          >
            <div className="font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("team.totalPeople")} ({visibleProfiles.length} {t("team.people").toUpperCase()})
            </div>
            <div className="flex items-center gap-4">
              <div>
                <span className="mr-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("team.totalHours")}:
                </span>
                <span className="font-mono text-sm font-bold" style={{ color: "var(--brand-yellow)" }}>
                  {formatDurationCompact(totals.minutes)}
                </span>
              </div>
              <div>
                <span className="mr-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t("team.totalEarned")}:
                </span>
                <span className="font-mono text-sm font-bold" style={{ color: "var(--green)" }}>
                  {currencyFmt.format(totals.earned)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("team.newMember")}</h2>
            {!hasAdminProvisioning ? (
              <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("team.serviceKeyNote")}
              </div>
            ) : (
              <form className="mt-4 grid gap-3" onSubmit={handleCreateMember}>
                <div>
                  <TextInputWithVoice
                    name="name"
                    placeholder={t("team.fullName")}
                    onChange={(e) => validateName(e.target.value)}
                    className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  {nameError ? (
                    <div className="mt-1 text-xs" style={{ color: "var(--red)" }}>{nameError}</div>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="flex gap-2">
                      <input
                        name="pin"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder={t("team.pinPlaceholder")}
                        value={pinValue}
                        onChange={(e) => validatePin(e.target.value)}
                        className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                    </div>
                    {pinError ? (
                      <div className="mt-1 text-xs" style={{ color: "var(--red)" }}>{pinError}</div>
                    ) : null}
                  </div>
                  <select
                    name="role"
                    defaultValue="worker"
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    name="hourly_rate"
                    type="number"
                    step="0.01"
                    placeholder={t("projects.hourlyRate")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
                    <input type="checkbox" name="require_video" defaultChecked />
                    {t("team.requireCheckoutVideo")}
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={busyKey === "create"}
                  className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
                  style={{
                    background: busyKey === "create" ? "var(--border-default)" : "var(--brand-yellow)",
                    color: busyKey === "create" ? "var(--text-muted)" : "var(--text-inverse)",
                  }}
                >
                  {busyKey === "create" ? t("common.creating") : t("team.createMember")}
                </button>
              </form>
            )}
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("team.shiftPulse")}</h2>
            <div className="mt-4 space-y-3">
              {initialProfiles
                .filter((profile) => profile.isOnSite)
                .slice(0, 6)
                .map((profile) => (
                  <div
                    key={profile.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/team/${profile.id}`}
                        className="text-sm font-semibold text-[var(--text-primary)]"
                      >
                        {profile.name}
                      </Link>
                      <div className="text-xs text-[var(--brand-yellow)]">
                        {profile.currentSessionMinutes === null
                          ? t("common.live")
                          : formatDurationCompact(profile.currentSessionMinutes)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {profile.currentProjectName ?? t("common.projectNotResolved")}
                    </div>
                  </div>
                ))}
              {initialProfiles.every((profile) => !profile.isOnSite) ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {t("team.nobodyClockedIn")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
