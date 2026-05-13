import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireManagerContext } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import type { Profile } from "@/types/database";

type PayPeriodRow = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  status: string;
  approved_by: string | null;
  paid_at: string | null;
};

type PayPeriodItemRow = {
  pay_period_id: string;
  worker_id: string;
  gross_total: number;
};

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const COPY = {
  en: {
    dateRange: "Date range",
    from: "From",
    to: "To",
    apply: "Apply",
    clear: "Clear",
    showing: "periods shown",
  },
  ru: {
    dateRange: "Диапазон дат",
    from: "От",
    to: "До",
    apply: "Показать",
    clear: "Сбросить",
    showing: "периодов показано",
  },
} as const;

function statusColor(status: string): string {
  if (status === "paid") return "var(--green)";
  if (status === "approved") return "var(--brand-yellow)";
  return "var(--text-muted)";
}

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default async function PayrollHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const text = COPY[locale];
  const params = await searchParams;
  const fromRaw = readParam(params.from);
  const toRaw = readParam(params.to);
  const from = isValidDateString(fromRaw) ? fromRaw : "";
  const to = isValidDateString(toRaw) ? toRaw : "";

  const supabase = await createClient();
  const { profile, org } = await requireManagerContext(supabase);
  const allowed = await hasFinanceAccess(supabase, {
    id: profile.id,
    role: profile.role,
  });
  if (!allowed) redirect("/overview");

  const { data: periodRows } = await supabase
    .from("pay_periods")
    .select("id, label, start_date, end_date, status, approved_by, paid_at")
    .eq("org_id", org.id)
    .order("end_date", { ascending: false })
    .returns<PayPeriodRow[]>();

  const periods = (periodRows ?? []).filter((period) => {
    if (from && period.end_date < from) return false;
    if (to && period.start_date > to) return false;
    return true;
  });

  const periodIds = periods.map((p) => p.id);
  const { data: itemRows } = periodIds.length > 0
    ? await supabase
        .from("pay_period_items")
        .select("pay_period_id, worker_id, gross_total")
        .in("pay_period_id", periodIds)
        .returns<PayPeriodItemRow[]>()
    : { data: [] as PayPeriodItemRow[] };

  const totalsByPeriod = new Map<string, { workers: Set<string>; gross: number }>();
  for (const item of itemRows ?? []) {
    const entry = totalsByPeriod.get(item.pay_period_id) ?? { workers: new Set<string>(), gross: 0 };
    entry.workers.add(item.worker_id);
    entry.gross += Number(item.gross_total);
    totalsByPeriod.set(item.pay_period_id, entry);
  }

  const approverIds = [...new Set(periods.map((p) => p.approved_by).filter(Boolean) as string[])];
  const { data: approverRows } = approverIds.length > 0
    ? await supabase
        .from("profiles")
        .select("id, name")
        .in("id", approverIds)
        .returns<Pick<Profile, "id" | "name">[]>()
    : { data: [] as Pick<Profile, "id" | "name">[] };
  const approverNames = new Map((approverRows ?? []).map((a) => [a.id, a.name]));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("payroll.title")}
        </p>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
            {t("payroll.history")}
          </h1>
          <Link
            href="/payroll"
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            ← {t("payroll.title")}
          </Link>
        </div>
      </section>

      <section className="surface-card p-4">
        <form className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {text.dateRange}
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {periods.length} {text.showing}
            </div>
          </div>
          <label className="block min-w-[180px]">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {text.from}
            </span>
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="block min-w-[180px]">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {text.to}
            </span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
          >
            {text.apply}
          </button>
          <Link
            href="/payroll/history"
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {text.clear}
          </Link>
        </form>
      </section>

      <section className="surface-card overflow-x-auto p-4">
        {periods.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-secondary)]">
            {t("payroll.emptyHeadline")}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.startDate")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.endDate")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.status")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.workers")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.grossPay")}</th>
                <th className="pb-3 pr-3 font-semibold">{t("payroll.approvedBy")}</th>
                <th className="pb-3 font-semibold">{t("payroll.paidOn")}</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => {
                const totals = totalsByPeriod.get(p.id);
                const approverName = p.approved_by ? approverNames.get(p.approved_by) ?? "—" : "—";
                const paidLabel = p.paid_at ? p.paid_at.slice(0, 10) : "—";
                return (
                  <tr key={p.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-primary)]">
                    <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      <Link href={`/payroll?period=${p.id}`} className="block">
                        {p.start_date}
                      </Link>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      <Link href={`/payroll?period=${p.id}`} className="block">
                        {p.end_date}
                      </Link>
                    </td>
                    <td className="py-3 pr-3">
                      <span
                        className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style={{
                          background: `color-mix(in srgb, ${statusColor(p.status)} 16%, transparent)`,
                          color: statusColor(p.status),
                        }}
                      >
                        {t(`payroll.${p.status}` as Parameters<typeof t>[0])}
                      </span>
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap font-mono text-[var(--text-primary)]">
                      {totals?.workers.size ?? 0}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap font-mono font-semibold text-[var(--text-primary)]">
                      {currency.format(totals?.gross ?? 0)}
                    </td>
                    <td className="py-3 pr-3 whitespace-nowrap text-[var(--text-secondary)]">
                      {approverName}
                    </td>
                    <td className="py-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      {paidLabel}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
