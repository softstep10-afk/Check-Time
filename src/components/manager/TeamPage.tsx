"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, MessageSquare, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDurationCompact } from "@/lib/worker-utils";
import type { ManagerProfileSummary } from "@/lib/manager-types";
import type { UserRole } from "@/types/database";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { toggleUserCapability } from "@/app/(manager)/admin/users/[id]/permissions/actions";
import { ALWAYS_FINANCE_ROLES } from "@/lib/finance-access";
import { canCreateTeamRole } from "@/lib/role-permissions";
import { generateTeamMemberPin, isValidTeamPasscode } from "@/lib/team-member-provisioning";

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
  "sales",
  "subcontractor",
  "manager",
  "admin",
  "owner",
];

// Wave 10 spec colors — kept consistent across the roster, mobile row,
// and any role-pill surface that reads from this map.
const ROLE_TAG_COLORS: Record<string, { bg: string; color: string }> = {
  owner: { bg: "rgba(245, 158, 11, 0.18)", color: "#f59e0b" },          // gold
  admin: { bg: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" },          // gold
  manager: { bg: "rgba(59, 130, 246, 0.14)", color: "#3b82f6" },        // blue
  supervisor: { bg: "rgba(139, 92, 246, 0.14)", color: "#8b5cf6" },     // purple
  driver: { bg: "rgba(34, 197, 94, 0.14)", color: "#22c55e" },          // green
  sales: { bg: "rgba(6, 182, 212, 0.14)", color: "#06b6d4" },           // cyan
  worker: { bg: "rgba(107, 114, 128, 0.18)", color: "#9ca3af" },        // gray (lighter text on dark bg)
  subcontractor: { bg: "rgba(249, 115, 22, 0.14)", color: "#f97316" },  // orange
};

const ROLE_GROUPS: Array<{ key: string; labelKey: TranslationKey; roles: UserRole[] }> = [
  { key: "workers", labelKey: "team.groupWorkers", roles: ["worker", "subcontractor"] },
  { key: "supervisors", labelKey: "team.groupSupervisors", roles: ["supervisor"] },
  { key: "drivers", labelKey: "team.groupDrivers", roles: ["driver"] },
  { key: "sales", labelKey: "team.groupSales", roles: ["sales"] },
  { key: "managers", labelKey: "team.groupManagers", roles: ["owner", "admin", "manager"] },
];

const AVATAR_COLORS = ["#f59e0b", "#3b82f6", "#22c55e", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#ec4899"];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function TeamPage({
  initialProfiles,
  hasAdminProvisioning,
  hasFinanceAccess,
  canManageFinanceAccess,
  managerId,
  managerRole,
}: {
  initialProfiles: ManagerProfileSummary[];
  hasAdminProvisioning: boolean;
  hasFinanceAccess: boolean;
  canManageFinanceAccess: boolean;
  managerId: string;
  managerRole: UserRole;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "info">("info");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [nameError, setNameError] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinValue, setPinValue] = useState(() => generateTeamMemberPin());
  // Optimistic override of profile.financeAccess, keyed by profile id.
  // Successful toggles land in here and stay; router.refresh() repopulates
  // initialProfiles with the same value, so effectiveFinanceAccess returns
  // the right answer either way. The map grows at most one entry per
  // toggled profile per session — negligible for a roster page.
  const [financeOverrides, setFinanceOverrides] = useState<
    Record<string, boolean>
  >({});
  const { t } = useTranslation();

  function effectiveFinanceAccess(profile: ManagerProfileSummary): boolean {
    if (profile.id in financeOverrides) return financeOverrides[profile.id];
    return profile.financeAccess;
  }

  async function handleFinanceToggle(
    profile: ManagerProfileSummary,
    next: boolean,
  ) {
    if (ALWAYS_FINANCE_ROLES.has(profile.role)) return;
    if (!canManageFinanceAccess) return;
    const previous = effectiveFinanceAccess(profile);
    setFinanceOverrides((prev) => ({ ...prev, [profile.id]: next }));
    setBusyKey(`finance-${profile.id}`);
    setMessage("");
    const result = await toggleUserCapability({
      userId: profile.id,
      capability: "finance_access",
      granted: next,
    });
    setBusyKey(null);
    if (!result.ok) {
      setFinanceOverrides((prev) => ({ ...prev, [profile.id]: previous }));
      setMessage(result.message ?? t("team.financeToggleError"));
      setMessageType("error");
      return;
    }
    router.refresh();
  }

  const visibleProfiles = useMemo(() => {
    let filtered = initialProfiles;

    if (!showInactive) {
      filtered = filtered.filter((p) => p.is_active);
    }

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
  }, [initialProfiles, query, roleFilter, showInactive]);

  const totals = useMemo(() => {
    let minutes = 0;
    let earned = 0;
    for (const p of visibleProfiles) {
      minutes += p.weekMinutes;
      if (hasFinanceAccess) {
        earned += earnedAmount(p);
      }
    }
    return { minutes, earned: Math.round(earned * 100) / 100 };
  }, [visibleProfiles, hasFinanceAccess]);

  const groupedProfiles = useMemo(() => {
    return ROLE_GROUPS
      .map((group) => ({
        ...group,
        profiles: visibleProfiles.filter((profile) => group.roles.includes(profile.role)),
      }))
      .filter((group) => group.profiles.length > 0);
  }, [visibleProfiles]);

  const showFinanceAccessColumn = canManageFinanceAccess;
  const rosterColumnCount =
    4 + (hasFinanceAccess ? 2 : 0) + (showFinanceAccessColumn ? 1 : 0) + 1;

  const inactiveCount = useMemo(
    () => initialProfiles.filter((p) => !p.is_active).length,
    [initialProfiles],
  );
  const creatableRoleGroups = useMemo(
    () =>
      ROLE_GROUPS.map((group) => ({
        ...group,
        roles: group.roles.filter(
          (role) =>
            roleOptions.includes(role) &&
            role !== "owner" &&
            canCreateTeamRole(managerRole, role),
        ),
      })).filter((group) => group.roles.length > 0),
    [managerRole],
  );

  function validateName(value: string) {
    setNameError(value.trim() ? "" : t("team.nameRequired"));
  }

  function validatePin(value: string) {
    setPinValue(value);
    if (value && !/^[A-Za-z0-9]*$/.test(value)) {
      setPinError(t("team.pinLettersDigitsOnly"));
    } else if (value && value.length > 0 && value.length < 4) {
      setPinError(t("team.pinMinLength"));
    } else if (value.length > 12) {
      setPinError(t("team.pinLength"));
    } else {
      setPinError("");
    }
  }

  function regeneratePin() {
    setPinValue(generateTeamMemberPin());
    setPinError("");
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
    if (!isValidTeamPasscode(pin)) {
      setPinError(t("team.pinLength"));
      return;
    }

    const payload = {
      name,
      pin,
      role: formData.get("role")?.toString() ?? "worker",
      hourlyRate: hasFinanceAccess
        ? formData.get("hourly_rate")?.toString().trim() ?? ""
        : "",
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
    setPinValue(generateTeamMemberPin());
    setBusyKey(null);
    setMessage(
      t("team.memberCreatedPin")
        .replace("{name}", result.name ?? name)
        .replace("{pin}", result.pin ?? pin),
    );
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

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("team.title")}
          </p>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
            {t("team.subtitle")}
          </h1>
          <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
            {t("team.description")}
          </p>
        </div>
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
                {ROLE_GROUPS.map((group) => (
                  <optgroup key={group.key} label={t(group.labelKey)}>
                    {group.roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <TextInputWithVoice
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("team.searchTeam")}
                className="min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-xs text-[var(--text-primary)] outline-none"
              />
            </div>
          </div>

          {/* Desktop table */}
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
                  style={{ borderBottom: "1px solid var(--border-default)" }}
                >
                  <th className="pb-3 pr-3 font-semibold">{t("team.colName")}</th>
                  <th className="pb-3 pr-3 font-semibold">{t("team.colCategory")}</th>
                  <th className="pb-3 pr-3 font-semibold">{t("team.colStatus")}</th>
                  <th className="pb-3 pr-3 text-right font-semibold">{t("team.colHours")}</th>
                  {hasFinanceAccess ? (
                    <>
                      <th className="pb-3 pr-3 text-right font-semibold">{t("team.colRate")}</th>
                      <th className="pb-3 pr-3 text-right font-semibold">{t("team.colEarned")}</th>
                    </>
                  ) : null}
                  {showFinanceAccessColumn ? (
                    <th className="pb-3 pr-3 text-right font-semibold">{t("team.colFinance")}</th>
                  ) : null}
                  <th className="pb-3 text-right font-semibold">{t("team.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {groupedProfiles.map((group) => (
                  <Fragment key={group.key}>
                    <tr>
                      <td
                        colSpan={rosterColumnCount}
                        className="py-3 pr-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]"
                      >
                        {t(group.labelKey)} · {group.profiles.length}
                      </td>
                    </tr>
                    {group.profiles.map((profile) => {
                  const earned = earnedAmount(profile);
                  const rate = Number(profile.hourly_rate ?? 0);
                  return (
                    <tr key={profile.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black"
                            style={{ background: avatarColor(profile.name) }}
                          >
                            {profile.name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={`/team/${profile.id}`}
                              className="block truncate font-semibold text-[var(--text-primary)]"
                            >
                              {profile.name}
                            </Link>
                            <span className="font-mono text-[10px] text-[var(--text-muted)]">PIN ****</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[9px] font-bold uppercase"
                          style={ROLE_TAG_COLORS[profile.role] ?? ROLE_TAG_COLORS.worker}
                        >
                          {profile.role}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold"
                          style={{
                            background: profile.isOnSite ? "rgba(34, 197, 94, 0.12)" : "rgba(107, 114, 128, 0.1)",
                            color: profile.isOnSite ? "#22c55e" : "var(--text-muted)",
                          }}
                        >
                          <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: "currentColor" }} />
                          {profile.isOnSite ? t("common.onSite") : t("team.offShift")}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right font-mono text-[var(--text-primary)]">
                        {formatDurationCompact(profile.weekMinutes)}
                      </td>
                      {hasFinanceAccess ? (
                        <>
                          <td
                            className="py-3 pr-3 text-right font-mono"
                            style={{ color: rate > 0 ? "var(--brand-yellow)" : "var(--text-muted)" }}
                          >
                            ${rate.toFixed(2)}
                          </td>
                          <td
                            className="py-3 pr-3 text-right font-mono"
                            style={{ color: earned > 0 ? "var(--green)" : "var(--text-muted)" }}
                          >
                            {currencyFmt.format(earned)}
                          </td>
                        </>
                      ) : null}
                      {showFinanceAccessColumn ? (
                      <td className="py-3 pr-3 text-right">
                        {ALWAYS_FINANCE_ROLES.has(profile.role) ? (
                          <span
                            className="inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[9px] font-bold uppercase"
                            style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                            title={t("team.financeAlways")}
                          >
                            {t("team.financeAlways")}
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={effectiveFinanceAccess(profile)}
                            onChange={(event) =>
                              void handleFinanceToggle(profile, event.target.checked)
                            }
                            disabled={
                              !canManageFinanceAccess || busyKey === `finance-${profile.id}`
                            }
                            aria-label={t("team.colFinance")}
                            className="h-4 w-4 cursor-pointer"
                          />
                        )}
                      </td>
                      ) : null}
                      <td className="py-3 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Link
                            href={`/team/${profile.id}`}
                            title={t("team.actionEdit")}
                            aria-label={t("team.actionEdit")}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                          >
                            <Pencil size={12} />
                          </Link>
                          <Link
                            href={`/team/${profile.id}#message`}
                            title={t("team.actionMessage")}
                            aria-label={t("team.actionMessage")}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{ borderColor: "rgba(59, 130, 246, 0.3)", color: "var(--blue)" }}
                          >
                            <MessageSquare size={12} />
                          </Link>
                          <button
                            type="button"
                            onClick={() => void handleRemoveProfile(profile)}
                            disabled={busyKey === `remove-${profile.id}` || profile.id === managerId}
                            title={t("team.actionRemove")}
                            aria-label={t("team.actionRemove")}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
              <tfoot
                className="sticky bottom-0 z-10"
                style={{
                  background: "var(--bg-card)",
                  boxShadow: "0 -4px 14px rgba(0,0,0,0.18)",
                }}
              >
                <tr style={{ borderTop: "1px solid var(--border-default)" }}>
                  <td className="py-3 pr-3 font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]" colSpan={3}>
                    {t("team.totalPeople")} ({visibleProfiles.length} {t("team.people").toUpperCase()})
                  </td>
                  <td className="py-3 pr-3 text-right font-mono font-bold" style={{ color: "var(--brand-yellow)" }}>
                    {formatDurationCompact(totals.minutes)}
                  </td>
                  {hasFinanceAccess ? (
                    <>
                      <td className="py-3 pr-3" />
                      <td className="py-3 pr-3 text-right font-mono font-bold" style={{ color: "var(--green)" }}>
                        {currencyFmt.format(totals.earned)}
                      </td>
                    </>
                  ) : null}
                  {showFinanceAccessColumn ? <td className="py-3 pr-3" /> : null}
                  <td className="py-3 pr-3" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile stacked rows */}
          <div className="mt-4 space-y-2 md:hidden">
            {groupedProfiles.map((group) => (
              <div key={group.key} className="space-y-2">
                <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {t(group.labelKey)} · {group.profiles.length}
                </div>
                {group.profiles.map((profile) => {
              const earned = earnedAmount(profile);
              const rate = Number(profile.hourly_rate ?? 0);
              return (
                <div
                  key={profile.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-black"
                      style={{ background: avatarColor(profile.name) }}
                    >
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={`/team/${profile.id}`}
                          className="text-sm font-semibold text-[var(--text-primary)]"
                        >
                          {profile.name}
                        </Link>
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                          style={ROLE_TAG_COLORS[profile.role] ?? ROLE_TAG_COLORS.worker}
                        >
                          {profile.role}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                        <span className="font-mono">PIN ****</span>
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold"
                      style={{
                        background: profile.isOnSite ? "rgba(34, 197, 94, 0.12)" : "rgba(107, 114, 128, 0.1)",
                        color: profile.isOnSite ? "#22c55e" : "var(--text-muted)",
                      }}
                    >
                      <span className="inline-block h-[5px] w-[5px] rounded-full" style={{ background: "currentColor" }} />
                      {profile.isOnSite ? t("common.onSite") : t("team.offShift")}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-[var(--text-primary)]">
                      {formatDurationCompact(profile.weekMinutes)}
                    </span>
                    {hasFinanceAccess ? (
                      <>
                        <span className="font-mono" style={{ color: rate > 0 ? "var(--brand-yellow)" : "var(--text-muted)" }}>
                          ${rate.toFixed(2)}/h
                        </span>
                        <span className="font-mono font-semibold" style={{ color: earned > 0 ? "var(--green)" : "var(--text-muted)" }}>
                          {currencyFmt.format(earned)}
                        </span>
                      </>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2">
                    {showFinanceAccessColumn ? (
                    ALWAYS_FINANCE_ROLES.has(profile.role) ? (
                      <span
                        className="inline-flex items-center rounded-[var(--radius-pill)] px-2 py-0.5 text-[9px] font-bold uppercase"
                        style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                        title={t("team.financeAlways")}
                      >
                        {t("team.colFinance")}: {t("team.financeAlways")}
                      </span>
                    ) : (
                      <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={effectiveFinanceAccess(profile)}
                          onChange={(event) =>
                            void handleFinanceToggle(profile, event.target.checked)
                          }
                          disabled={
                            !canManageFinanceAccess || busyKey === `finance-${profile.id}`
                          }
                          className="h-3.5 w-3.5 cursor-pointer"
                        />
                        {t("team.colFinance")}
                      </label>
                    )
                    ) : <span />}
                    <div className="inline-flex items-center gap-1">
                    <Link
                      href={`/team/${profile.id}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                      style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                      aria-label={t("team.actionEdit")}
                    >
                      <Pencil size={13} />
                    </Link>
                    <Link
                      href={`/team/${profile.id}#message`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                      style={{ borderColor: "rgba(59, 130, 246, 0.3)", color: "var(--blue)" }}
                      aria-label={t("team.actionMessage")}
                    >
                      <MessageSquare size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleRemoveProfile(profile)}
                      disabled={busyKey === `remove-${profile.id}` || profile.id === managerId}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                      style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                      aria-label={t("team.actionRemove")}
                    >
                      <Trash2 size={13} />
                    </button>
                    </div>
                  </div>
                </div>
              );
                })}
              </div>
            ))}

            <div
              className="sticky bottom-0 flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-3 text-[11px]"
              style={{ boxShadow: "0 -4px 14px rgba(0,0,0,0.18)" }}
            >
              <span className="font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("team.totalPeople")} ({visibleProfiles.length})
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold" style={{ color: "var(--brand-yellow)" }}>
                  {formatDurationCompact(totals.minutes)}
                </span>
                {hasFinanceAccess ? (
                  <span className="font-mono font-bold" style={{ color: "var(--green)" }}>
                    {currencyFmt.format(totals.earned)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {inactiveCount > 0 ? (
            <div className="mt-3 flex items-center justify-end">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>
                  {t("team.showInactive").replace("{n}", String(inactiveCount))}
                </span>
              </label>
            </div>
          ) : null}
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
                  <label
                    htmlFor="team-member-name"
                    className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                  >
                    {t("team.fullName")}
                  </label>
                  <TextInputWithVoice
                    id="team-member-name"
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
                    <label
                      htmlFor="team-member-pin"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                    >
                      {t("team.pinLabel")}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="team-member-pin"
                        name="pin"
                        inputMode="text"
                        autoCapitalize="none"
                        maxLength={12}
                        placeholder={t("team.pinPlaceholder")}
                        value={pinValue}
                        onChange={(e) => validatePin(e.target.value)}
                        className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <button
                        type="button"
                        onClick={regeneratePin}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 text-xs font-semibold text-[var(--text-primary)]"
                      >
                        {t("team.newPin")}
                      </button>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">
                      {t("team.pinHelp")}
                    </div>
                    {pinError ? (
                      <div className="mt-1 text-xs" style={{ color: "var(--red)" }}>{pinError}</div>
                    ) : null}
                  </div>
                  <div>
                    <label
                      htmlFor="team-member-role"
                      className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                    >
                      {t("team.roleLabel")}
                    </label>
                    <select
                      id="team-member-role"
                      name="role"
                      defaultValue="worker"
                      className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                    >
                      {creatableRoleGroups.map((group) => {
                        return (
                          <optgroup key={group.key} label={t(group.labelKey)}>
                            {group.roles.map((role) => (
                              <option key={role} value={role}>
                                {t(`roles.${role}` as TranslationKey)}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </div>
                </div>
                <div className={hasFinanceAccess ? "grid gap-3 sm:grid-cols-[1fr_auto]" : "grid gap-3"}>
                  {hasFinanceAccess ? (
                    <div>
                      <label
                        htmlFor="team-member-hourly-rate"
                        className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                      >
                        {t("projects.hourlyRate")}
                      </label>
                      <input
                        id="team-member-hourly-rate"
                        name="hourly_rate"
                        type="number"
                        step="0.01"
                        placeholder={t("projects.hourlyRate")}
                        className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                    </div>
                  ) : null}
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
