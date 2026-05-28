"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime } from "@/lib/worker-utils";

type AuditEntry = {
  id: string;
  timestamp: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type SignatureEntry = {
  id: string;
  type: "gps" | "safety";
  workerName: string;
  signedName: string;
  version: string;
  status: string;
  timestamp: string;
  context: string;
  userAgent: string;
};

const PREVIEW_ENTRIES: AuditEntry[] = [
  {
    id: "aud-001",
    timestamp: new Date(Date.now() - 2 * 3600_000).toISOString(),
    actorName: "Preview Owner",
    actorRole: "owner",
    action: "payroll_approved",
    targetType: "pay_period",
    targetId: "period-123",
    before: { status: "draft" },
    after: { status: "approved" },
  },
  {
    id: "aud-002",
    timestamp: new Date(Date.now() - 5 * 3600_000).toISOString(),
    actorName: "Preview Owner",
    actorRole: "owner",
    action: "role_change",
    targetType: "profile",
    targetId: "worker-456",
    before: { role: "worker" },
    after: { role: "supervisor" },
  },
  {
    id: "aud-003",
    timestamp: new Date(Date.now() - 24 * 3600_000).toISOString(),
    actorName: "Preview Owner",
    actorRole: "owner",
    action: "force_checkout",
    targetType: "time_event",
    targetId: "event-789",
    before: null,
    after: { forced_by: "owner", reason: "Left site without checking out" },
  },
  {
    id: "aud-004",
    timestamp: new Date(Date.now() - 48 * 3600_000).toISOString(),
    actorName: "Preview Owner",
    actorRole: "owner",
    action: "settings_change",
    targetType: "organization",
    targetId: "org-001",
    before: { ot_threshold: 40 },
    after: { ot_threshold: 44 },
  },
];

const PREVIEW_SIGNATURES: SignatureEntry[] = [
  {
    id: "sig-gps-preview",
    type: "gps",
    workerName: "Preview Worker",
    signedName: "Preview Worker",
    version: "1",
    status: "accepted",
    timestamp: new Date(Date.now() - 3600_000).toISOString(),
    context: "GPS sharing",
    userAgent: "Preview browser",
  },
  {
    id: "sig-safety-preview",
    type: "safety",
    workerName: "Preview Worker",
    signedName: "Preview Worker",
    version: "v2-wa-2026-04",
    status: "acknowledged",
    timestamp: new Date(Date.now() - 1800_000).toISOString(),
    context: "Preview Project",
    userAgent: "",
  },
];


const ACTION_COLORS: Record<string, string> = {
  payroll_approved: "var(--green)",
  payroll_paid: "var(--green)",
  role_change: "var(--brand-yellow)",
  role_changed: "var(--brand-yellow)",
  force_checkout: "var(--red)",
  ownership_transfer: "#a855f7",
  data_purge: "var(--red)",
  settings_change: "var(--blue)",
  task_created: "var(--blue)",
  task_deleted: "var(--red)",
  worker_hours_adjusted: "var(--brand-yellow)",
  worker_hours_manual_close: "var(--green)",
};

const ACTION_LABELS: Record<string, { en: string; ru: string }> = {
  payroll_approved: { en: "Payroll approved", ru: "Зарплата утверждена" },
  payroll_paid: { en: "Payroll paid", ru: "Зарплата оплачена" },
  role_change: { en: "Role changed", ru: "Роль изменена" },
  role_changed: { en: "Role changed", ru: "Роль изменена" },
  force_checkout: { en: "Force checkout", ru: "Принудительный выход" },
  ownership_transfer: { en: "Ownership transfer", ru: "Передача владения" },
  data_purge: { en: "Data purge", ru: "Удаление данных" },
  settings_change: { en: "Settings changed", ru: "Настройки изменены" },
  task_created: { en: "Task created", ru: "Задача создана" },
  task_deleted: { en: "Task deleted", ru: "Задача удалена" },
  worker_hours_adjusted: { en: "Worker hours adjusted", ru: "Часы работника изменены" },
  worker_hours_manual_close: { en: "Worker hours closed", ru: "Часы работника закрыты" },
};

const ROLE_LABELS: Record<string, { en: string; ru: string }> = {
  owner: { en: "OWNER", ru: "ВЛАДЕЛЕЦ" },
  admin: { en: "ADMIN", ru: "АДМИН" },
  manager: { en: "MANAGER", ru: "МЕНЕДЖЕР" },
  supervisor: { en: "SUPERVISOR", ru: "СУПЕРВАЙЗЕР" },
  worker: { en: "WORKER", ru: "РАБОЧИЙ" },
  driver: { en: "DRIVER", ru: "ВОДИТЕЛЬ" },
  sales: { en: "SALES", ru: "ПРОДАЖИ" },
  subcontractor: { en: "SUBCONTRACTOR", ru: "СУБПОДРЯДЧИК" },
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function humanizeAction(action: string, locale: "en" | "ru"): string {
  return ACTION_LABELS[action]?.[locale] ?? action.replace(/_/g, " ");
}

function humanizeRole(role: string, locale: "en" | "ru"): string {
  return ROLE_LABELS[role]?.[locale] ?? role.toUpperCase();
}

export default function AuditLogPage() {
  const { t, locale } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [entries, setEntries] = useState<AuditEntry[]>(() =>
    AUTH_BYPASS_ENABLED ? PREVIEW_ENTRIES : [],
  );
  const [loading, setLoading] = useState(!AUTH_BYPASS_ENABLED);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState("");
  const [canViewSignatures, setCanViewSignatures] = useState(AUTH_BYPASS_ENABLED);
  const [signatureEntries, setSignatureEntries] = useState<SignatureEntry[]>(
    () => (AUTH_BYPASS_ENABLED ? PREVIEW_SIGNATURES : []),
  );
  const [loadingSignatures, setLoadingSignatures] = useState(!AUTH_BYPASS_ENABLED);

  useEffect(() => {
    if (AUTH_BYPASS_ENABLED) {
      return;
    }

    async function load() {
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (data) {
        setEntries(
          (data as Array<{
            id: string;
            actor_name: string;
            actor_role: string;
            action: string;
            target_type: string | null;
            target_id: string | null;
            before_data: Record<string, unknown> | null;
            after_data: Record<string, unknown> | null;
            created_at: string;
          }>).map((r) => ({
            id: r.id,
            timestamp: r.created_at,
            actorName: r.actor_name,
            actorRole: r.actor_role,
            action: r.action,
            targetType: r.target_type ?? "",
            targetId: r.target_id ?? "",
            before: r.before_data,
            after: r.after_data,
          })),
        );
      }
      setLoading(false);
    }
    void load();
  }, [supabase]);

  useEffect(() => {
    if (AUTH_BYPASS_ENABLED) return;

    async function loadSignatures() {
      setLoadingSignatures(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCanViewSignatures(false);
        setLoadingSignatures(false);
        return;
      }

      const { data: currentProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle<{ role: string }>();
      const ownerAdmin = currentProfile?.role === "owner" || currentProfile?.role === "admin";
      setCanViewSignatures(ownerAdmin);
      if (!ownerAdmin) {
        setSignatureEntries([]);
        setLoadingSignatures(false);
        return;
      }

      const [{ data: gpsRows }, { data: safetyRows }] = await Promise.all([
        supabase
          .from("worker_location_consents")
          .select("id, worker_id, signed_name, consented, consent_version, user_agent, signed_at")
          .order("signed_at", { ascending: false })
          .limit(100),
        supabase
          .from("safety_acknowledgements")
          .select("id, worker_id, project_id, safety_version, acknowledged_at, check_in_event_id")
          .order("acknowledged_at", { ascending: false })
          .limit(100),
      ]);

      const workerIds = new Set<string>();
      const projectIds = new Set<string>();
      for (const row of (gpsRows ?? []) as Array<{ worker_id: string }>) {
        workerIds.add(row.worker_id);
      }
      for (const row of (safetyRows ?? []) as Array<{ worker_id: string; project_id: string | null }>) {
        workerIds.add(row.worker_id);
        if (row.project_id) projectIds.add(row.project_id);
      }

      const [{ data: profiles }, { data: projects }] = await Promise.all([
        workerIds.size > 0
          ? supabase.from("profiles").select("id, name").in("id", [...workerIds])
          : Promise.resolve({ data: [] }),
        projectIds.size > 0
          ? supabase.from("projects").select("id, name").in("id", [...projectIds])
          : Promise.resolve({ data: [] }),
      ]);
      const profileNameById = new Map(
        ((profiles ?? []) as Array<{ id: string; name: string | null }>).map((profile) => [
          profile.id,
          profile.name ?? profile.id.slice(0, 8),
        ]),
      );
      const projectNameById = new Map(
        ((projects ?? []) as Array<{ id: string; name: string | null }>).map((project) => [
          project.id,
          project.name ?? project.id.slice(0, 8),
        ]),
      );

      const gpsEntries = ((gpsRows ?? []) as Array<{
        id: string;
        worker_id: string;
        signed_name: string;
        consented: boolean;
        consent_version: number;
        user_agent: string | null;
        signed_at: string;
      }>).map((row): SignatureEntry => ({
        id: row.id,
        type: "gps",
        workerName: profileNameById.get(row.worker_id) ?? row.worker_id.slice(0, 8),
        signedName: row.signed_name,
        version: String(row.consent_version),
        status: row.consented ? "accepted" : "skipped",
        timestamp: row.signed_at,
        context: "GPS sharing",
        userAgent: row.user_agent ?? "",
      }));
      const safetyEntries = ((safetyRows ?? []) as Array<{
        id: string;
        worker_id: string;
        project_id: string | null;
        safety_version: string;
        acknowledged_at: string;
        check_in_event_id: string | null;
      }>).map((row): SignatureEntry => ({
        id: row.id,
        type: "safety",
        workerName: profileNameById.get(row.worker_id) ?? row.worker_id.slice(0, 8),
        signedName: profileNameById.get(row.worker_id) ?? row.worker_id.slice(0, 8),
        version: row.safety_version,
        status: "acknowledged",
        timestamp: row.acknowledged_at,
        context: row.project_id ? projectNameById.get(row.project_id) ?? row.project_id.slice(0, 8) : "Safety brief",
        userAgent: row.check_in_event_id ? `check_in_event:${row.check_in_event_id.slice(0, 8)}` : "",
      }));

      setSignatureEntries(
        [...gpsEntries, ...safetyEntries].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
      );
      setLoadingSignatures(false);
    }

    void loadSignatures();
  }, [supabase]);

  const filtered = useMemo(() => {
    if (!filterAction) return entries;
    return entries.filter((e) => e.action === filterAction);
  }, [entries, filterAction]);

  const actionTypes = useMemo(() => {
    return [...new Set(entries.map((e) => e.action))];
  }, [entries]);

  function exportCsv() {
    const headers = "Timestamp,Actor,Role,Action,Target Type,Target ID";
    const rows = filtered.map((e) => `"${e.timestamp}","${e.actorName}","${humanizeRole(e.actorRole, locale)}","${humanizeAction(e.action, locale)}","${e.targetType}","${e.targetId}"`);
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportSignatureCsv() {
    const headers = "Timestamp,Type,Worker,Signed Name,Status,Version,Context,User Agent";
    const rows = signatureEntries.map((entry) =>
      [
        entry.timestamp,
        entry.type,
        entry.workerName,
        entry.signedName,
        entry.status,
        entry.version,
        entry.context,
        entry.userAgent,
      ]
        .map((cell) => `"${cell.replaceAll('"', '""')}"`)
        .join(","),
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "gps-safety-signatures.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("audit.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("audit.title")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("audit.description")}
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          <option value="">{t("timeline.allEventTypes")}</option>
          {actionTypes.map((a) => (
            <option key={a} value={a}>{humanizeAction(a, locale)}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
        >
          <Download size={13} />
          {t("payroll.exportCsv")}
        </button>
        <span
          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {t("owner.only")}
        </span>
      </section>

      {canViewSignatures ? (
        <section className="surface-card space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("audit.signaturesTitle")}
              </h2>
              <p className="mt-1 max-w-[70ch] text-sm leading-6 text-[var(--text-secondary)]">
                {t("audit.signaturesDescription")}
              </p>
            </div>
            <button
              type="button"
              onClick={exportSignatureCsv}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              <Download size={13} />
              {t("payroll.exportCsv")}
            </button>
          </div>
          {loadingSignatures ? (
            <div className="py-6 text-center text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
          ) : signatureEntries.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-4 text-sm text-[var(--text-secondary)]">
              {t("audit.signaturesEmpty")}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr
                    className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
                    style={{ borderBottom: "1px solid var(--border-default)" }}
                  >
                    <th className="pb-3 pr-3 font-semibold">{t("audit.timestamp")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("audit.signaturesType")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("audit.worker")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("audit.signedName")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("audit.version")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("audit.status")}</th>
                    <th className="pb-3 font-semibold">{t("audit.context")}</th>
                  </tr>
                </thead>
                <tbody>
                  {signatureEntries.map((entry) => (
                    <tr key={`${entry.type}-${entry.id}`} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                        {formatDateTime(entry.timestamp)}
                      </td>
                      <td className="py-3 pr-3 text-sm font-semibold text-[var(--text-primary)]">
                        {entry.type === "gps" ? t("audit.gpsConsent") : t("audit.safetyAck")}
                      </td>
                      <td className="py-3 pr-3 text-[var(--text-primary)]">{entry.workerName}</td>
                      <td className="py-3 pr-3 text-[var(--text-secondary)]">{entry.signedName}</td>
                      <td className="py-3 pr-3 font-mono text-xs text-[var(--text-muted)]">{entry.version}</td>
                      <td className="py-3 pr-3">
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                          style={{
                            background:
                              entry.status === "skipped"
                                ? "rgba(245, 158, 11, 0.14)"
                                : "rgba(15, 168, 120, 0.14)",
                            color: entry.status === "skipped" ? "#f59e0b" : "var(--green)",
                          }}
                        >
                          {entry.status === "skipped"
                            ? t("audit.skipped")
                            : entry.status === "accepted"
                              ? t("audit.accepted")
                              : t("audit.acknowledged")}
                        </span>
                      </td>
                      <td className="py-3 text-xs text-[var(--text-muted)]">{entry.context}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="surface-card overflow-x-auto p-4">
        {loading ? (
          <div className="py-8 text-center text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr
                className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
                style={{ borderBottom: "1px solid var(--border-default)" }}
              >
                <th className="pb-3 pr-3 font-semibold">{t("audit.timestamp")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("audit.actor")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("audit.action")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("audit.target")}</th>
                <th className="pb-3 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-sm text-[var(--text-secondary)]">
                    <div className="flex flex-col items-center gap-2">
                      <ClipboardList
                        size={36}
                        className="text-[var(--text-muted)]"
                        strokeWidth={1.5}
                      />
                      <span>{t("audit.empty")}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((entry) => {
                  const color = ACTION_COLORS[entry.action] ?? "var(--text-muted)";
                  const expanded = expandedId === entry.id;
                  const after = entry.after ?? {};
                  const externalPayment = after.external_payment &&
                    typeof after.external_payment === "object" &&
                    !Array.isArray(after.external_payment)
                    ? after.external_payment as Record<string, unknown>
                    : null;
                  const payrollSummary = entry.action.startsWith("payroll_")
                    ? t("audit.payrollSummary")
                        .replace("{workers}", String(numberValue(after.worker_count) ?? 0))
                        .replace("{hours}", String(numberValue(after.total_hours) ?? 0))
                        .replace("{total}", currency.format(numberValue(after.net_total) ?? 0))
                        .replace("{ref}", stringValue(externalPayment?.reference) ?? "—")
                    : null;
                  return (
                    <tr key={entry.id} className="border-b border-[var(--border-subtle)]">
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                        {formatDateTime(entry.timestamp)}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="text-sm font-semibold text-[var(--text-primary)]">{entry.actorName}</div>
                        <span
                          className="mt-0.5 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
                        >
                          {humanizeRole(entry.actorRole, locale)}
                        </span>
                      </td>
                      <td className="py-3 pr-3">
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
                        >
                          {humanizeAction(entry.action, locale)}
                        </span>
                        {payrollSummary ? (
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {payrollSummary}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3 text-xs text-[var(--text-muted)]">
                        {entry.targetType}{entry.targetId ? `:${entry.targetId.slice(0, 8)}` : ""}
                      </td>
                      <td className="py-3">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : entry.id)}
                          className="text-xs font-semibold text-[var(--brand-yellow)]"
                        >
                          {expanded ? "−" : "+"}
                        </button>
                        {expanded && (entry.before || entry.after) ? (
                          <div className="mt-2 space-y-1 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2 font-mono text-[10px] text-[var(--text-muted)]">
                            {entry.before ? (
                              <div>
                                <span className="text-[var(--red)]">- </span>
                                {JSON.stringify(entry.before, null, 2)}
                              </div>
                            ) : null}
                            {entry.after ? (
                              <div>
                                <span className="text-[var(--green)]">+ </span>
                                {JSON.stringify(entry.after, null, 2)}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
