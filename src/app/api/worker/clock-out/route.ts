import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { closeOpenStoreVisits } from "@/lib/store-visits";
import { buildNoGpsMetadata, type WorkerGpsErrorKind } from "@/lib/worker-clock-metadata";
import type { TimeEvent } from "@/types/database";

type ClockOutBody = {
  eventTime?: unknown;
  gps?: unknown;
  gpsAccuracy?: unknown;
  gpsErrorKind?: unknown;
  note?: unknown;
  clientEventId?: unknown;
};

type WorkerProfile = {
  id: string;
  org_id: string;
  role: string;
  require_video: boolean;
  current_project: string | null;
  is_active: boolean;
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

function toSupabasePoint(point: GpsPoint): string {
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

/**
 * Service-side worker checkout.
 *
 * The old client-only clock_out insert depended on browser/RLS behavior.
 * That made the project page checkout path fragile on phones: if the
 * client was stale, GPS permission changed, or RLS returned a hard error,
 * the worker looked trapped in the checkout modal. This endpoint keeps
 * the same auth boundary, but performs the ledger insert with the service
 * role after verifying the caller owns the open shift.
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
        { error: "Clock-out is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as ClockOutBody;
    const nowIso = new Date().toISOString();
    const requestedTimestamp = safeIso(body.eventTime, nowIso);
    const gps = asGpsPoint(body.gps);
    const gpsErrorKind = asGpsErrorKind(body.gpsErrorKind);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
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

    const { data: existingEvent, error: existingError } = await admin
      .from("time_events")
      .select("*")
      .eq("profile_id", user.id)
      .eq("event_type", "clock_out")
      .contains("metadata", { client_event_id: clientEventId })
      .maybeSingle<TimeEvent>();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    if (existingEvent) {
      return NextResponse.json({ ok: true, event: existingEvent, requireVideo: profile.require_video });
    }

    const { data: latestEvent, error: latestError } = await admin
      .from("time_events")
      .select("*")
      .eq("profile_id", user.id)
      .in("event_type", ["clock_in", "clock_out"])
      .order("event_time", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<TimeEvent>();

    if (latestError) {
      return NextResponse.json({ error: latestError.message }, { status: 500 });
    }
    if (!latestEvent || latestEvent.event_type !== "clock_in") {
      return NextResponse.json({ error: "There is no active shift to close." }, { status: 409 });
    }
    if (latestEvent.org_id !== profile.org_id || latestEvent.profile_id !== profile.id) {
      return NextResponse.json({ error: "Shift ownership mismatch." }, { status: 403 });
    }

    const openMs = new Date(latestEvent.event_time).getTime();
    const requestedMs = new Date(requestedTimestamp).getTime();
    const eventTime = Number.isFinite(openMs) && requestedMs <= openMs ? nowIso : requestedTimestamp;
    const noGpsMetadata = buildNoGpsMetadata({
      skippedGps: !gps,
      errorKind: gpsErrorKind,
    });

    const { data: insertedEvent, error: insertError } = await admin
      .from("time_events")
      .insert({
        org_id: profile.org_id,
        profile_id: profile.id,
        project_id: latestEvent.project_id,
        event_type: "clock_out",
        event_time: eventTime,
        gps_point: gps ? toSupabasePoint(gps) : null,
        gps_accuracy_m: gps?.accuracy ?? null,
        gps_source: gps ? "device" : "unavailable",
        video_status: profile.require_video ? "pending" : "not_required",
        metadata: {
          capturedBy: "worker-clock-out-api",
          gps,
          client_event_id: clientEventId,
          queued_offline: false,
          ...noGpsMetadata,
          ...(note ? { checkout_note: note } : {}),
        },
      })
      .select("*")
      .single<TimeEvent>();

    if (insertError || !insertedEvent) {
      return NextResponse.json(
        { error: insertError?.message ?? "Clock-out failed." },
        { status: 500 },
      );
    }

    await admin
      .from("profiles")
      .update({ current_project: null })
      .eq("id", profile.id)
      .eq("org_id", profile.org_id);

    await closeOpenStoreVisits(admin, profile.id, eventTime);

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
