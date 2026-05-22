// ============================================================================
// detect-store-visit — Supabase Edge Function (Deno runtime)
//
// Triggered by a database webhook on INSERT into public.worker_live_locations.
// For each new GPS point this function:
//   1. Loads active supply_stores (cached per invocation).
//   2. Computes haversine distance to every store.
//   3. Reads the geofence radius from public.app_settings (cached 60s).
//   4. Walks the geofence state machine for the worker's open store_visit
//      (open visit = exited_at IS NULL).
//   5. On a real exit, calculates duration and either keeps the row or
//      deletes it if duration < 3 minutes (drive-by).
//   6. Writes a row to public.audit_log on a kept close so the Overview
//      Recent Events feed can pick it up.
//
// Webhook payload shape (Supabase: Database → Webhooks → INSERT):
//   { type: "INSERT", table: "worker_live_locations", record: { ... } }
//
// Setup steps live in supabase/README.md.
// ============================================================================

// @ts-expect-error — Deno-only npm specifier resolved by Supabase runtime.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-expect-error — Deno global is provided by the edge runtime.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// @ts-expect-error — Deno global is provided by the edge runtime.
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
// Optional shared secret. When set, database webhooks must send
// x-check-time-webhook-secret with the same value before this function
// accepts the request. Leaving it unset preserves the existing webhook.
// @ts-expect-error — Deno global is provided by the edge runtime.
const WEBHOOK_SECRET = Deno.env.get("DETECT_STORE_VISIT_WEBHOOK_SECRET")?.trim() ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "detect-store-visit: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Types ──────────────────────────────────────────────────────────────────

type LocationRecord = {
  id: string;
  org_id: string;
  worker_id: string;
  shift_id: string | null;
  lat: number;
  lng: number;
  recorded_at: string;
};

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: LocationRecord;
  old_record?: LocationRecord | null;
};

type SupplyStore = {
  id: string;
  chain: string;
  name: string;
  lat: number;
  lng: number;
  is_active: boolean;
};

type OpenVisit = {
  id: string;
  store_id: string;
  worker_id: string;
  entered_at: string;
  entry_lat: number | null;
  entry_lng: number | null;
  source_project_id: string | null;
  // Added by 00004_geofence_grace.sql migration. Function tolerates absence.
  grace_started_at: string | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const FALLBACK_RADIUS_M = 75;     // Used when app_settings row is missing.
const GRACE_PERIOD_MS = 60_000;   // Wait 60s outside fence before closing.
const MIN_DWELL_SECONDS = 180;    // 3 minutes — drive-by threshold.
const SETTINGS_TTL_MS = 60_000;   // Cache app_settings for one minute.

// ── Caches ─────────────────────────────────────────────────────────────────

let cachedRadiusM: number | null = null;
let cachedRadiusAt = 0;

function timingSafeEqual(left: string, right: string): boolean {
  if (!left || !right || left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function readBearerToken(value: string | null): string {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function isAuthorizedWebhook(req: Request): boolean {
  if (!WEBHOOK_SECRET) {
    return true;
  }

  const headerSecret = req.headers.get("x-check-time-webhook-secret")?.trim() ?? "";
  const bearerSecret = readBearerToken(req.headers.get("authorization"));
  return (
    timingSafeEqual(headerSecret, WEBHOOK_SECRET) ||
    timingSafeEqual(bearerSecret, WEBHOOK_SECRET)
  );
}

async function getGeofenceRadiusM(): Promise<number> {
  const now = Date.now();
  if (cachedRadiusM !== null && now - cachedRadiusAt < SETTINGS_TTL_MS) {
    return cachedRadiusM;
  }

  // TODO: when public.app_settings is missing the query throws — fall back to
  // FALLBACK_RADIUS_M so the function keeps working before migration 00005
  // is applied.
  const { data, error } = await supabase
    .from("app_settings")
    .select("settings")
    .eq("id", 1)
    .maybeSingle();

  let radius = FALLBACK_RADIUS_M;
  if (!error && data) {
    const settings = (data as { settings: Record<string, unknown> }).settings ?? {};
    const raw = Number(settings.geofence_radius_meters);
    if (Number.isFinite(raw) && raw >= 25 && raw <= 500) {
      radius = raw;
    }
  }

  cachedRadiusM = radius;
  cachedRadiusAt = now;
  return radius;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function findContainingStore(
  point: { lat: number; lng: number },
  stores: SupplyStore[],
  radiusM: number,
): SupplyStore | null {
  let best: SupplyStore | null = null;
  let bestDistance = Infinity;
  for (const store of stores) {
    const distance = haversineMeters(point.lat, point.lng, store.lat, store.lng);
    if (distance <= radiusM && distance < bestDistance) {
      best = store;
      bestDistance = distance;
    }
  }
  return best;
}

async function loadActiveStores(): Promise<SupplyStore[]> {
  const { data, error } = await supabase
    .from("supply_stores")
    .select("id, chain, name, lat, lng, is_active")
    .eq("is_active", true);
  if (error) throw new Error(`supply_stores query failed: ${error.message}`);
  return (data ?? []) as SupplyStore[];
}

async function loadOpenVisit(workerId: string): Promise<OpenVisit | null> {
  const { data, error } = await supabase
    .from("store_visits")
    .select("id, store_id, worker_id, entered_at, entry_lat, entry_lng, source_project_id, grace_started_at")
    .eq("worker_id", workerId)
    .is("exited_at", null)
    .order("entered_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // grace_started_at column missing? fall back to a query without it.
    if (/column .* grace_started_at/i.test(error.message)) {
      const fallback = await supabase
        .from("store_visits")
        .select("id, store_id, worker_id, entered_at, entry_lat, entry_lng, source_project_id")
        .eq("worker_id", workerId)
        .is("exited_at", null)
        .order("entered_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (fallback.error) throw new Error(`store_visits query failed: ${fallback.error.message}`);
      return fallback.data
        ? { ...(fallback.data as Omit<OpenVisit, "grace_started_at">), grace_started_at: null }
        : null;
    }
    throw new Error(`store_visits query failed: ${error.message}`);
  }
  return (data as OpenVisit | null) ?? null;
}

async function openVisit(
  point: LocationRecord,
  store: SupplyStore,
  workerName: string | null,
): Promise<void> {
  // shift_id on the location row already encodes the open clock_in event,
  // and source_project_id comes from the profile's current_project.
  const { data: profile } = await supabase
    .from("profiles")
    .select("name, current_project")
    .eq("id", point.worker_id)
    .maybeSingle<{ name: string; current_project: string | null }>();

  const sourceProjectId = profile?.current_project ?? null;
  let sourceProjectName: string | null = null;
  if (sourceProjectId) {
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", sourceProjectId)
      .maybeSingle<{ name: string }>();
    sourceProjectName = project?.name ?? null;
  }

  const { error } = await supabase.from("store_visits").insert({
    org_id: point.org_id,
    worker_id: point.worker_id,
    store_id: store.id,
    shift_id: point.shift_id,
    entered_at: point.recorded_at,
    entry_lat: point.lat,
    entry_lng: point.lng,
    source_project_id: sourceProjectId,
    worker_name: workerName ?? profile?.name ?? null,
    store_name: store.name,
    store_chain: store.chain,
    source_project_name: sourceProjectName,
    duration_seconds: 0,
  });

  if (error) throw new Error(`open visit insert failed: ${error.message}`);
}

async function setGrace(visitId: string, graceStartedAt: string | null): Promise<void> {
  const { error } = await supabase
    .from("store_visits")
    .update({ grace_started_at: graceStartedAt })
    .eq("id", visitId);
  if (error && !/column .* grace_started_at/i.test(error.message)) {
    throw new Error(`grace update failed: ${error.message}`);
  }
}

async function closeVisit(
  visit: OpenVisit,
  point: LocationRecord,
  exitTimestamp: string,
): Promise<{ duration: number; kept: boolean }> {
  const enteredMs = new Date(visit.entered_at).getTime();
  const exitedMs = new Date(exitTimestamp).getTime();
  const duration = Math.max(0, Math.round((exitedMs - enteredMs) / 1_000));

  if (duration < MIN_DWELL_SECONDS) {
    // Drive-by — purge the row entirely (chk_min_dwell would also reject the
    // close otherwise).
    const { error } = await supabase.from("store_visits").delete().eq("id", visit.id);
    if (error) throw new Error(`drive-by delete failed: ${error.message}`);
    return { duration, kept: false };
  }

  const { error } = await supabase
    .from("store_visits")
    .update({
      exited_at: exitTimestamp,
      duration_seconds: duration,
      exit_lat: point.lat,
      exit_lng: point.lng,
      grace_started_at: null,
    })
    .eq("id", visit.id);

  if (error && /column .* grace_started_at/i.test(error.message)) {
    // Retry without the grace column for environments missing the migration.
    const retry = await supabase
      .from("store_visits")
      .update({
        exited_at: exitTimestamp,
        duration_seconds: duration,
        exit_lat: point.lat,
        exit_lng: point.lng,
      })
      .eq("id", visit.id);
    if (retry.error) throw new Error(`close visit failed: ${retry.error.message}`);
  } else if (error) {
    throw new Error(`close visit failed: ${error.message}`);
  }

  return { duration, kept: true };
}

async function logVisitClose(
  visit: OpenVisit,
  point: LocationRecord,
  duration: number,
  storeChain: string | null,
  storeName: string | null,
): Promise<void> {
  // Best-effort — never block the state machine on audit-log failure.
  await supabase
    .from("audit_log")
    .insert({
      org_id: point.org_id,
      actor_id: point.worker_id,
      actor_name: storeName ?? "Worker",
      actor_role: "worker",
      action: "store_visit_logged",
      target_type: "store_visit",
      target_id: visit.id,
      after_data: {
        store_chain: storeChain,
        store_name: storeName,
        duration_seconds: duration,
      },
    })
    .then(() => undefined, () => undefined);
}

// ── Handler ────────────────────────────────────────────────────────────────

async function handleLocationPoint(point: LocationRecord): Promise<{
  action: "noop" | "opened" | "closed_kept" | "closed_dropped" | "switched";
  detail?: string;
}> {
  const [stores, radiusM, openVisitRow] = await Promise.all([
    loadActiveStores(),
    getGeofenceRadiusM(),
    loadOpenVisit(point.worker_id),
  ]);

  const containing = findContainingStore({ lat: point.lat, lng: point.lng }, stores, radiusM);

  // ── Case A: not currently inside any visit ──
  if (!openVisitRow) {
    if (!containing) return { action: "noop", detail: "outside-all" };
    await openVisit(point, containing, null);
    return { action: "opened", detail: containing.name };
  }

  const sameStore = containing && containing.id === openVisitRow.store_id;

  // ── Case B: still inside the same store — clear any pending grace ──
  if (sameStore) {
    if (openVisitRow.grace_started_at !== null) {
      await setGrace(openVisitRow.id, null);
    }
    return { action: "noop", detail: "still-inside" };
  }

  // ── Case C: inside a different store — close current, open new ──
  if (containing && !sameStore) {
    const { duration, kept } = await closeVisit(openVisitRow, point, point.recorded_at);
    if (kept) {
      await logVisitClose(
        openVisitRow,
        point,
        duration,
        containing.chain,
        containing.name,
      );
    }
    await openVisit(point, containing, null);
    return { action: "switched", detail: `${openVisitRow.store_id} → ${containing.id}` };
  }

  // ── Case D: outside fence — start or check grace ──
  const nowMs = new Date(point.recorded_at).getTime();
  if (!openVisitRow.grace_started_at) {
    await setGrace(openVisitRow.id, point.recorded_at);
    return { action: "noop", detail: "grace-started" };
  }

  const graceMs = new Date(openVisitRow.grace_started_at).getTime();
  if (nowMs - graceMs < GRACE_PERIOD_MS) {
    return { action: "noop", detail: "grace-pending" };
  }

  // Grace expired — close at the moment grace started so duration excludes
  // the buffer time.
  const { duration, kept } = await closeVisit(
    openVisitRow,
    point,
    openVisitRow.grace_started_at,
  );
  if (kept) {
    await logVisitClose(openVisitRow, point, duration, null, null);
    return { action: "closed_kept", detail: `${duration}s` };
  }
  return { action: "closed_dropped", detail: `${duration}s` };
}

// ── HTTP entry point ───────────────────────────────────────────────────────

// @ts-expect-error — Deno.serve is provided by the edge runtime.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  if (!isAuthorizedWebhook(req)) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "worker_live_locations") {
    return new Response(JSON.stringify({ skipped: payload.type }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const point = payload.record;
  if (!point?.worker_id || typeof point.lat !== "number" || typeof point.lng !== "number") {
    return new Response("invalid record payload", { status: 400 });
  }

  try {
    const result = await handleLocationPoint(point);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("detect-store-visit failed:", message);
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
