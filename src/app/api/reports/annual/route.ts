import { NextResponse } from "next/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import { isManagerRole } from "@/lib/manager-utils";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createClient } from "@/lib/supabase/server";
import type { StoreVisit } from "@/lib/store-types";
import type { Media, Profile, Project, TimeEvent } from "@/types/database";

type AnnualActor = Pick<Profile, "id" | "role">;
type AnnualProfileRow = Pick<Profile, "id" | "name" | "role">;
type AnnualProjectRow = Pick<Project, "id" | "name" | "address" | "status" | "start_date" | "end_date">;
type AnnualEventRow = Pick<TimeEvent, "profile_id" | "project_id" | "event_type" | "event_time">;
type AnnualReceiptRow = Pick<Media, "project_id" | "metadata" | "created_at">;
type AnnualStoreVisitRow = Pick<
  StoreVisit,
  "worker_id" | "worker_name" | "store_id" | "store_name" | "store_chain" | "duration_seconds"
>;

type QueryResult<T> = {
  data: T[] | null;
  error: unknown;
};

const ANNUAL_PAGE_SIZE = 1000;
const ANNUAL_PROJECT_SELECT = "id, name, address, status, start_date, end_date";
const ANNUAL_PROFILE_SELECT = "id, name, role";
const ANNUAL_TIME_EVENT_SELECT = "profile_id, project_id, event_type, event_time";
const ANNUAL_RECEIPT_SELECT = "project_id, metadata, created_at";
const ANNUAL_STORE_VISIT_SELECT =
  "worker_id, worker_name, store_id, store_name, store_chain, duration_seconds";
const PAYROLL_EVENT_TYPES: TimeEvent["event_type"][] = ["clock_in", "clock_out", "auto_out"];

function readYear(value: string | null): number {
  const fallback = new Date().getFullYear();
  if (!value) return fallback;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fallback;
  return year;
}

async function fetchAllRows<T>(
  queryForRange: (from: number, to: number) => PromiseLike<QueryResult<T>>,
): Promise<{ data: T[]; error: unknown | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += ANNUAL_PAGE_SIZE) {
    const { data, error } = await queryForRange(from, from + ANNUAL_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < ANNUAL_PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function readMoney(metadata: Record<string, unknown> | null | undefined): number {
  const value = Number(metadata?.amount ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function summarizeEvents(events: AnnualEventRow[]) {
  const workerHours = new Map<
    string,
    {
      totalHours: number;
      projectIds: Set<string>;
      dayKeys: Set<string>;
      firstShift: string | null;
      lastShift: string | null;
    }
  >();
  const projectHours = new Map<string, { laborHours: number; workerIds: Set<string> }>();
  const activeWorkersByMonth = Array.from({ length: 12 }, () => new Set<string>());
  const openShifts = new Map<string, AnnualEventRow>();

  for (const event of events) {
    if (event.event_type === "clock_in") {
      openShifts.set(event.profile_id, event);
      continue;
    }

    const clockIn = openShifts.get(event.profile_id);
    if (!clockIn) continue;
    openShifts.delete(event.profile_id);

    const minutes = Math.max(
      0,
      Math.round(
        (new Date(event.event_time).getTime() - new Date(clockIn.event_time).getTime()) /
          60_000,
      ),
    );
    const hours = minutes / 60;

    const worker = workerHours.get(event.profile_id) ?? {
      totalHours: 0,
      projectIds: new Set<string>(),
      dayKeys: new Set<string>(),
      firstShift: null,
      lastShift: null,
    };
    worker.totalHours += hours;
    worker.projectIds.add(event.project_id);
    worker.dayKeys.add(clockIn.event_time.slice(0, 10));
    if (!worker.firstShift || clockIn.event_time < worker.firstShift) {
      worker.firstShift = clockIn.event_time;
    }
    if (!worker.lastShift || event.event_time > worker.lastShift) {
      worker.lastShift = event.event_time;
    }
    workerHours.set(event.profile_id, worker);

    const project = projectHours.get(clockIn.project_id) ?? {
      laborHours: 0,
      workerIds: new Set<string>(),
    };
    project.laborHours += hours;
    project.workerIds.add(event.profile_id);
    projectHours.set(clockIn.project_id, project);

    const month = new Date(clockIn.event_time).getMonth();
    if (month >= 0 && month < 12) {
      activeWorkersByMonth[month].add(event.profile_id);
    }
  }

  return {
    workerHours: [...workerHours.entries()].map(([workerId, value]) => ({
      workerId,
      totalHours: roundHours(value.totalHours),
      projectCount: value.projectIds.size,
      dayCount: value.dayKeys.size,
      firstShift: value.firstShift,
      lastShift: value.lastShift,
    })),
    projectHours: [...projectHours.entries()].map(([projectId, value]) => ({
      projectId,
      laborHours: roundHours(value.laborHours),
      workerCount: value.workerIds.size,
    })),
    activeWorkerCountsByMonth: activeWorkersByMonth.map((workers) => workers.size),
  };
}

function summarizeReceipts(receipts: AnnualReceiptRow[]) {
  const receiptsByProject = new Map<string, number>();
  const materialByMonth = new Array<number>(12).fill(0);

  for (const receipt of receipts) {
    const amount = readMoney(receipt.metadata);
    if (receipt.project_id) {
      receiptsByProject.set(receipt.project_id, (receiptsByProject.get(receipt.project_id) ?? 0) + amount);
    }
    const month = new Date(receipt.created_at).getMonth();
    if (month >= 0 && month < 12) {
      materialByMonth[month] += amount;
    }
  }

  return {
    receiptsByProject: [...receiptsByProject.entries()].map(([projectId, materialCost]) => ({
      projectId,
      materialCost: Math.round(materialCost * 100) / 100,
    })),
    materialByMonth: materialByMonth.map((amount) => Math.round(amount * 100) / 100),
    totalMaterials: Math.round(materialByMonth.reduce((sum, amount) => sum + amount, 0) * 100) / 100,
  };
}

function summarizeStoreVisits(visits: AnnualStoreVisitRow[]) {
  const visitsByWorker = new Map<string, number>();
  const byStore = new Map<string, { name: string; chain: string; visits: number; minutes: number }>();
  const byChain = new Map<string, { visits: number; minutes: number }>();
  const byWorker = new Map<string, { name: string; visits: number; minutes: number }>();

  for (const visit of visits) {
    visitsByWorker.set(visit.worker_id, (visitsByWorker.get(visit.worker_id) ?? 0) + 1);

    const minutes = Math.round((visit.duration_seconds ?? 0) / 60);
    const storeKey = visit.store_id ?? visit.store_name ?? "unknown";
    const store = byStore.get(storeKey) ?? {
      name: visit.store_name ?? "Unknown",
      chain: visit.store_chain ?? "",
      visits: 0,
      minutes: 0,
    };
    store.visits += 1;
    store.minutes += minutes;
    byStore.set(storeKey, store);

    if (visit.store_chain) {
      const chain = byChain.get(visit.store_chain) ?? { visits: 0, minutes: 0 };
      chain.visits += 1;
      chain.minutes += minutes;
      byChain.set(visit.store_chain, chain);
    }

    const workerKey = visit.worker_id ?? visit.worker_name ?? "unknown";
    const worker = byWorker.get(workerKey) ?? {
      name: visit.worker_name ?? "Unknown",
      visits: 0,
      minutes: 0,
    };
    worker.visits += 1;
    worker.minutes += minutes;
    byWorker.set(workerKey, worker);
  }

  return {
    visitsByWorker: [...visitsByWorker.entries()].map(([workerId, visits]) => ({ workerId, visits })),
    totalVisits: visits.length,
    totalVisitMinutes: Math.round(visits.reduce((sum, visit) => sum + (visit.duration_seconds ?? 0), 0) / 60),
    storeBreakdown: {
      stores: [...byStore.values()].sort((a, b) => b.visits - a.visits).slice(0, 10),
      chains: [...byChain.entries()]
        .map(([name, value]) => ({ name, ...value }))
        .sort((a, b) => b.visits - a.visits),
      workers: [...byWorker.values()].sort((a, b) => b.visits - a.visits).slice(0, 10),
    },
  };
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle<AnnualActor>();

  if (profileError || !profile || !isManagerRole(profile.role)) {
    return NextResponse.json({ error: "Annual report access denied." }, { status: 403 });
  }

  const allowed = await hasFinanceAccess(supabase, profile);
  if (!allowed) {
    return NextResponse.json({ error: "Annual report access denied." }, { status: 403 });
  }

  const year = readYear(new URL(request.url).searchParams.get("year"));
  const yearStart = `${year}-01-01T00:00:00`;
  const yearEnd = `${year}-12-31T23:59:59`;

  const [profilesRes, projectsRes, eventsRes, receiptsRes, visitsRes] = await Promise.all([
    fetchAllRows<AnnualProfileRow>((from, to) =>
      supabase
        .from("profiles")
        .select(ANNUAL_PROFILE_SELECT)
        .order("name", { ascending: true })
        .range(from, to)
        .returns<AnnualProfileRow[]>(),
    ),
    fetchAllRows<AnnualProjectRow>((from, to) =>
      supabase
        .from("projects")
        .select(ANNUAL_PROJECT_SELECT)
        .order("name", { ascending: true })
        .range(from, to)
        .returns<AnnualProjectRow[]>(),
    ),
    fetchAllRows<AnnualEventRow>((from, to) =>
      supabase
        .from("time_events")
        .select(ANNUAL_TIME_EVENT_SELECT)
        .gte("event_time", yearStart)
        .lte("event_time", yearEnd)
        .in("event_type", PAYROLL_EVENT_TYPES)
        .order("event_time", { ascending: true })
        .range(from, to)
        .returns<AnnualEventRow[]>(),
    ),
    fetchAllRows<AnnualReceiptRow>((from, to) =>
      supabase
        .from("media")
        .select(ANNUAL_RECEIPT_SELECT)
        .eq("metadata->>category", "receipt")
        .is("deleted_at", null)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd)
        .order("created_at", { ascending: true })
        .range(from, to)
        .returns<AnnualReceiptRow[]>(),
    ),
    fetchAllRows<AnnualStoreVisitRow>((from, to) =>
      supabase
        .from("store_visits")
        .select(ANNUAL_STORE_VISIT_SELECT)
        .gte("entered_at", yearStart)
        .lte("entered_at", yearEnd)
        .range(from, to)
        .returns<AnnualStoreVisitRow[]>(),
    ),
  ]);

  if (profilesRes.error || projectsRes.error || eventsRes.error || receiptsRes.error) {
    const error = profilesRes.error ?? projectsRes.error ?? eventsRes.error ?? receiptsRes.error;
    return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
  }

  const eventSummary = summarizeEvents(eventsRes.data);
  const receiptSummary = summarizeReceipts(receiptsRes.data);
  const visitRows = visitsRes.error ? [] : visitsRes.data;
  const visitSummary = summarizeStoreVisits(visitRows);

  return NextResponse.json({
    profiles: profilesRes.data,
    projects: projectsRes.data,
    ...eventSummary,
    ...receiptSummary,
    ...visitSummary,
    storeVisitsUnavailable: Boolean(visitsRes.error),
    sourceRowCounts: {
      profiles: profilesRes.data.length,
      projects: projectsRes.data.length,
      timeEvents: eventsRes.data.length,
      receipts: receiptsRes.data.length,
      storeVisits: visitRows.length,
    },
  });
}
