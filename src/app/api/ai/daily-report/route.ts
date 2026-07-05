import { NextRequest, NextResponse } from "next/server";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { generateDailyReport, formatOrgDateKey, getTodayInOrgTimeZone } from "@/lib/ai/service";
import { buildManagerSessions, isOpenTask } from "@/lib/manager-utils";
import { createClient } from "@/lib/supabase/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import {
  createPaidApiLimitGuard,
  isPaidApiLimitError,
  paidApiLimitResponse,
} from "@/lib/paid-api-limits";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DailyReport } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const reportDate =
      typeof body.reportDate === "string" && body.reportDate ? body.reportDate : getTodayInOrgTimeZone();
    const projectId =
      typeof body.projectId === "string" && body.projectId ? body.projectId : null;
    const data =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const sessions = buildManagerSessions(data).filter((session) => {
      if (projectId && session.projectId !== projectId) {
        return false;
      }

      return formatOrgDateKey(session.clockInTime) === reportDate;
    });
    const media = data.media.filter((item) => {
      if (projectId && item.project_id !== projectId) {
        return false;
      }

      return formatOrgDateKey(item.created_at) === reportDate;
    });
    const completedTasks = data.tasks.filter((task) => {
      if (task.deleted_at) {
        return false;
      }

      if (projectId && task.project_id !== projectId) {
        return false;
      }

      return Boolean(task.completed_at) && formatOrgDateKey(task.completed_at as string) === reportDate;
    });
    const openTasks = data.tasks.filter((task) => {
      if (projectId && task.project_id !== projectId) {
        return false;
      }

      return isOpenTask(task);
    });
    const projectName =
      projectId
        ? data.projects.find((project) => project.id === projectId)?.name ?? "Unknown project"
        : "All Projects";
    const limitIdentity = auth.kind === "authenticated"
      ? {
          orgId: auth.context.profile.org_id,
          profileId: auth.context.profile.id,
        }
      : {
          orgId: data.org.id,
          profileId: data.manager.id,
        };
    const report = await generateDailyReport({
      reportDate,
      projectId,
      projectName,
      workerNames: [...new Set(sessions.map((session) => session.profileName))],
      hoursWorked: sessions.reduce((sum, session) => sum + session.durationMinutes, 0) / 60,
      photosTaken: media.length,
      eventCount: sessions.reduce((sum, session) => sum + session.eventIds.length, 0),
      completedTasks: completedTasks.map((task) => task.title),
      openTasks: openTasks.map((task) => task.title),
      mediaCaptions: media
        .map((item) => item.caption?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 5),
    }, {
      beforeProviderCall: createPaidApiLimitGuard({
        adminClient: auth.kind === "authenticated" ? createAdminClient() : null,
        route: "/api/ai/daily-report",
        ...limitIdentity,
      }),
    });

    let savedReportId: string | null = null;
    if (auth.kind === "authenticated") {
      const reportInsert = await supabase
        .from("daily_reports")
        .insert({
          org_id: auth.context.profile.org_id,
          project_id: projectId,
          profile_id: null,
          report_date: reportDate,
          summary: report.summary,
          hours_worked: report.laborSignal ? sessions.reduce((sum, session) => sum + session.durationMinutes, 0) / 60 : 0,
          tasks_completed: completedTasks.length,
          photos_taken: media.length,
          ai_insights: report,
          event_ids: sessions.flatMap((session) => session.eventIds),
          media_ids: media.map((item) => item.id),
          metadata: {
            headline: report.headline,
            nextActions: report.nextActions,
            source: report.source,
          },
        })
        .select("*")
        .single<DailyReport>();

      assertNoError(reportInsert.error, "Daily report insert failed");
      savedReportId = reportInsert.data?.id ?? null;
    }

    return NextResponse.json({
      ok: true,
      report,
      savedReportId,
    });
  } catch (error) {
    if (isPaidApiLimitError(error)) {
      return paidApiLimitResponse(error.result);
    }
    return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
  }
}
