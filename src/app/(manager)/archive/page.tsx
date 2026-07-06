import { Suspense } from "react";
import { ArchivePage } from "@/components/manager/ArchivePage";
import {
  buildArchivedProjectRows,
  buildPaidPayrollArchive,
} from "@/lib/archive-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getArchivePageData } from "@/lib/manager-data";
import { buildManagerSessions } from "@/lib/manager-utils";
import { createClient } from "@/lib/supabase/server";
import ArchiveLoading from "./loading";

export const revalidate = 0;

// The manager layout chrome paints immediately; the archive query batch streams
// into this Suspense boundary. Data/computation unchanged — only delivery timing.
export default function ArchiveRoutePage() {
  return (
    <Suspense fallback={<ArchiveLoading />}>
      <ArchiveRouteContent />
    </Suspense>
  );
}

async function ArchiveRouteContent() {
  const data = await getArchivePageData();
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const sessions = buildManagerSessions(data);
  const archivedProjects = buildArchivedProjectRows({
    projects: data.projects,
    tasks: data.tasks,
    media: data.media,
    sessions,
    assignments: data.assignments,
    includeFinancials: managerHasFinanceAccess,
  });
  const payrollArchive = managerHasFinanceAccess
    ? buildPaidPayrollArchive(
        {
          profiles: data.profiles,
          projects: data.projects,
          payPeriods: data.payPeriods,
          payPeriodItems: data.payPeriodItems,
          payrollRuns: data.payrollRuns,
          payrollLineItems: data.payrollLineItems,
          sessions,
        },
        { includeFinancials: true },
      )
    : { rows: [], years: [], totalPaidHours: 0, totalGrossPaid: 0 };

  return (
    <ArchivePage
      archivedProjects={archivedProjects}
      payrollArchive={payrollArchive}
      hasFinanceAccess={managerHasFinanceAccess}
    />
  );
}
