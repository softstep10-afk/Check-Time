import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { requireManagerContext } from "@/lib/manager-data";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import { buildManagerSessions, computePayrollPreview } from "@/lib/manager-utils";
import { buildPayrollActionAuditPayload } from "@/lib/payroll-audit-utils";
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

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile: manager, org } = await requireManagerContext(supabase);
    const profileRateAccess = await resolveProfileRateAccess(supabase, {
      id: manager.id,
      role: manager.role,
    });

    if (!profileRateAccess.allowed) {
      return NextResponse.json(
        { error: "Finance access is required to pay a worker." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const workerId = typeof body.workerId === "string" ? body.workerId : "";
    const periodEnd =
      typeof body.periodEnd === "string" && body.periodEnd ? body.periodEnd : undefined;

    if (!workerId) {
      return NextResponse.json({ error: "workerId is required." }, { status: 400 });
    }

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

    const targetProfile = (profilesResult.data ?? []).find((entry) => entry.id === workerId);
    if (!targetProfile) {
      return NextResponse.json({ error: "Worker profile was not found." }, { status: 404 });
    }

    const workspace: ManagerWorkspaceData = {
      manager,
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

    const workerSessions = buildManagerSessions(workspace)
      .filter((session) => session.profileId === workerId);
    const preview = computePayrollPreview(workspace, workerSessions, periodEnd);

    if (preview.lines.length === 0) {
      return NextResponse.json(
        { error: "No unpaid hours found for this worker." },
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
    const unreviewedSessions: string[] = [];

    for (const session of workerSessions) {
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
        unreviewedSessions.push(session.projectName);
      }
    }

    if (unreviewedSessions.length > 0) {
      const reviewProjects = [...new Set(unreviewedSessions)];
      return NextResponse.json(
        {
          error: "unreviewed_shifts",
          reviewProjects,
        },
        { status: 409 },
      );
    }

    const periodStartDate = preview.periodStart.slice(0, 10);
    const periodEndDate = preview.periodEnd.slice(0, 10);
    const paidAt = new Date().toISOString();

    const { data: payrollRun, error: payrollRunError } = await supabase
      .from("payroll_runs")
      .insert({
        org_id: manager.org_id,
        run_by: manager.id,
        period_start: periodStartDate,
        period_end: periodEndDate,
        status: "draft",
        total_hours: preview.totalHours,
        total_amount: preview.totalAmount,
        notes: "Worker payment closed from Team member profile.",
        metadata: {
          createdFrom: "team-member-payoff",
          workerProfileId: workerId,
          external_payment: {
            provider: "BigBooks",
            reference: null,
            worker_ids: [workerId],
            recorded_at: paidAt,
            recorded_by: manager.id,
          },
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
          created_from: "team-member-payoff",
        },
      })),
    );

    assertNoError(lineItemsError, "Payroll line items insert failed");

    const { error: closuresInsertError } = await supabase.from("payroll_closures").insert(
      preview.workerTotals.map((worker) => ({
        org_id: manager.org_id,
        payroll_run_id: payrollRun.id,
        profile_id: worker.profileId,
        closed_through: preview.periodEnd,
      })),
    );

    assertNoError(closuresInsertError, "Payroll closures insert failed");

    const { error: finalizeError } = await supabase
      .from("payroll_runs")
      .update({
        status: "paid",
        confirmed_at: paidAt,
      })
      .eq("id", payrollRun.id);

    assertNoError(finalizeError, "Payroll run finalize failed");

    await logAuditServer(supabase, {
      orgId: manager.org_id,
      actorId: manager.id,
      actorName: manager.name,
      actorRole: manager.role,
      action: "payroll_paid",
      targetType: "payroll_run",
      targetId: payrollRun.id,
      afterData: buildPayrollActionAuditPayload({
        period: {
          id: payrollRun.id,
          label: `${periodStartDate} → ${periodEndDate}`,
          startDate: periodStartDate,
          endDate: periodEndDate,
          status: "paid",
        },
        lines: preview.workerTotals.map((worker) => ({
          workerId: worker.profileId,
          workerName: worker.profileName,
          workerRole: worker.profileRole,
          status: "paid",
          regularHours: worker.hours,
          overtimeHours: 0,
          grossTotal: worker.amount,
          netTotal: worker.amount,
          projectNames: [...new Set(worker.lines.map((line) => line.projectName))],
        })),
        workerIds: [workerId],
        externalPayment: {
          provider: "BigBooks",
          reference: null,
          worker_ids: [workerId],
          recorded_at: paidAt,
          recorded_by: manager.id,
        },
      }),
    });

    return NextResponse.json({
      ok: true,
      payrollRunId: payrollRun.id,
      periodStart: periodStartDate,
      periodEnd: periodEndDate,
      totalHours: r2(preview.totalHours),
      totalAmount: r2(preview.totalAmount),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("payroll_overlap") ? 409 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
