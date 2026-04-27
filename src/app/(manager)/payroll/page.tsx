import { getPayrollPageData } from "@/lib/manager-data";
import { buildManagerSessions } from "@/lib/manager-utils";
import { PayrollCalculator } from "@/components/manager/PayrollCalculator";
import { getServerLocale, serverT } from "@/lib/i18n/server";

export const revalidate = 30;

export default async function PayrollPage() {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getPayrollPageData();
  const sessions = buildManagerSessions(data);

  // Map session id → whether its clock_in event captured GPS. Lets the
  // payroll UI surface "no-GPS hours" without bundling raw time_events
  // to the client.
  const gpsByEventId = new Map<string, boolean>();
  for (const event of data.timeEvents) {
    if (event.event_type === "clock_in") {
      gpsByEventId.set(event.id, event.gps_point != null);
    }
  }
  const hasGpsBySessionId: Record<string, boolean> = {};
  for (const session of sessions) {
    hasGpsBySessionId[session.id] = gpsByEventId.get(session.clockInEventId) ?? false;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("payroll.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("payroll.subtitle")}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("payroll.description")}
        </p>
      </section>

      <PayrollCalculator
        orgId={data.manager.org_id}
        managerId={data.manager.id}
        managerName={data.manager.name}
        managerRole={data.manager.role}
        profiles={data.profiles}
        sessions={sessions}
        hasGpsBySessionId={hasGpsBySessionId}
      />
    </div>
  );
}
