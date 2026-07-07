import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppGeofenceRadiusM, resolveProjectRadiusM } from "@/lib/geofence";
import { parseGeoPoint } from "@/lib/worker-utils";
import {
  evaluateShiftGeofence,
  shouldAppendGeoEvent,
  type GeofenceStatus,
  type LatestLivePoint,
} from "@/lib/geofence/evaluate";
import { DEFAULT_GEOFENCE_THRESHOLDS } from "@/lib/geofence/config";

// Service-role cron: evaluate the geofence status of every OPEN shift that has
// at least one live location point, and append a shift_geo_events row only when
// the status changed. READ-ONLY over live tracking — it never writes locations,
// consent, time_events, or payroll.
//
// Scoped to the last 25h of clock_ins: the close-overlong cron (00044) caps
// shifts at 24h, so anything older is already auto-closed and cannot be open.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_SHIFT_WINDOW_MS = 25 * 60 * 60 * 1000;

type ClockInRow = {
  id: string;
  org_id: string;
  profile_id: string;
  project_id: string | null;
  event_time: string;
};

type ClosingRow = {
  profile_id: string;
  event_time: string;
};

type ProjectFenceRow = {
  id: string;
  site_point: unknown;
  gps_radius_m: number | null;
  radius_m: number | null;
};

type LivePointRow = {
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
};

// Postgres "relation does not exist" — the mirror-only table hasn't been
// applied by hand yet. We detect it so the route no-ops gracefully instead of
// erroring every 5 minutes until the owner runs 00047.
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01") return true;
  return /shift_geo_events/.test(error.message ?? "") && /exist/.test(error.message ?? "");
}

export async function GET(request: NextRequest) {
  // Vercel Cron protection: when CRON_SECRET is set, Vercel sends it as a
  // bearer token. Reject anyone who doesn't present it. (No repo precedent for
  // a protected HTTP cron — keepalive is open, close-overlong is pg_cron — so
  // this follows Vercel's documented pattern.)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    // No service-role key configured — nothing we can safely do.
    return NextResponse.json({ ok: true, skipped: "no_admin_client" }, { status: 200 });
  }

  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - OPEN_SHIFT_WINDOW_MS).toISOString();

  // 1. Candidate clock-ins and closing events in the window.
  const [{ data: clockIns, error: clockInErr }, { data: closings, error: closingErr }] =
    await Promise.all([
      admin
        .from("time_events")
        .select("id, org_id, profile_id, project_id, event_time")
        .eq("event_type", "clock_in")
        .gte("event_time", sinceIso)
        .order("event_time", { ascending: false }),
      admin
        .from("time_events")
        .select("profile_id, event_time")
        .in("event_type", ["clock_out", "auto_out"])
        .gte("event_time", sinceIso),
    ]);

  if (clockInErr) {
    return NextResponse.json({ error: clockInErr.message }, { status: 500 });
  }
  if (closingErr) {
    return NextResponse.json({ error: closingErr.message }, { status: 500 });
  }

  // 2. Determine OPEN shifts: the latest clock_in per profile that has no
  //    later closing event. (One active shift per worker; mirrors the
  //    close-overlong open-shift definition.)
  const latestClockInByProfile = new Map<string, ClockInRow>();
  for (const row of (clockIns ?? []) as ClockInRow[]) {
    const existing = latestClockInByProfile.get(row.profile_id);
    if (!existing || new Date(row.event_time) > new Date(existing.event_time)) {
      latestClockInByProfile.set(row.profile_id, row);
    }
  }

  const latestClosingByProfile = new Map<string, number>();
  for (const row of (closings ?? []) as ClosingRow[]) {
    const ms = new Date(row.event_time).getTime();
    const prev = latestClosingByProfile.get(row.profile_id);
    if (prev == null || ms > prev) latestClosingByProfile.set(row.profile_id, ms);
  }

  const openShifts: ClockInRow[] = [];
  for (const shift of latestClockInByProfile.values()) {
    const closedAt = latestClosingByProfile.get(shift.profile_id);
    if (closedAt != null && closedAt > new Date(shift.event_time).getTime()) continue;
    openShifts.push(shift);
  }

  const stats = {
    openShifts: openShifts.length,
    evaluated: 0,
    appended: 0,
    skippedNoPoint: 0,
    skippedNoFence: 0,
  };

  if (openShifts.length === 0) {
    return NextResponse.json({ ok: true, ...stats }, { status: 200 });
  }

  // 3. Batch the project fences for the open shifts.
  const projectIds = [
    ...new Set(openShifts.map((s) => s.project_id).filter((id): id is string => Boolean(id))),
  ];
  const fenceByProjectId = new Map<string, ProjectFenceRow>();
  if (projectIds.length > 0) {
    const { data: projects } = await admin
      .from("projects")
      .select("id, site_point, gps_radius_m, radius_m")
      .in("id", projectIds);
    for (const row of (projects ?? []) as ProjectFenceRow[]) {
      fenceByProjectId.set(row.id, row);
    }
  }
  const appRadius = await getAppGeofenceRadiusM(admin);

  // 4. Evaluate each open shift and append on status change.
  for (const shift of openShifts) {
    // Latest live point for THIS shift. No point → skip entirely (G1: web
    // tracking may simply be off; that's not an event).
    const { data: points, error: pointErr } = await admin
      .from("worker_live_locations")
      .select("lat, lng, accuracy, recorded_at")
      .eq("shift_id", shift.id)
      .order("recorded_at", { ascending: false })
      .limit(1);
    if (pointErr) continue;

    const latest = (points ?? [])[0] as LivePointRow | undefined;
    if (!latest) {
      stats.skippedNoPoint += 1;
      continue;
    }

    const point: LatestLivePoint = {
      lat: latest.lat,
      lng: latest.lng,
      recordedAtMs: new Date(latest.recorded_at).getTime(),
      accuracy: latest.accuracy,
    };

    const fenceRow = shift.project_id ? fenceByProjectId.get(shift.project_id) : undefined;
    const center = fenceRow ? parseGeoPoint(fenceRow.site_point) : null;
    const fence = center
      ? { center, radiusM: resolveProjectRadiusM(fenceRow!, appRadius) }
      : null;

    const evaluation = evaluateShiftGeofence({
      point,
      fence,
      nowMs,
      thresholds: DEFAULT_GEOFENCE_THRESHOLDS,
    });

    if (evaluation.kind === "skip") {
      if (evaluation.reason === "no_fence") stats.skippedNoFence += 1;
      else stats.skippedNoPoint += 1;
      continue;
    }
    stats.evaluated += 1;

    // Latest recorded status for this shift (status-change-only dedup).
    const { data: lastEvents, error: lastErr } = await admin
      .from("shift_geo_events")
      .select("status")
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false })
      .limit(1);

    // Table not applied yet → no-op the whole route gracefully.
    if (isMissingTableError(lastErr)) {
      return NextResponse.json({ ok: true, skipped: "table_absent", ...stats }, { status: 200 });
    }
    if (lastErr) continue;

    const lastStatus = ((lastEvents ?? [])[0]?.status ?? null) as GeofenceStatus | null;
    if (!shouldAppendGeoEvent(lastStatus, evaluation.status)) continue;

    const { error: insertErr } = await admin.from("shift_geo_events").insert({
      org_id: shift.org_id,
      shift_id: shift.id,
      worker_id: shift.profile_id,
      project_id: shift.project_id,
      status: evaluation.status,
      minutes_since_signal: evaluation.minutesSinceSignal,
      distance_m: evaluation.distanceM,
    });

    if (isMissingTableError(insertErr)) {
      return NextResponse.json({ ok: true, skipped: "table_absent", ...stats }, { status: 200 });
    }
    if (!insertErr) stats.appended += 1;
  }

  return NextResponse.json({ ok: true, ...stats }, { status: 200 });
}
