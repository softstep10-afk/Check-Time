import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCommandCenterBase,
  buildCommandCenterModel,
  type CommandCenterLabels,
} from "@/lib/command-center-model";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Organization,
  Profile,
  Project,
  ProjectAssignment,
  Task,
  TimeEvent,
} from "@/types/database";

const labels: CommandCenterLabels = {
  actionShift: "Shift review",
  actionTravelGap: "Travel gap",
  actionTask: "Open task",
  generalTask: "General task",
  shiftReviewLabel: {
    normal: "Normal",
    long_shift: "Long shift",
    gps_stale: "GPS stale",
    gps_lost: "GPS lost",
    no_gps: "No GPS",
    needs_review: "Needs review",
    video_missing: "Video missing",
  },
};

function makeProfile(overrides: Partial<Profile> & Pick<Profile, "id" | "name">): Profile {
  return {
    org_id: "org",
    role: "worker",
    pin_hash: null,
    color: "#ffffff",
    is_active: true,
    require_video: false,
    hourly_rate: 30,
    language: "en",
    settings: {},
    last_clock_in: null,
    current_project: null,
    deleted_at: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> & Pick<Project, "id" | "name">): Project {
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
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "title">): Task {
  return {
    org_id: "org",
    project_id: null,
    assigned_to: null,
    assigned_by: "mgr",
    description: null,
    priority: "medium",
    status: "pending",
    due_date: null,
    completed_at: null,
    completed_by: null,
    metadata: {},
    deleted_at: null,
    created_at: "2026-05-13T10:00:00Z",
    updated_at: "2026-05-13T10:00:00Z",
    ...overrides,
  };
}

function makeEvent(
  overrides: Partial<TimeEvent> & Pick<TimeEvent, "id" | "profile_id" | "project_id" | "event_type" | "event_time">,
): TimeEvent {
  return {
    org_id: "org",
    server_time: overrides.event_time,
    gps_point: null,
    gps_accuracy_m: null,
    gps_source: null,
    adjusts_event_id: null,
    adjust_reason: null,
    adjusted_by: null,
    video_status: "not_required",
    video_storage_path: null,
    notes: null,
    metadata: {},
    created_at: overrides.event_time,
    ...overrides,
  };
}

function workspace(opts: {
  profiles?: Profile[];
  projects?: Project[];
  assignments?: ProjectAssignment[];
  tasks?: Task[];
  timeEvents?: TimeEvent[];
} = {}): ManagerWorkspaceData {
  const org: Organization = {
    id: "org",
    name: "Test",
    slug: "test",
    settings: {},
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
  };
  return {
    manager: makeProfile({ id: "mgr", name: "Manager", role: "owner" }),
    org,
    profiles: opts.profiles ?? [],
    projects: opts.projects ?? [],
    assignments: opts.assignments ?? [],
    tasks: opts.tasks ?? [],
    timeEvents: opts.timeEvents ?? [],
    media: [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: [],
  };
}

function buildModel(data: ManagerWorkspaceData) {
  const base = buildCommandCenterBase(data, {
    includeFinancials: true,
    now: new Date("2026-05-13T13:30:00Z"),
  });
  return buildCommandCenterModel({ base, labels, queueLimit: 10 });
}

describe("command center model", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-13T13:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("promotes a long open shift with no GPS into a critical manager action", () => {
    const worker = makeProfile({ id: "w1", name: "Vasia" });
    const project = makeProject({ id: "p1", name: "Home" });
    const data = workspace({
      profiles: [worker],
      projects: [project],
      timeEvents: [
        makeEvent({
          id: "in1",
          profile_id: worker.id,
          project_id: project.id,
          event_type: "clock_in",
          event_time: "2026-05-13T00:00:00Z",
        }),
      ],
    });

    const model = buildModel(data);

    expect(model.needsReviewCount).toBe(1);
    expect(model.criticalActionCount).toBe(1);
    expect(model.primaryAction?.kind).toBe("open_shift");
    expect(model.primaryAction?.title).toBe("Vasia");
  });

  it("does not surface archived project tasks in the manager action queue", () => {
    const project = makeProject({ id: "p1", name: "Archived", status: "archived" });
    const data = workspace({
      projects: [project],
      tasks: [
        makeTask({
          id: "t1",
          title: "Old urgent task",
          project_id: project.id,
          priority: "urgent",
        }),
      ],
    });

    const model = buildModel(data);

    expect(model.commandQueue.totalCount).toBe(0);
    expect(model.urgentTasks).toEqual([]);
  });

  it("puts payroll-blocking closed shift review ahead of high tasks", () => {
    const worker = makeProfile({ id: "w1", name: "Dima", require_video: true });
    const project = makeProject({ id: "p1", name: "Kitchen" });
    const data = workspace({
      profiles: [worker],
      projects: [project],
      tasks: [
        makeTask({
          id: "t1",
          title: "Measure cabinets",
          project_id: project.id,
          priority: "high",
        }),
      ],
      timeEvents: [
        makeEvent({
          id: "in1",
          profile_id: worker.id,
          project_id: project.id,
          event_type: "clock_in",
          event_time: "2026-05-12T09:00:00Z",
          gps_point: "POINT(-122 47)",
        }),
        makeEvent({
          id: "out1",
          profile_id: worker.id,
          project_id: project.id,
          event_type: "clock_out",
          event_time: "2026-05-12T17:00:00Z",
          video_status: "pending",
        }),
      ],
    });

    const model = buildModel(data);

    expect(model.closedShiftAlerts).toHaveLength(1);
    expect(model.actionItems.map((item) => item.kind)).toEqual([
      "closed_shift",
      "task",
    ]);
    expect(model.primaryAction?.severity).toBe(0);
  });
});
