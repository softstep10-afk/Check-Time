import { afterEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

type QueryPlan = QueryResult | "never";

const workerUser = {
  id: "worker-1",
  email: "worker@example.com",
  user_metadata: {},
};

const workerProfile = {
  id: workerUser.id,
  org_id: "org-1",
  name: "Worker One",
  role: "worker",
  color: "#9ca3af",
  is_active: true,
  require_video: false,
  language: "en",
  settings: {},
  last_clock_in: null,
  current_project: null,
  notif_mode: "silent",
  project_access_mode: "list",
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

class QueryBuilder implements PromiseLike<QueryResult> {
  constructor(private readonly plan: QueryPlan) {}

  select() {
    return this;
  }

  eq() {
    return this;
  }

  is() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  returns() {
    return this;
  }

  maybeSingle() {
    return this.resolve();
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.resolve().then(onfulfilled, onrejected);
  }

  private resolve() {
    if (this.plan === "never") {
      return new Promise<QueryResult>(() => {});
    }
    return Promise.resolve(this.plan);
  }
}

function ok(data: unknown): QueryResult {
  return { data, error: null };
}

function fail(message: string): QueryResult {
  return { data: null, error: { message } };
}

function makeSupabase(overrides: Partial<Record<string, QueryPlan>> = {}) {
  const plans: Record<string, QueryPlan> = {
    profiles: ok(workerProfile),
    project_assignments: ok([]),
    time_events: ok([]),
    payroll_closures: ok([]),
    tasks: ok([]),
    media: ok([]),
    projects: ok([]),
    project_exclusions: ok([]),
    ...overrides,
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: workerUser },
        error: null,
      }),
    },
    from: vi.fn((table: string) => new QueryBuilder(plans[table] ?? ok([]))),
  };
}

async function loadWorkerData() {
  vi.resetModules();
  return import("@/lib/worker-data");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  createClientMock.mockReset();
});

describe("worker data graceful fallback", () => {
  it("returns a worker shell when a non-critical query errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createClientMock.mockResolvedValue(
      makeSupabase({
        project_assignments: fail("simulated assignments failure"),
      }),
    );

    const { getWorkerShellData } = await loadWorkerData();
    const data = await getWorkerShellData();

    expect(data.profile.id).toBe(workerUser.id);
    expect(data.projects).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.media).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Worker assignments query"),
    );
  });

  it("returns a worker shell when a non-critical query times out", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createClientMock.mockResolvedValue(
      makeSupabase({
        project_assignments: "never",
      }),
    );

    const { getWorkerShellData } = await loadWorkerData();
    const dataPromise = getWorkerShellData();

    await vi.advanceTimersByTimeAsync(7_000);
    const data = await dataPromise;

    expect(data.profile.id).toBe(workerUser.id);
    expect(data.projects).toEqual([]);
    expect(data.tasks).toEqual([]);
    expect(data.media).toEqual([]);
    expect(data.sessions).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Worker assignments query"),
    );
  });
});
