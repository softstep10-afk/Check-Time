import { getManagerWorkspaceData } from "@/lib/manager-data";
import { buildManagerSessions } from "@/lib/manager-utils";
import { PayrollCalculator } from "@/components/manager/PayrollCalculator";
import { getServerLocale, serverT } from "@/lib/i18n/server";

export default async function PayrollPage() {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);

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
      />
    </div>
  );
}
