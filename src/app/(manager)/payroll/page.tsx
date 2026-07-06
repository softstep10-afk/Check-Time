import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPayrollPageData } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import { buildManagerSessions } from "@/lib/manager-utils";
import { buildShiftReviewAckEventIds } from "@/lib/shift-review";
import { PayrollCalculator } from "@/components/manager/PayrollCalculator";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { isGpsWarningSuppressedForProject } from "@/lib/driver-time-projects";
import PayrollLoading from "./loading";

export const revalidate = 30;

// The manager layout chrome paints immediately; the payroll query batch streams
// into this Suspense boundary, reusing the route skeleton. The finance-access
// redirect stays inside the async body, so it fires while the skeleton is shown —
// same as the existing loading.tsx behavior. Data/computation unchanged.
export default function PayrollPage() {
  return (
    <Suspense fallback={<PayrollLoading />}>
      <PayrollPageData />
    </Suspense>
  );
}

async function PayrollPageData() {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getPayrollPageData();
  const supabase = await createClient();
  const allowed = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  if (!allowed) redirect("/overview");

  const sessions = buildManagerSessions(data);
  const acknowledgedShiftEventIds = [...buildShiftReviewAckEventIds(data.timeEvents)];

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
  const projectById = new Map(data.projects.map((project) => [project.id, project]));
  for (const session of sessions) {
    hasGpsBySessionId[session.id] =
      (gpsByEventId.get(session.clockInEventId) ?? false) ||
      isGpsWarningSuppressedForProject(projectById.get(session.projectId));
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("payroll.title")}
          </p>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
            {t("payroll.subtitle")}
          </h1>
          <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
            {t("payroll.description")}
          </p>
        </div>
        <Link href="/reports/annual" className="button-base button-secondary px-3 py-2 text-sm">
          {t("report.title")}
        </Link>
      </section>

      <PayrollCalculator
        orgId={data.manager.org_id}
        managerId={data.manager.id}
        managerName={data.manager.name}
        managerRole={data.manager.role}
        showFinancialFields={allowed}
        profiles={data.profiles}
        sessions={sessions}
        hasGpsBySessionId={hasGpsBySessionId}
        acknowledgedShiftEventIds={acknowledgedShiftEventIds}
        payrollClosures={data.payrollClosures}
      />
    </div>
  );
}
