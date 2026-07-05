import { NextRequest, NextResponse } from "next/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import { requireManagerContext } from "@/lib/manager-data";
import { logAuditServer } from "@/lib/audit-server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { TimeEvent } from "@/types/database";

const SHIFT_EVENT_TYPES = ["clock_in", "clock_out", "auto_out"] as const;

type ShiftEventRow = Pick<TimeEvent, "id" | "event_type" | "event_time">;

function parseIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

type Interval = { inMs: number; outMs: number | null };

/**
 * Reconstruct a worker's shift intervals from their raw clock events, so the
 * edited/created window can be overlap-checked against neighbors. Open shifts
 * (a clock_in with no closer) become [in, +inf).
 */
function buildIntervals(events: ShiftEventRow[], excludeIds: Set<string>): Interval[] {
  const ordered = events
    .filter((event) => !excludeIds.has(event.id))
    .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());

  const intervals: Interval[] = [];
  let openInMs: number | null = null;
  for (const event of ordered) {
    const ms = new Date(event.event_time).getTime();
    if (event.event_type === "clock_in") {
      if (openInMs !== null) intervals.push({ inMs: openInMs, outMs: null });
      openInMs = ms;
    } else {
      if (openInMs !== null) {
        intervals.push({ inMs: openInMs, outMs: ms });
        openInMs = null;
      }
    }
  }
  if (openInMs !== null) intervals.push({ inMs: openInMs, outMs: null });
  return intervals;
}

function overlapsAny(newInMs: number, newOutMs: number, intervals: Interval[]): boolean {
  for (const interval of intervals) {
    const outMs = interval.outMs ?? Number.POSITIVE_INFINITY;
    // Standard half-open interval overlap; touching boundaries are allowed.
    if (newInMs < outMs && interval.inMs < newOutMs) return true;
  }
  return false;
}

async function loadWorkerShiftEvents(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  profileId: string,
): Promise<ShiftEventRow[]> {
  const { data, error } = await admin!
    .from("time_events")
    .select("id, event_type, event_time")
    .eq("org_id", orgId)
    .eq("profile_id", profileId)
    .in("event_type", SHIFT_EVENT_TYPES as unknown as string[])
    .order("event_time", { ascending: true })
    .returns<ShiftEventRow[]>();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile: actor, org } = await requireManagerContext(supabase);
    const allowed = await hasFinanceAccess(supabase, { id: actor.id, role: actor.role });
    if (!allowed) {
      return NextResponse.json(
        { error: "Finance access is required to edit shifts." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Shift editing is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const mode = body.mode === "create" ? "create" : body.mode === "edit" ? "edit" : null;
    if (!mode) {
      return NextResponse.json({ error: "Unknown edit mode." }, { status: 400 });
    }
    const nowIso = new Date().toISOString();

    // ── EDIT ────────────────────────────────────────────────────────────────
    if (mode === "edit") {
      const clockInId = readRequiredUuid(body.clockInEventId, "clock-in id");
      if (!clockInId.ok) {
        return NextResponse.json({ error: clockInId.error }, { status: clockInId.status });
      }

      const { data: clockInEvent, error: inErr } = await admin
        .from("time_events")
        .select("*")
        .eq("id", clockInId.value)
        .eq("org_id", org.id)
        .maybeSingle<TimeEvent>();
      if (inErr) {
        return NextResponse.json({ error: safeClientErrorMessage(inErr) }, { status: 500 });
      }
      if (!clockInEvent || clockInEvent.event_type !== "clock_in") {
        return NextResponse.json({ error: "Shift start not found." }, { status: 404 });
      }

      const workerEvents = await loadWorkerShiftEvents(admin, org.id, clockInEvent.profile_id);

      // Resolve the actual closer of this clock-in (the next clock_out/auto_out
      // after it, chronologically) — trust the ledger, not the client id.
      const orderedAfter = workerEvents
        .filter((event) => new Date(event.event_time).getTime() > new Date(clockInEvent.event_time).getTime())
        .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());
      const closerRow = orderedAfter.find(
        (event) => event.event_type === "clock_out" || event.event_type === "auto_out",
      );
      // A clock_in between this one and its closer would mean it is already open/void.
      const interveningIn = orderedAfter.find((event) => event.event_type === "clock_in");
      if (closerRow && interveningIn && new Date(interveningIn.event_time).getTime() < new Date(closerRow.event_time).getTime()) {
        return NextResponse.json({ error: "Shift has no matching clock-out." }, { status: 409 });
      }
      if (!closerRow) {
        return NextResponse.json({ error: "Open shifts cannot be edited here." }, { status: 409 });
      }

      const { data: clockOutEvent, error: outErr } = await admin
        .from("time_events")
        .select("*")
        .eq("id", closerRow.id)
        .eq("org_id", org.id)
        .maybeSingle<TimeEvent>();
      if (outErr) {
        return NextResponse.json({ error: safeClientErrorMessage(outErr) }, { status: 500 });
      }
      if (!clockOutEvent || clockOutEvent.profile_id !== clockInEvent.profile_id) {
        return NextResponse.json({ error: "Shift end not found." }, { status: 404 });
      }

      const newInIso = body.newClockInTime === undefined ? clockInEvent.event_time : parseIso(body.newClockInTime);
      const newOutIso = body.newClockOutTime === undefined ? clockOutEvent.event_time : parseIso(body.newClockOutTime);
      if (!newInIso || !newOutIso) {
        return NextResponse.json({ error: "Invalid shift time." }, { status: 400 });
      }
      const newInMs = new Date(newInIso).getTime();
      const newOutMs = new Date(newOutIso).getTime();
      if (newOutMs <= newInMs) {
        return NextResponse.json({ error: "Clock-out must be after clock-in." }, { status: 422 });
      }

      const neighborIntervals = buildIntervals(
        workerEvents,
        new Set([clockInEvent.id, clockOutEvent.id]),
      );
      if (overlapsAny(newInMs, newOutMs, neighborIntervals)) {
        return NextResponse.json(
          { error: "Edited shift overlaps another shift for this worker." },
          { status: 422 },
        );
      }

      const inChanged = newInIso !== clockInEvent.event_time;
      const outChanged = newOutIso !== clockOutEvent.event_time;

      if (inChanged) {
        const { error } = await admin
          .from("time_events")
          .update({
            event_time: newInIso,
            metadata: {
              ...(clockInEvent.metadata ?? {}),
              edited_by: actor.id,
              edited_at: nowIso,
              previous_event_time: clockInEvent.event_time,
            },
          })
          .eq("id", clockInEvent.id)
          .eq("org_id", org.id);
        if (error) {
          return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
        }
      }
      if (outChanged) {
        const { error } = await admin
          .from("time_events")
          .update({
            event_time: newOutIso,
            metadata: {
              ...(clockOutEvent.metadata ?? {}),
              edited_by: actor.id,
              edited_at: nowIso,
              previous_event_time: clockOutEvent.event_time,
            },
          })
          .eq("id", clockOutEvent.id)
          .eq("org_id", org.id);
        if (error) {
          return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
        }
      }

      if (inChanged || outChanged) {
        await logAuditServer(supabase, {
          orgId: org.id,
          actorId: actor.id,
          actorName: actor.name,
          actorRole: actor.role,
          action: "shift_edited",
          targetType: "time_event",
          targetId: clockInEvent.id,
          beforeData: {
            worker_id: clockInEvent.profile_id,
            clock_in_time: clockInEvent.event_time,
            clock_out_time: clockOutEvent.event_time,
          },
          afterData: {
            worker_id: clockInEvent.profile_id,
            clock_in_time: newInIso,
            clock_out_time: newOutIso,
          },
        });
      }

      return NextResponse.json({ ok: true, changed: inChanged || outChanged });
    }

    // ── CREATE ────────────────────────────────────────────────────────────────
    const workerId = readRequiredUuid(body.workerId, "worker id");
    if (!workerId.ok) {
      return NextResponse.json({ error: workerId.error }, { status: workerId.status });
    }
    const projectId = readRequiredUuid(body.projectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    const newInIso = parseIso(body.clockInTime);
    const newOutIso = parseIso(body.clockOutTime);
    if (!newInIso || !newOutIso) {
      return NextResponse.json({ error: "Invalid shift time." }, { status: 400 });
    }
    const newInMs = new Date(newInIso).getTime();
    const newOutMs = new Date(newOutIso).getTime();
    if (newOutMs <= newInMs) {
      return NextResponse.json({ error: "Clock-out must be after clock-in." }, { status: 422 });
    }

    const { data: worker, error: workerErr } = await admin
      .from("profiles")
      .select("id, org_id, is_active")
      .eq("id", workerId.value)
      .eq("org_id", org.id)
      .maybeSingle<{ id: string; org_id: string; is_active: boolean }>();
    if (workerErr) {
      return NextResponse.json({ error: safeClientErrorMessage(workerErr) }, { status: 500 });
    }
    if (!worker) {
      return NextResponse.json({ error: "Worker not found." }, { status: 404 });
    }

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .select("id")
      .eq("id", projectId.value)
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string }>();
    if (projectErr) {
      return NextResponse.json({ error: safeClientErrorMessage(projectErr) }, { status: 500 });
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const workerEvents = await loadWorkerShiftEvents(admin, org.id, workerId.value);
    if (overlapsAny(newInMs, newOutMs, buildIntervals(workerEvents, new Set()))) {
      return NextResponse.json(
        { error: "Manual shift overlaps an existing shift for this worker." },
        { status: 422 },
      );
    }

    const manualMeta = {
      manual_entry: true,
      created_by: actor.id,
      capturedBy: "owner-edit-shift-api",
    };
    const { data: inserted, error: insertErr } = await admin
      .from("time_events")
      .insert([
        {
          org_id: org.id,
          profile_id: workerId.value,
          project_id: projectId.value,
          event_type: "clock_in",
          event_time: newInIso,
          gps_point: null,
          gps_accuracy_m: null,
          gps_source: "unavailable",
          video_status: "not_required",
          metadata: manualMeta,
        },
        {
          org_id: org.id,
          profile_id: workerId.value,
          project_id: projectId.value,
          event_type: "clock_out",
          event_time: newOutIso,
          gps_point: null,
          gps_accuracy_m: null,
          gps_source: "unavailable",
          video_status: "not_required",
          metadata: manualMeta,
        },
      ])
      .select("id")
      .returns<{ id: string }[]>();
    if (insertErr || !inserted || inserted.length < 2) {
      return NextResponse.json(
        { error: insertErr ? safeClientErrorMessage(insertErr) : "Manual shift insert failed." },
        { status: 500 },
      );
    }

    await logAuditServer(supabase, {
      orgId: org.id,
      actorId: actor.id,
      actorName: actor.name,
      actorRole: actor.role,
      action: "shift_created_manually",
      targetType: "time_event",
      targetId: inserted[0].id,
      afterData: {
        worker_id: workerId.value,
        project_id: projectId.value,
        clock_in_time: newInIso,
        clock_out_time: newOutIso,
      },
    });

    return NextResponse.json({ ok: true, clockInEventId: inserted[0].id });
  } catch (error) {
    return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
  }
}

/**
 * Crew hint: the other workers' clock-out window for a project on a calendar
 * day, so the edit dialog can suggest "the crew left between X and Y".
 * Suggestion data only — never writes.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile: actor, org } = await requireManagerContext(supabase);
    const allowed = await hasFinanceAccess(supabase, { id: actor.id, role: actor.role });
    if (!allowed) {
      return NextResponse.json(
        { error: "Finance access is required." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Unavailable." }, { status: 503 });
    }

    const projectId = readRequiredUuid(request.nextUrl.searchParams.get("projectId"), "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    // Exclude the worker whose shift is being edited/added so the hint reflects
    // only the OTHER crew members' departures.
    const excludeProfileId = readRequiredUuid(
      request.nextUrl.searchParams.get("excludeProfileId"),
      "worker id",
    );
    if (!excludeProfileId.ok) {
      return NextResponse.json({ error: excludeProfileId.error }, { status: excludeProfileId.status });
    }
    // The client sends an explicit local-day window (local midnight → +24h) as
    // ISO timestamps, so evening shifts don't fall into the wrong UTC day.
    const fromIso = parseIso(request.nextUrl.searchParams.get("from"));
    const toIso = parseIso(request.nextUrl.searchParams.get("to"));
    if (!fromIso || !toIso) {
      return NextResponse.json({ error: "Invalid window." }, { status: 400 });
    }
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    if (toMs <= fromMs || toMs - fromMs > 26 * 60 * 60 * 1000) {
      return NextResponse.json({ error: "Invalid window." }, { status: 400 });
    }

    const { data, error } = await admin
      .from("time_events")
      .select("event_time, profile_id")
      .eq("org_id", org.id)
      .eq("project_id", projectId.value)
      .neq("profile_id", excludeProfileId.value)
      .in("event_type", ["clock_out", "auto_out"])
      .gte("event_time", fromIso)
      .lt("event_time", toIso)
      .returns<{ event_time: string; profile_id: string }[]>();
    if (error) {
      return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
    }

    const times = (data ?? [])
      .map((row) => new Date(row.event_time).getTime())
      .filter((ms) => Number.isFinite(ms))
      .sort((a, b) => a - b);

    if (times.length === 0) {
      return NextResponse.json({ ok: true, crewLeftFrom: null, crewLeftTo: null, count: 0 });
    }

    return NextResponse.json({
      ok: true,
      crewLeftFrom: new Date(times[0]).toISOString(),
      crewLeftTo: new Date(times[times.length - 1]).toISOString(),
      count: times.length,
    });
  } catch (error) {
    return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
  }
}
