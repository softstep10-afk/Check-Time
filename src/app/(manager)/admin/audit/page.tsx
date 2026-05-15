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
