import { describe, expect, it } from "vitest";
import {
  buildArchivedProjectRows,
  buildPaidPayrollArchive,
  filterArchivedProjectsByDateRange,
  filterPayrollArchive,
  filterPayrollArchiveByDateRange,
  getActiveOperationalMedia,
  getActiveOperationalTasks,
  NO_PROJECT_SPLIT_FILTER,
} from "@/lib/archive-utils";
import { getOverviewStats } from "@/lib/manager-utils";
import type { ManagerSession, ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Media,
  Organization,
  PayrollLineItem,
  PayrollRun,
  Profile,
  Project,
  Task,
} from "@/types/database";

function profile(overrides: Partial<Profile> & Pick<Profile, "id" | "name">): Profile {
  return {
    org_id: "org",
    role: "worker",
    pin_hash: null,
    color: "#fff",
    is_active: true,
    require_video: false,
    hourly_rate: 99,
    language: "en",
    settings: {},
    last_clock_in: null,
    current_project: null,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function project(overrides: Partial<Project> & Pick<Project, "id" | "name">): Project {
  return {
    org_id: "org",
    address: null,
    notes: null,
    status: "active",
    rate: 25,
    site_point: null,
    radius_m: 100,
    start_date: null,
    end_date: null,
    settings: {},
    timeline_status: "on_track",
    budget_status: "on_budget",
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    org_id: "org",
    project_id: null,
    assigned_to: null,
    assigned_by: null,
    description: null,
    priority: "medium",
    status: "pending",
    due_date: null,
    completed_at: null,
    completed_by: null,
    metadata: {},
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function media(overrides: Partial<Media> & Pick<Media, "id" | "project_id">): Media {
  return {
    org_id: "org",
    uploaded_by: "worker",
    media_type: "photo",
    storage_path: `${overrides.id}.jpg`,
    filename: null,
    file_size: null,
    mime_type: null,
    caption: null,
    is_checkout: false,
    time_event_id: null,
    ai_analysis: null,
    metadata: {},
    deleted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function session(overrides: Partial<ManagerSession> & Pick<ManagerSession, "id" | "projectId" | "profileId">): ManagerSession {
  return {
    profileName: "Worker",
    profileRole: "worker",
    projectName: "Archived",
    clockInEventId: "in",
    clockOutEventId: "out",
    clockInTime: "2026-02-01T08:00:00Z",
    clockOutTime: "2026-02-01T12:00:00Z",
    durationMinutes: 240,
    checkoutStatus: "uploaded",
    isOpen: false,
    eventIds: ["in", "out"],
    checkoutNote: null,
    ...overrides,
  };
}

function workspace(overrides: Partial<ManagerWorkspaceData> = {}): ManagerWorkspaceData {
  const org: Organization = {
    id: "org",
    name: "NW Build Pro",
    slug: "nw-build-pro",
    settings: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  return {
    manager: profile({ id: "manager", name: "Manager", role: "manager" }),
    org,
    profiles: [],
    projects: [],
    assignments: [],
    tasks: [],
    timeEvents: [],
    media: [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: [],
    ...overrides,
  };
}

describe("archive helpers", () => {
  it("keeps archived project tasks/media out of active operations but available in archive rows", () => {
    const active = project({ id: "active", name: "Active" });
    const archived = project({
      id: "archived",
      name: "Archived",
      status: "archived",
      archived_at: "2026-03-01T00:00:00Z",
    });
    const tasks = [
      task({ id: "t-active", title: "Active task", project_id: active.id }),
      task({ id: "t-archived", title: "Archived task", project_id: archived.id }),
    ];
    const mediaRows = [
      media({ id: "m-active", project_id: active.id }),
      media({ id: "m-archived", project_id: archived.id }),
    ];

    expect(getActiveOperationalTasks(tasks, [active, archived]).map((item) => item.id)).toEqual([
      "t-active",
    ]);
    expect(getActiveOperationalMedia(mediaRows, [active, archived]).map((item) => item.id)).toEqual([
      "m-active",
    ]);

    const archiveRows = buildArchivedProjectRows({
      projects: [active, archived],
      tasks,
      media: mediaRows,
      sessions: [session({ id: "s1", projectId: archived.id, profileId: "w1" })],
      assignments: [],
      includeFinancials: true,
    });

    expect(archiveRows).toHaveLength(1);
    expect(archiveRows[0]).toMatchObject({
      id: "archived",
      taskCount: 1,
      mediaCount: 1,
      hours: 4,
    });
  });

  it("keeps archived project tasks out of overview open-task counts", () => {
    const active = project({ id: "active", name: "Active" });
    const archived = project({ id: "archived", name: "Archived", status: "archived" });
    const data = workspace({
      projects: [active, archived],
      tasks: [
        task({ id: "active-open", title: "Active open", project_id: active.id }),
        task({ id: "archived-open", title: "Archived open", project_id: archived.id }),
      ],
    });

    const stats = getOverviewStats(data, [], [], []);

    expect(stats.openTaskCount).toBe(1);
  });

  it("treats deleted_at rows as Trash, not Archive", () => {
    const trashedProject = project({
      id: "trash",
      name: "Trash",
      status: "archived",
      deleted_at: "2026-03-02T00:00:00Z",
    });
    const archived = project({ id: "archived", name: "Archived", status: "archived" });

    const archiveRows = buildArchivedProjectRows({
      projects: [trashedProject, archived],
      tasks: [
        task({ id: "deleted-task", title: "Deleted", project_id: archived.id, deleted_at: "2026-03-02T00:00:00Z" }),
      ],
      media: [
        media({ id: "deleted-media", project_id: archived.id, deleted_at: "2026-03-02T00:00:00Z" }),
      ],
      sessions: [],
      assignments: [],
      includeFinancials: true,
    });

    expect(archiveRows).toHaveLength(1);
    expect(archiveRows[0].id).toBe("archived");
    expect(archiveRows[0].taskCount).toBe(0);
    expect(archiveRows[0].mediaCount).toBe(0);
  });

  it("uses paid payroll records instead of current hourly-rate guesses", () => {
    const worker = profile({ id: "worker", name: "Worker", hourly_rate: 999 });
    const archive = buildPaidPayrollArchive(
      {
        profiles: [worker],
        projects: [],
        payPeriods: [
          {
            id: "period",
            label: "April",
            start_date: "2026-04-01",
            end_date: "2026-04-15",
            status: "paid",
            paid_at: "2026-04-16T00:00:00Z",
          },
        ],
        payPeriodItems: [
          {
            id: "item",
            pay_period_id: "period",
            worker_id: worker.id,
            regular_hours: 10,
            overtime_hours: 2,
            gross_total: 500,
            status: "paid",
          },
        ],
        payrollRuns: [],
        payrollLineItems: [],
      },
      { includeFinancials: true },
    );

    expect(archive.rows[0].paidHours).toBe(12);
    expect(archive.rows[0].grossPaid).toBe(500);
  });

  it("hides paid amounts for non-finance managers while preserving paid hours", () => {
    const worker = profile({ id: "worker", name: "Worker" });
    const run: PayrollRun = {
      id: "run",
      org_id: "org",
      run_by: "owner",
      period_start: "2026-05-01",
      period_end: "2026-05-15",
      status: "confirmed",
      total_hours: 8,
      total_amount: 320,
      notes: null,
      metadata: {},
      created_at: "2026-05-16T00:00:00Z",
      confirmed_at: "2026-05-16T00:00:00Z",
    };
    const lineItem: PayrollLineItem = {
      id: "line",
      payroll_run_id: run.id,
      profile_id: worker.id,
      project_id: null,
      hours: 8,
      rate: 40,
      amount: 320,
      event_ids: [],
      metadata: {},
      created_at: "2026-05-16T00:00:00Z",
    };

    const hidden = buildPaidPayrollArchive(
      {
        profiles: [worker],
        projects: [],
        payPeriods: [],
        payPeriodItems: [],
        payrollRuns: [run],
        payrollLineItems: [lineItem],
      },
      { includeFinancials: false },
    );

    expect(hidden.totalPaidHours).toBe(8);
    expect(hidden.totalGrossPaid).toBe(0);
    expect(hidden.rows[0].grossPaid).toBe(0);
    expect(hidden.rows[0].periods[0].grossPaid).toBe(0);
  });

  it("filters archived projects by archived date with updated_at fallback", () => {
    const rows = buildArchivedProjectRows({
      projects: [
        project({
          id: "jan",
          name: "January",
          status: "archived",
          archived_at: "2026-01-15T12:00:00Z",
        }),
        project({
          id: "feb",
          name: "February fallback",
          status: "archived",
          updated_at: "2026-02-10T12:00:00Z",
        }),
      ],
      tasks: [],
      media: [],
      sessions: [],
      assignments: [],
      includeFinancials: true,
    });

    expect(filterArchivedProjectsByDateRange(rows, {
      fromDate: "2026-02-01",
      toDate: "2026-02-28",
    }).map((row) => row.id)).toEqual(["feb"]);
  });

  it("filters payroll archive periods by overlapping date range and recalculates totals", () => {
    const worker = profile({ id: "worker", name: "Worker" });
    const archive = buildPaidPayrollArchive(
      {
        profiles: [worker],
        projects: [],
        payPeriods: [
          {
            id: "april",
            label: "April",
            start_date: "2026-04-01",
            end_date: "2026-04-15",
            status: "paid",
            paid_at: "2026-04-16T00:00:00Z",
          },
          {
            id: "may",
            label: "May",
            start_date: "2026-05-01",
            end_date: "2026-05-15",
            status: "paid",
            paid_at: "2026-05-16T00:00:00Z",
          },
        ],
        payPeriodItems: [
          {
            id: "april-item",
            pay_period_id: "april",
            worker_id: worker.id,
            regular_hours: 10,
            overtime_hours: 0,
            gross_total: 400,
            status: "paid",
          },
          {
            id: "may-item",
            pay_period_id: "may",
            worker_id: worker.id,
            regular_hours: 5,
            overtime_hours: 1,
            gross_total: 300,
            status: "paid",
          },
        ],
        payrollRuns: [],
        payrollLineItems: [],
      },
      { includeFinancials: true },
    );

    const filtered = filterPayrollArchiveByDateRange(archive, {
      fromDate: "2026-04-10",
      toDate: "2026-04-30",
    });

    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].periods.map((period) => period.label)).toEqual(["April"]);
    expect(filtered.totalPaidHours).toBe(10);
    expect(filtered.totalGrossPaid).toBe(400);
  });

  it("filters payroll archive by worker and project while recalculating totals", () => {
    const workerA = profile({ id: "worker-a", name: "Andrew" });
    const workerB = profile({ id: "worker-b", name: "Vasia" });
    const home = project({ id: "home", name: "Home" });
    const shop = project({ id: "shop", name: "Shop" });
    const run: PayrollRun = {
      id: "run",
      org_id: "org",
      run_by: "owner",
      period_start: "2026-05-01",
      period_end: "2026-05-15",
      status: "confirmed",
      total_hours: 17,
      total_amount: 700,
      notes: null,
      metadata: {},
      created_at: "2026-05-16T00:00:00Z",
      confirmed_at: "2026-05-16T00:00:00Z",
    };
    const archive = buildPaidPayrollArchive(
      {
        profiles: [workerA, workerB],
        projects: [home, shop],
        payPeriods: [],
        payPeriodItems: [],
        payrollRuns: [run],
        payrollLineItems: [
          {
            id: "home-a",
            payroll_run_id: run.id,
            profile_id: workerA.id,
            project_id: home.id,
            hours: 8,
            rate: 40,
            amount: 320,
            event_ids: [],
            metadata: {},
            created_at: "2026-05-16T00:00:00Z",
          },
          {
            id: "shop-a",
            payroll_run_id: run.id,
            profile_id: workerA.id,
            project_id: shop.id,
            hours: 4,
            rate: 40,
            amount: 160,
            event_ids: [],
            metadata: {},
            created_at: "2026-05-16T00:00:00Z",
          },
          {
            id: "home-b",
            payroll_run_id: run.id,
            profile_id: workerB.id,
            project_id: home.id,
            hours: 5,
            rate: 44,
            amount: 220,
            event_ids: [],
            metadata: {},
            created_at: "2026-05-16T00:00:00Z",
          },
        ],
      },
      { includeFinancials: true },
    );

    const filtered = filterPayrollArchive(archive, {
      workerId: workerA.id,
      projectName: home.name,
      year: 2026,
    });

    expect(filtered.rows).toHaveLength(1);
    expect(filtered.rows[0].workerName).toBe(workerA.name);
    expect(filtered.rows[0].projectNames).toEqual([home.name]);
    expect(filtered.totalPaidHours).toBe(8);
    expect(filtered.totalGrossPaid).toBe(320);
  });

  it("can filter payroll archive to rows without project split", () => {
    const worker = profile({ id: "worker", name: "Worker" });
    const archive = buildPaidPayrollArchive(
      {
        profiles: [worker],
        projects: [],
        payPeriods: [
          {
            id: "period",
            label: "June",
            start_date: "2026-06-01",
            end_date: "2026-06-15",
            status: "paid",
            paid_at: "2026-06-16T00:00:00Z",
          },
        ],
        payPeriodItems: [
          {
            id: "item",
            pay_period_id: "period",
            worker_id: worker.id,
            regular_hours: 6,
            overtime_hours: 0,
            gross_total: 240,
            status: "paid",
          },
        ],
        payrollRuns: [],
        payrollLineItems: [],
      },
      { includeFinancials: true },
    );

    const filtered = filterPayrollArchive(archive, {
      projectName: NO_PROJECT_SPLIT_FILTER,
    });

    expect(filtered.totalPaidHours).toBe(6);
    expect(filtered.totalGrossPaid).toBe(240);
  });
});
