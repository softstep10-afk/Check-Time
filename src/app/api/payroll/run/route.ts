import { NextRequest, NextResponse } from "next/server";
import { buildManagerSessions, computePayrollPreview } from "@/lib/manager-utils";
import { requireManagerContext } from "@/lib/manager-data";
import { isGpsWarningSuppressedForProject } from "@/lib/driver-time-projects";
import {
  loadProfilesWithRatesForFinance,
  resolveProfileRateAccess,
} from "@/lib/profile-rates";
import {
  buildShiftReviewAckEventIds,
  deriveShiftReview,
  isShiftActionable,
} from "@/lib/shift-review";
import { createClient } from "@/lib/supabase/server";
import type {
  PayrollClosure,
  PayrollRun,
  Project,
  TimeEvent,
} from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile, org } = await requireManagerContext(supabase);
    const profileRateAccess = await resolveProfileRateAccess(supabase, {
      id: profile.id,
      role: profile.role,
    });
    if (!profileRateAccess.allowed) {
      return NextResponse.json(
        { error: "Finance access is required to run payroll." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const periodEnd =
      typeof body.periodEnd === "string" && body.periodEnd ? body.periodEnd : undefined;
    const notes = typeof body.notes === "string" ? body.notes.trim() : null;

    const [profilesResult, projectsResult, timeEventsResult, closuresResult] =
      await Promise.all([
        loadProfilesWithRatesForFinance(supabase, profileRateAccess),
        supabase.from("projects").select("*").returns<Project[]>(),
        supabase
          .from("time_events")
          .select("*")
          .order("event_time", { ascending: false })
          .range(0, 4999)
          .returns<TimeEvent[]>(),
        supabase
          .from("payroll_closures")
          .select("*")
          .order("closed_through", { ascending: false })
          .range(0, 999)
          .returns<PayrollClosure[]>(),
      ]);

    assertNoError(profilesResult.error, "Profiles query failed");
    assertNoError(projectsResult.error, "Projects query failed");
    assertNoError(timeEventsResult.error, "Time events query failed");
    assertNoError(closuresResult.error, "Payroll closures query failed");

    const workspace: ManagerWorkspaceData = {
      manager: profile,
      org,
      profiles: profilesResult.data ?? [],
      projects: projectsResult.data ?? [],
      assignments: [],
      tasks: [],
      timeEvents: timeEventsResult.data ?? [],
      media: [],
      payrollRuns: [],
      payrollClosures: closuresResult.data ?? [],
      storeVisits: [],
    };

    const sessions = buildManagerSessions(workspace);
    const preview = computePayrollPreview(workspace, sessions, periodEnd);

    if (preview.lines.length === 0) {
      return NextResponse.json(
        { error: "No unpaid hours found for the selected period." },
        { status: 400 },
      );
    }

    const payableEventIds = new Set(preview.lines.flatMap((line) => line.eventIds));
    const acknowledgedShiftEventIds = buildShiftReviewAckEventIds(workspace.timeEvents);
    const profilesById = new Map(workspace.profiles.map((entry) => [entry.id, entry]));
    const projectsById = new Map(workspace.projects.map((entry) => [entry.id, entry]));
    const clockInById = new Map(
      workspace.timeEvents
        .filter((event) => event.event_type === "clock_in")
        .map((event) => [event.id, event]),
    );
    const unreviewedWorkers = new Set<string>();
    for (const session of sessions) {
      if (session.isOpen || !session.clockOutEventId) continue;
      if (!payableEventIds.has(session.clockOutEventId)) continue;
      if (acknowledgedShiftEventIds.has(session.clockOutEventId)) continue;
      const worker = profilesById.get(session.profileId);
      const clockIn = clockInById.get(session.clockInEventId);
      const review = deriveShiftReview({
        isOpen: false,
        durationMinutes: session.durationMinutes,
        hadGpsAtClockIn: clockIn?.gps_point != null,
        gpsWarningSuppressed: isGpsWarningSuppressedForProject(
          projectsById.get(session.projectId),
        ),
        gpsFreshness: null,
        requireVideo: worker?.require_video ?? false,
        videoStatus: session.checkoutStatus,
      });
      if (isShiftActionable(review)) {
        unreviewedWorkers.add(session.profileName);
      }
    }
    if (unreviewedWorkers.size > 0) {
      return NextResponse.json(
        {
          error: `Review suspicious shifts before payroll: ${[...unreviewedWorkers].join(", ")}`,
        },
        { status: 409 },
      );
    }

    const periodStartDate = preview.periodStart.slice(0, 10);
    const periodEndDate = preview.periodEnd.slice(0, 10);

    const { data: payrollRun, error: payrollRunError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id: profile.org_id,
        run_by: profile.id,
        period_start: periodStartDate,
        period_end: periodEndDate,
        status: "draft",
        total_hours: preview.totalHours,
        total_amount: preview.totalAmount,
        notes,
        metadata: {
          createdFrom: "manager-dashboard",
        },
      })
      .select("*")
      .single<PayrollRun>();

    assertNoError(payrollRunError, "Payroll run insert failed");

    if (!payrollRun) {
      throw new Error("Payroll run insert returned no row.");
    }

    const { error: lineItemsError } = await supabase.from("payroll_line_items").insert(
      preview.lines.map((line) => ({
        payroll_run_id: payrollRun.id,
        profile_id: line.profileId,
        project_id: line.projectId,
        hours: line.hours,
        rate: line.rate,
        amount: line.amount,
        event_ids: line.eventIds,
        metadata: {
          session_ids: line.sessionIds,
        },
      })),
    );

    assertNoError(lineItemsError, "Payroll line items insert failed");

    const { error: closuresInsertError } = await supabase.from("payroll_closures").insert(
      preview.workerTotals.map((worker) => ({
        org_id: profile.org_id,
        payroll_run_id: payrollRun.id,
        profile_id: worker.profileId,
        closed_through: preview.periodEnd,
      })),
    );

    assertNoError(closuresInsertError, "Payroll closures insert failed");

    const { error: finalizeError } = await supabase
      .from("payroll_runs")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", payrollRun.id);

    assertNoError(finalizeError, "Payroll run finalize failed");

    return NextResponse.json({ ok: true, payrollRunId: payrollRun.id });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
