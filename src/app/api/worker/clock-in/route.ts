import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAppGeofenceRadiusM, resolveProjectRadiusM } from "@/lib/geofence";
import { buildNoGpsMetadata, type WorkerGpsErrorKind } from "@/lib/worker-clock-metadata";
import { isGpsWarningSuppressedForProject } from "@/lib/driver-time-projects";
import { haversineMeters, parseGeoPoint, toSupabasePoint } from "@/lib/worker-utils";
import { readRequiredUuid } from "@/lib/server/id-guards";
import type { TimeEvent } from "@/types/database";

type ClockInBody = {
  projectId?: unknown;
  eventTime?: unknown;
  gps?: unknown;
  gpsErrorKind?: unknown;
  clientEventId?: unknown;
  gpsReviewSuppressed?: unknown;
  offlineQueued?: unknown;
};

type WorkerProfile = {
  id: string;
  org_id: string;
  role: string;
  require_video: boolean;
  current_project: string | null;
  is_active: boolean;
};

type ProjectRow = {
  id: string;
  org_id: string;
  site_point: unknown;
  gps_radius_m: number | null;
  radius_m: number | null;
  settings: Record<string, unknown> | null;
};

type GpsPoint = {
  lat: number;
  lng: number;
  accuracy: number | null;
};

function asGpsPoint(value: unknown): GpsPoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const lat = typeof record.lat === "number" ? record.lat : Number(record.lat);
  const lng = typeof record.lng === "number" ? record.lng : Number(record.lng);
  const accuracy =
    typeof record.accuracy === "number"
      ? record.accuracy
      : record.accuracy == null
        ? null
        : Number(record.accuracy);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
}

function asGpsErrorKind(value: unknown): WorkerGpsErrorKind | null {
  return value === "denied" || value === "unavailable" || value === "unsupported"
    ? value
    : null;
}

function safeIso(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : fallback;
}

/**
 * Service-side worker clock-in (audit C-H4).
 *
 * The old client-only clock_in insert (plus the follow-up profiles.update)
 * ran straight from the browser, so a tampered client could forge a shift
 * or bypass the geofence. This endpoint keeps the same auth boundary as the
 * clock-out route, derives org_id/profile_id/video_status from the server
 * profile, and enforces the geofence server-side. Idempotent by
 * metadata->>client_event_id so the offline drain can replay safely.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Clock-in is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as ClockInBody;
    const projectId = readRequiredUuid(body.projectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    const nowIso = new Date().toISOString();
    const eventTime = safeIso(body.eventTime, nowIso);
    const gps = asGpsPoint(body.gps);
    const gpsErrorKind = asGpsErrorKind(body.gpsErrorKind);
    const offlineQueued = body.offlineQueued === true;
    const clientEventId =
      typeof body.clientEventId === "string" && body.clientEventId.trim()
        ? body.clientEventId.trim().slice(0, 120)
        : crypto.randomUUID();

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, org_id, role, require_video, current_project, is_active")
      .eq("id", user.id)
      .maybeSingle<WorkerProfile>();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }
    if (!profile.is_active) {
      return NextResponse.json({ error: "Profile is inactive." }, { status: 403 });
    }

    // Layer-B dedup: an event already stamped with this client_event_id means
    // the drain (or a double-tap) already landed. Return it instead of a dupe.
    const { data: existingEvent, error: existingError } = await admin
      .from("time_events")
      .select("*")
      .eq("profile_id", user.id)
      .eq("event_type", "clock_in")
      .contains("metadata", { client_event_id: clientEventId })
      .maybeSingle<TimeEvent>();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (existingEvent) {
      return NextResponse.json({ ok: true, event: existingEvent, requireVideo: profile.require_video });
    }

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("id, org_id, site_point, gps_radius_m, radius_m, settings")
      .eq("id", projectId.value)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .maybeSingle<ProjectRow>();

    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Server-side geofence enforcement — mirrors the client formula exactly:
    // radius (per-project gps_radius_m → app setting → 75m) + max(accuracy, 25).
    // Only enforced when we actually have both a device fix and a site point;
    // the No-GPS path (gpsErrorKind present, gps null) passes through as today.
    const site = parseGeoPoint(project.site_point);
    if (gps && site) {
      const appRadius = await getAppGeofenceRadiusM(admin);
      const effectiveRadius = resolveProjectRadiusM(project, appRadius);
      const allowedDistance = effectiveRadius + Math.max(gps.accuracy ?? 0, 25);
      const distanceMeters = haversineMeters(site, { lat: gps.lat, lng: gps.lng });
      if (distanceMeters > allowedDistance) {
        return NextResponse.json(
          { error: "Outside the job-site geofence.", distance: Math.round(distanceMeters) },
          { status: 422 },
        );
      }
    }

    const noGpsMetadata = buildNoGpsMetadata({
      skippedGps: !gps,
      errorKind: gpsErrorKind,
      offlineQueued,
      gpsReviewSuppressed:
        isGpsWarningSuppressedForProject(project) || body.gpsReviewSuppressed === true,
    });

    const { data: insertedEvent, error: insertError } = await admin
      .from("time_events")
      .insert({
        org_id: profile.org_id,
        profile_id: profile.id,
        project_id: project.id,
        event_type: "clock_in",
        event_time: eventTime,
        gps_point: gps ? toSupabasePoint({ lat: gps.lat, lng: gps.lng }) : null,
        gps_accuracy_m: gps?.accuracy ?? null,
        gps_source: gps ? "device" : "unavailable",
        video_status: profile.require_video ? "pending" : "not_required",
        metadata: {
          capturedBy: "worker-clock-in-api",
          gps,
          client_event_id: clientEventId,
          queued_offline: offlineQueued,
          ...noGpsMetadata,
        },
      })
      .select("*")
      .single<TimeEvent>();

    if (insertError || !insertedEvent) {
      return NextResponse.json(
        { error: insertError?.message ?? "Clock-in failed." },
        { status: 500 },
      );
    }

    await admin
      .from("profiles")
      .update({ last_clock_in: eventTime, current_project: project.id })
      .eq("id", profile.id)
      .eq("org_id", profile.org_id);

    return NextResponse.json({
      ok: true,
      event: insertedEvent,
      requireVideo: profile.require_video,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
