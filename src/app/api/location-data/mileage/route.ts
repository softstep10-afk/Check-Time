import { NextResponse } from "next/server";
import { isManagerRole } from "@/lib/manager-utils";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createClient } from "@/lib/supabase/server";
import { haversineMeters } from "@/lib/worker-utils";
import type { Profile } from "@/types/database";

type MileageProfile = Pick<Profile, "id" | "name" | "role">;
type LocationPointRow = {
  worker_id: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  recorded_at: string;
};
type MileageAccumulator = {
  profile: MileageProfile;
  miles: number;
  pings: number;
  firstSeen: string | null;
  lastSeen: string | null;
  previous: LocationPointRow | null;
};
type QueryResult<T> = {
  data: T[] | null;
  error: unknown;
};

const TRACKED_MILEAGE_ROLES: Profile["role"][] = ["driver", "manager", "admin", "owner"];
const LOCATION_PAGE_SIZE = 1000;
const METERS_PER_MILE = 1609.344;
const MAX_SEGMENT_GAP_MS = 30 * 60 * 1000;
const MAX_REASONABLE_SPEED_MPH = 120;
const MAX_ACCURACY_M = 250;

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultMonthStart(date = new Date()): string {
  return toDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
}

function readDateInput(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function nextDateIso(dateInput: string): string {
  const date = new Date(`${dateInput}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

async function fetchAllRows<T>(
  queryForRange: (from: number, to: number) => PromiseLike<QueryResult<T>>,
): Promise<{ data: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += LOCATION_PAGE_SIZE) {
    const { data, error } = await queryForRange(from, from + LOCATION_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < LOCATION_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

function applyPointToMileage(accumulator: MileageAccumulator, point: LocationPointRow) {
  if (point.accuracy != null && point.accuracy > MAX_ACCURACY_M) return;

  accumulator.pings += 1;
  accumulator.firstSeen ??= point.recorded_at;
  accumulator.lastSeen = point.recorded_at;

  if (accumulator.previous) {
    const previousTime = new Date(accumulator.previous.recorded_at).getTime();
    const currentTime = new Date(point.recorded_at).getTime();
    const gapMs = currentTime - previousTime;

    if (gapMs > 0 && gapMs <= MAX_SEGMENT_GAP_MS) {
      const segmentMeters = haversineMeters(
        { lat: accumulator.previous.lat, lng: accumulator.previous.lng },
        { lat: point.lat, lng: point.lng },
      );
      if (segmentMeters >= 8) {
        const speedMph = segmentMeters / METERS_PER_MILE / (gapMs / 3_600_000);
        if (speedMph <= MAX_REASONABLE_SPEED_MPH) {
          accumulator.miles += segmentMeters / METERS_PER_MILE;
        }
      }
    }
  }

  accumulator.previous = point;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: actor, error: actorError } = await supabase
    .from("profiles")
    .select("id, role, org_id")
    .eq("id", user.id)
    .maybeSingle<Pick<Profile, "id" | "role" | "org_id">>();

  if (actorError || !actor || !isManagerRole(actor.role)) {
    return NextResponse.json({ error: "Location data access denied." }, { status: 403 });
  }

  const searchParams = new URL(request.url).searchParams;
  const workerId = searchParams.get("workerId") || null;
  const today = new Date();
  const dateTo = readDateInput(searchParams.get("to")) ?? toDateInput(today);
  const dateFrom = readDateInput(searchParams.get("from")) ?? defaultMonthStart(new Date(`${dateTo}T00:00:00`));

  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  }

  let profileQuery = supabase
    .from("profiles")
    .select("id, name, role")
    .eq("org_id", actor.org_id)
    .is("deleted_at", null)
    .in("role", TRACKED_MILEAGE_ROLES);

  if (workerId) {
    profileQuery = profileQuery.eq("id", workerId);
  }

  const { data: profiles, error: profilesError } = await profileQuery
    .order("name", { ascending: true })
    .returns<MileageProfile[]>();
  if (profilesError) {
    return NextResponse.json({ error: safeClientErrorMessage(profilesError) }, { status: 500 });
  }

  let countQuery = supabase
    .from("worker_live_locations")
    .select("id", { count: "exact", head: true })
    .eq("org_id", actor.org_id)
    .gte("recorded_at", `${dateFrom}T00:00:00.000Z`)
    .lt("recorded_at", nextDateIso(dateTo));

  let oldestQuery = supabase
    .from("worker_live_locations")
    .select("recorded_at")
    .eq("org_id", actor.org_id)
    .gte("recorded_at", `${dateFrom}T00:00:00.000Z`)
    .lt("recorded_at", nextDateIso(dateTo));

  if (workerId) {
    countQuery = countQuery.eq("worker_id", workerId);
    oldestQuery = oldestQuery.eq("worker_id", workerId);
  }

  const [{ count, error: countError }, { data: oldestRows, error: oldestError }] = await Promise.all([
    countQuery,
    oldestQuery
      .order("recorded_at", { ascending: true })
      .limit(1)
      .returns<Array<{ recorded_at: string }>>(),
  ]);

  if (countError || oldestError) {
    return NextResponse.json({ error: safeClientErrorMessage(countError ?? oldestError) }, { status: 500 });
  }

  const workerIds = (profiles ?? []).map((profile) => profile.id);
  const accumulators = new Map<string, MileageAccumulator>(
    (profiles ?? []).map((profile) => [
      profile.id,
      {
        profile,
        miles: 0,
        pings: 0,
        firstSeen: null,
        lastSeen: null,
        previous: null,
      },
    ]),
  );

  if (workerIds.length > 0) {
    const pointsRes = await fetchAllRows<LocationPointRow>((from, to) =>
      supabase
        .from("worker_live_locations")
        .select("worker_id, lat, lng, accuracy, recorded_at")
        .eq("org_id", actor.org_id)
        .in("worker_id", workerIds)
        .gte("recorded_at", `${dateFrom}T00:00:00.000Z`)
        .lt("recorded_at", nextDateIso(dateTo))
        .order("recorded_at", { ascending: true })
        .range(from, to)
        .returns<LocationPointRow[]>(),
    );

    if (pointsRes.error) {
      return NextResponse.json({ error: safeClientErrorMessage(pointsRes.error) }, { status: 500 });
    }

    for (const point of pointsRes.data) {
      const accumulator = accumulators.get(point.worker_id);
      if (!accumulator) continue;
      applyPointToMileage(accumulator, point);
    }
  }

  const summaries = [...accumulators.values()]
    .filter((summary) => summary.pings > 0 || summary.miles > 0)
    .map(({ profile, miles, pings, firstSeen, lastSeen }) => ({
      profile,
      miles,
      pings,
      firstSeen,
      lastSeen,
    }))
    .sort((a, b) => b.miles - a.miles);

  const totalRows = count ?? 0;

  return NextResponse.json({
    summaries,
    totalMiles: summaries.reduce((sum, summary) => sum + summary.miles, 0),
    totalRows,
    oldestRecord: oldestRows?.[0]?.recorded_at ?? null,
    estimatedSizeMb: Math.max(0.01, totalRows * 0.00025),
    effectiveDateFrom: dateFrom,
    effectiveDateTo: dateTo,
  });
}
