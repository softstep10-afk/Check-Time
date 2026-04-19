import "server-only";

import { cache } from "react";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewDailyReports } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import type { DailyReport } from "@/types/database";
import type { AiWorkspaceData } from "@/lib/ai/types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export const getAiWorkspaceData = cache(async (): Promise<AiWorkspaceData> => {
  const base = await getManagerWorkspaceData();
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return {
      ...base,
      dailyReports: buildPreviewDailyReports(),
    };
  }

  const reportsResult = await supabase
    .from("daily_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .range(0, 49)
    .returns<DailyReport[]>();

  assertNoError(reportsResult.error, "Daily reports query failed");

  return {
    manager: base.manager,
    org: base.org,
    projects: base.projects,
    profiles: base.profiles,
    tasks: base.tasks,
    timeEvents: base.timeEvents,
    media: base.media,
    dailyReports: reportsResult.data ?? [],
  };
});
