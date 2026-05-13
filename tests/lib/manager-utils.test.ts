import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBillableTransferGapRows,
  buildPayrollDraftRows,
  buildProfileSummaries,
  buildProjectSummaries,
  buildWorkerDisambiguationMap,
  computeOvertime,
  computePayrollPreview,
  buildManagerSessions,
  detectTransferGaps,
  formatWorkerDisplayLabel,
  groupPayrollRowsByDay,
  groupPayrollRowsByWorker,
  getOverviewStats,
  isOpenTask,
  isOwnerRole,
  isManagerRole,
  sessionMinutesInWindow,
  sumDraftRowMinutes,
  TRANSFER_GAP_CRITICAL_MINUTES,
  TRANSFER_GAP_WARNING_MINUTES,
} from "@/lib/manager-utils";
import type { ManagerSession } from "@/lib/manager-types";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Organization,
  PayrollClosure,
  Profile,
  Project,
  ProjectAssignment,
  Task,
  TimeEvent,
} from "@/types/database";

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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TimeEvent> & Pick<TimeEvent, "id" | "profile_id" | "project_id" | "event_type" | "event_time">): TimeEvent {
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
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeWorkspace(opts: {
  profiles?: Profile[];
  projects?: Project[];
  assignments?: ProjectAssignment[];
  tasks?: Task[];
  timeEvents?: TimeEvent[];
  payrollClosures?: PayrollClosure[];
}): ManagerWorkspaceData {
  const org: Organization = {
    id: "org",
    name: "Test",
    slug: "test",
    settings: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  return {
    manager: makeProfile({ id: "mgr", name: "Manager", role: "manager" }),
    org,
    profiles: opts.profiles ?? [],
    projects: opts.projects ?? [],
    assignments: opts.assignments ?? [],
    tasks: opts.tasks ?? [],
    timeEvents: opts.timeEvents ?? [],
    media: [],
    payrollRuns: [],
    payrollClosures: opts.payrollClosures ?? [],
    storeVisits: [],
  };
}

// ─────────────────────────────────────────────────────────────────────
// computeOvertime — pure helper
// ─────────────────────────────────────────────────────────────────────

describe("computeOvertime", () => {
  it("returns zero for zero hours", () => {
    const r = computeOvertime(0, 30);
    expect(r.regularHours).toBe(0);
    expect(r.overtimeHours).toBe(0);
    expect(r.regularPay).toBe(0);
    expect(r.overtimePay).toBe(0);
    expect(r.grossPay).toBe(0);
  });

  it("computes straight-line pay below the 40h threshold", () => {
    const r = computeOvertime(20, 30);
    expect(r.regularHours).toBe(20);
    expect(r.overtimeHours).toBe(0);
    expect(r.regularPay).toBe(600);
    expect(r.overtimePay).toBe(0);
    expect(r.grossPay).toBe(600);
  });

  it("treats exactly 40h as all regular, no OT", () => {
    const r = computeOvertime(40, 25);
    expect(r.regularHours).toBe(40);
    expect(r.overtimeHours).toBe(0);
    expect(r.grossPay).toBe(1000);
  });

  it("splits 60h into 40 reg + 20 OT at 1.5×", () => {
    const r = computeOvertime(60, 20);
    expect(r.regularHours).toBe(40);
    expect(r.overtimeHours).toBe(20);
    expect(r.regularPay).toBe(800); // 40 * 20
    expect(r.overtimePay).toBe(600); // 20 * 20 * 1.5
    expect(r.grossPay).toBe(1400);
  });

  it("handles 41h with one OT hour", () => {
    const r = computeOvertime(41, 10);
    expect(r.regularHours).toBe(40);
    expect(r.overtimeHours).toBe(1);
    expect(r.overtimePay).toBe(15); // 1 * 10 * 1.5
    expect(r.grossPay).toBe(415);
  });

  it("respects a custom OT threshold and multiplier", () => {
    const r = computeOvertime(50, 20, { threshold: 35, multiplier: 2 });
    expect(r.regularHours).toBe(35);
    expect(r.overtimeHours).toBe(15);
    expect(r.overtimePay).toBe(600); // 15 * 20 * 2
    expect(r.grossPay).toBe(1300); // 700 + 600
  });

  it("clamps negative hours to zero", () => {
    const r = computeOvertime(-5, 25);
    expect(r.regularHours).toBe(0);
    expect(r.grossPay).toBe(0);
  });

  it("clamps NaN inputs to zero", () => {
    const r = computeOvertime(Number.NaN, 25);
    expect(r.grossPay).toBe(0);
  });

  it("clamps a missing rate to zero pay", () => {
    const r = computeOvertime(50, 0);
    expect(r.regularHours).toBe(40);
    expect(r.overtimeHours).toBe(10);
    expect(r.grossPay).toBe(0);
  });

  it("rounds money to two decimals on awkward fractions", () => {
    const r = computeOvertime(40.333, 17.77);
    // regularHours rounded display, regularPay rounded to 2 decimals
    expect(r.regularPay).toBe(710.8); // 40 * 17.77 = 710.8
    expect(r.overtimePay).toBeCloseTo(0.333 * 17.77 * 1.5, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// buildManagerSessions + computePayrollPreview
// ─────────────────────────────────────────────────────────────────────

describe("buildManagerSessions", () => {
  it("pairs clock_in with clock_out into a single closed session", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1" })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isOpen).toBe(false);
    expect(sessions[0].durationMinutes).toBe(8 * 60);
    expect(sessions[0].clockOutEventId).toBe("e2");
  });

  it("leaves an unclosed clock_in as an open session", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1" })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].isOpen).toBe(true);
    expect(sessions[0].clockOutEventId).toBeNull();
    expect(sessions[0].checkoutNote).toBeNull();
  });

  it("preserves a checkout note from clock_out event metadata onto the session", () => {
    // Worker types "I left early because of rain" in CheckoutModal —
    // WorkerShell.clockOut writes it to time_events.metadata.checkout_note
    // so the manager Day Detail / recent-shifts surface can render it.
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1" })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({
          id: "e1",
          profile_id: "w1",
          project_id: "p1",
          event_type: "clock_in",
          event_time: "2026-04-01T08:00:00Z",
        }),
        makeEvent({
          id: "e2",
          profile_id: "w1",
          project_id: "p1",
          event_type: "clock_out",
          event_time: "2026-04-01T13:00:00Z",
          metadata: { checkout_note: "I left early because of rain" },
        }),
      ],
    });
    const sessions = buildManagerSessions(data);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].checkoutNote).toBe("I left early because of rain");
  });

  it("treats whitespace-only or missing checkout note as null", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1" })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({
          id: "e1",
          profile_id: "w1",
          project_id: "p1",
          event_type: "clock_in",
          event_time: "2026-04-01T08:00:00Z",
        }),
        makeEvent({
          id: "e2",
          profile_id: "w1",
          project_id: "p1",
          event_type: "clock_out",
          event_time: "2026-04-01T13:00:00Z",
          metadata: { checkout_note: "   " },
        }),
      ],
    });
    const sessions = buildManagerSessions(data);
    expect(sessions[0].checkoutNote).toBeNull();
  });
});

describe("buildProjectSummaries", () => {
  it("flags null and invalid site points as missing GPS", () => {
    const data = makeWorkspace({
      projects: [
        makeProject({ id: "missing", name: "Missing GPS", site_point: null }),
        makeProject({ id: "invalid", name: "Invalid GPS", site_point: "SRID=4326;POINT(-181 95)" }),
        makeProject({ id: "valid", name: "Valid GPS", site_point: "SRID=4326;POINT(-122.4194 37.7749)" }),
      ],
    });

    const summaries = buildProjectSummaries(data, []);
    const byId = new Map(summaries.map((project) => [project.id, project]));

    expect(byId.get("missing")?.hasValidSiteCoordinates).toBe(false);
    expect(byId.get("missing")?.siteCoordinates).toBeNull();

    expect(byId.get("invalid")?.hasValidSiteCoordinates).toBe(false);
    expect(byId.get("invalid")?.siteCoordinates).toBeNull();

    expect(byId.get("valid")?.hasValidSiteCoordinates).toBe(true);
    expect(byId.get("valid")?.siteCoordinates).toEqual({
      lat: 37.7749,
      lng: -122.4194,
    });
  });

  it("excludes soft-deleted tasks from open task counts", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Worker 1" })],
      projects: [makeProject({ id: "p1", name: "Project 1" })],
      tasks: [
        makeTask({
          id: "open",
          title: "Open task",
          project_id: "p1",
          assigned_to: "w1",
          status: "pending",
        }),
        makeTask({
          id: "deleted-open",
          title: "Deleted open task",
          project_id: "p1",
          assigned_to: "w1",
          status: "pending",
          deleted_at: "2026-01-02T00:00:00Z",
        }),
        makeTask({
          id: "done",
          title: "Done task",
          project_id: "p1",
          assigned_to: "w1",
          status: "done",
          completed_at: "2026-01-02T00:00:00Z",
        }),
      ],
    });

    const projectSummaries = buildProjectSummaries(data, []);
    const profileSummaries = buildProfileSummaries(data, []);
    const stats = getOverviewStats(data, [], projectSummaries, profileSummaries);

    expect(isOpenTask(data.tasks[0])).toBe(true);
    expect(isOpenTask(data.tasks[1])).toBe(false);
    expect(projectSummaries.find((project) => project.id === "p1")?.openTaskCount).toBe(1);
    expect(profileSummaries.find((profile) => profile.id === "w1")?.openTaskCount).toBe(1);
    expect(stats.openTaskCount).toBe(1);
  });

  it("keeps archived project names out of active profile summaries", () => {
    const activeProject = makeProject({ id: "active", name: "Active" });
    const archivedProject = makeProject({
      id: "archived",
      name: "Archived",
      status: "archived",
    });
    const data = makeWorkspace({
      profiles: [
        makeProfile({
          id: "w1",
          name: "Worker 1",
          current_project: archivedProject.id,
        }),
      ],
      projects: [activeProject, archivedProject],
      assignments: [
        {
          id: "a1",
          org_id: "org",
          profile_id: "w1",
          project_id: activeProject.id,
          assigned_at: "2026-01-01T00:00:00Z",
        },
        {
          id: "a2",
          org_id: "org",
          profile_id: "w1",
          project_id: archivedProject.id,
          assigned_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const summary = buildProfileSummaries(data, []).find((profile) => profile.id === "w1");

    expect(summary?.assignedProjectIds).toEqual([activeProject.id]);
    expect(summary?.assignedProjectNames).toEqual([activeProject.name]);
    expect(summary?.currentProjectName).toBeNull();
  });
});

describe("detectTransferGaps", () => {
  // 30-min and 90-min thresholds per the manager visibility spec. Defaults
  // exposed so test failures point at the constant if it ever changes.
  it("returns no gaps when no different-project transitions exist", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "e3", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    // Same-project re-clock = lunch break, not a transfer.
    expect(gaps).toHaveLength(0);
  });

  it("flags a 60-minute gap between two different projects as warning", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "e3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T12:00:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("warning");
    expect(gaps[0].gapMinutes).toBe(60);
    expect(gaps[0].fromProject).toBe("P1");
    expect(gaps[0].toProject).toBe("P2");
    expect(gaps[0].workerName).toBe("Vasia");
  });

  it("flags a 120-minute gap as critical", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "e3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("critical");
    expect(gaps[0].gapMinutes).toBe(120);
  });

  it("ignores gaps at or below the 30-minute warning threshold", () => {
    // Boundary: exactly TRANSFER_GAP_WARNING_MINUTES (30) is NOT a gap —
    // spec says "> 30 minutes" strict.
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({
          id: "e3",
          profile_id: "w1",
          project_id: "p2",
          event_type: "clock_in",
          event_time: `2026-04-01T11:${TRANSFER_GAP_WARNING_MINUTES.toString().padStart(2, "0")}:00Z`,
        }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(0);
  });

  it("uses critical severity strictly above the 90-minute critical threshold", () => {
    // Just above the critical cutoff: severity should bump to critical.
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({
          id: "e3",
          profile_id: "w1",
          project_id: "p2",
          event_type: "clock_in",
          event_time: `2026-04-01T12:${(TRANSFER_GAP_CRITICAL_MINUTES - 60 + 1)
            .toString()
            .padStart(2, "0")}:00Z`,
        }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("critical");
  });

  it("treats auto_out the same as clock_out for the leading edge", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "auto_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "e3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:30:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("critical");
  });

  it("scopes results to a single profile when profileId is provided", () => {
    const data = makeWorkspace({
      profiles: [
        makeProfile({ id: "w1", name: "Vasia" }),
        makeProfile({ id: "w2", name: "Other" }),
      ],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "a1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "a2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "a3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
        makeEvent({ id: "b1", profile_id: "w2", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w2", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "b3", profile_id: "w2", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
      ],
    });
    const all = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    const onlyVasia = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
      profileId: "w1",
    });
    expect(all).toHaveLength(2);
    expect(onlyVasia).toHaveLength(1);
    expect(onlyVasia[0].profileId).toBe("w1");
  });

  it("respects sinceIso to skip older events", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Vasia" })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        // Old transfer — should be ignored once sinceIso is set.
        makeEvent({ id: "old1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-03-15T08:00:00Z" }),
        makeEvent({ id: "old2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-03-15T11:00:00Z" }),
        makeEvent({ id: "old3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-03-15T13:00:00Z" }),
        // Recent transfer — should still be flagged.
        makeEvent({ id: "new1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "new2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "new3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
      sinceIso: "2026-04-01T00:00:00Z",
    });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].id).toContain("new");
  });

  it("sorts gaps by descending duration", () => {
    const data = makeWorkspace({
      profiles: [
        makeProfile({ id: "w1", name: "Worker A" }),
        makeProfile({ id: "w2", name: "Worker B" }),
      ],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        // 60 min gap
        makeEvent({ id: "a1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "a2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "a3", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T12:00:00Z" }),
        // 180 min gap
        makeEvent({ id: "b1", profile_id: "w2", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w2", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "b3", profile_id: "w2", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T14:00:00Z" }),
      ],
    });
    const gaps = detectTransferGaps({
      timeEvents: data.timeEvents,
      projects: data.projects,
      profiles: data.profiles,
    });
    expect(gaps).toHaveLength(2);
    expect(gaps[0].gapMinutes).toBe(180);
    expect(gaps[1].gapMinutes).toBe(60);
  });
});

describe("computePayrollPreview", () => {
  it("returns zero totals when there are no sessions", () => {
    const data = makeWorkspace({});
    const preview = computePayrollPreview(data, [], "2026-04-30");
    expect(preview.totalHours).toBe(0);
    expect(preview.totalAmount).toBe(0);
    expect(preview.lineCount).toBe(0);
    expect(preview.workersCount).toBe(0);
  });

  it("computes hours × rate for a single closed session", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 25 })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.totalHours).toBeCloseTo(8, 2);
    expect(preview.totalAmount).toBe(200);
    expect(preview.lineCount).toBe(1);
    expect(preview.workersCount).toBe(1);
  });

  it("groups one worker across multiple projects into separate lines", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 30 })],
      projects: [
        makeProject({ id: "p1", name: "P1" }),
        makeProject({ id: "p2", name: "P2" }),
      ],
      timeEvents: [
        makeEvent({ id: "a1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "a2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T12:00:00Z" }),
        makeEvent({ id: "b1", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T12:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w1", project_id: "p2", event_type: "clock_out", event_time: "2026-04-01T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.lines).toHaveLength(2);
    expect(preview.workersCount).toBe(1);
    expect(preview.totalHours).toBeCloseTo(8, 2);
    expect(preview.totalAmount).toBe(240);
  });

  it("includes paid same-day transfer time in payroll preview", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 30 })],
      projects: [
        makeProject({ id: "home", name: "Home" }),
        makeProject({ id: "dix", name: "DIX" }),
      ],
      timeEvents: [
        makeEvent({ id: "a1", profile_id: "w1", project_id: "home", event_type: "clock_in", event_time: "2026-05-10T16:00:00Z" }),
        makeEvent({ id: "a2", profile_id: "w1", project_id: "home", event_type: "clock_out", event_time: "2026-05-10T21:00:00Z" }),
        makeEvent({ id: "b1", profile_id: "w1", project_id: "dix", event_type: "clock_in", event_time: "2026-05-10T22:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w1", project_id: "dix", event_type: "clock_out", event_time: "2026-05-11T01:00:00Z" }),
      ],
    });

    const preview = computePayrollPreview(data, buildManagerSessions(data), "2026-05-31");

    expect(preview.totalHours).toBe(9);
    expect(preview.totalAmount).toBe(270);
    expect(preview.lines.find((line) => line.projectId === "dix")?.hours).toBe(4);
  });

  it("excludes hours before the latest payroll closure for that worker", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 20 })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "old1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-03-01T08:00:00Z" }),
        makeEvent({ id: "old2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-03-01T16:00:00Z" }),
        makeEvent({ id: "new1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-15T08:00:00Z" }),
        makeEvent({ id: "new2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-15T13:00:00Z" }),
      ],
      payrollClosures: [
        {
          id: "c1",
          org_id: "org",
          payroll_run_id: "r1",
          profile_id: "w1",
          closed_through: "2026-04-01T00:00:00Z",
          created_at: "2026-04-01T00:00:00Z",
        },
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    // Only the April 15 session should be paid (5h × $20).
    expect(preview.totalHours).toBeCloseTo(5, 2);
    expect(preview.totalAmount).toBe(100);
  });

  it("skips sessions whose worker no longer exists", () => {
    const data = makeWorkspace({
      // No profiles list — worker missing.
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "ghost", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "ghost", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.lineCount).toBe(0);
  });

  it("skips sessions that fully sit after the period end", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 30 })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "e1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-05-01T08:00:00Z" }),
        makeEvent({ id: "e2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-05-01T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.lineCount).toBe(0);
  });

  it("sums two same-day sessions on the same project + rate into one line", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "W1", hourly_rate: 25 })],
      projects: [makeProject({ id: "p1", name: "P1" })],
      timeEvents: [
        makeEvent({ id: "a1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T08:00:00Z" }),
        makeEvent({ id: "a2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T11:00:00Z" }),
        makeEvent({ id: "b1", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-04-01T18:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.lines).toHaveLength(1);
    expect(preview.totalHours).toBeCloseTo(8, 2);
    expect(preview.totalAmount).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Payroll Draft / review helpers
// ─────────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<ManagerSession> & Pick<ManagerSession, "id" | "profileId" | "projectId" | "clockInTime">,
): ManagerSession {
  const inMs = new Date(overrides.clockInTime).getTime();
  const outIso = overrides.clockOutTime ?? null;
  const durationMinutes =
    overrides.durationMinutes ??
    (outIso ? Math.round((new Date(outIso).getTime() - inMs) / 60_000) : 0);
  return {
    profileName: overrides.profileName ?? "Worker",
    profileRole: overrides.profileRole ?? "worker",
    projectName: overrides.projectName ?? "Project",
    clockInEventId: overrides.clockInEventId ?? `${overrides.id}-in`,
    clockOutEventId: overrides.clockOutEventId ?? (outIso ? `${overrides.id}-out` : null),
    clockOutTime: outIso,
    durationMinutes,
    checkoutStatus: overrides.checkoutStatus ?? "not_required",
    isOpen: overrides.isOpen ?? outIso === null,
    eventIds: overrides.eventIds ?? [`${overrides.id}-in`, `${overrides.id}-out`],
    checkoutNote: overrides.checkoutNote ?? null,
    ...overrides,
  };
}

describe("buildBillableTransferGapRows", () => {
  it("adds same-day time between different projects as a billable gap", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s1",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "home",
        projectName: "Home",
        clockInTime: "2026-05-10T16:00:00Z",
        clockOutTime: "2026-05-10T21:00:00Z",
      }),
      makeSession({
        id: "s2",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "dix",
        projectName: "DIX",
        clockInTime: "2026-05-10T22:00:00Z",
        clockOutTime: "2026-05-11T01:00:00Z",
      }),
    ];

    const gaps = buildBillableTransferGapRows({
      sessions,
      startDate: "2026-05-10",
      endDate: "2026-05-10",
      timeZone: "America/Los_Angeles",
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      profileId: "w1",
      fromProject: "Home",
      toProject: "DIX",
      gapMinutes: 60,
    });
  });

  it("does not pay overnight gaps between different work days", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s1",
        profileId: "w1",
        projectId: "home",
        projectName: "Home",
        clockInTime: "2026-05-10T16:00:00Z",
        clockOutTime: "2026-05-11T02:00:00Z",
      }),
      makeSession({
        id: "s2",
        profileId: "w1",
        projectId: "dix",
        projectName: "DIX",
        clockInTime: "2026-05-11T13:00:00Z",
        clockOutTime: "2026-05-11T20:00:00Z",
      }),
    ];

    expect(
      buildBillableTransferGapRows({
        sessions,
        startDate: "2026-05-10",
        endDate: "2026-05-11",
        timeZone: "America/Los_Angeles",
      }),
    ).toHaveLength(0);
  });

  it("cuts already-closed transfer time out of a new payroll window", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s1",
        profileId: "w1",
        projectId: "home",
        projectName: "Home",
        clockInTime: "2026-05-10T16:00:00Z",
        clockOutTime: "2026-05-10T21:00:00Z",
      }),
      makeSession({
        id: "s2",
        profileId: "w1",
        projectId: "dix",
        projectName: "DIX",
        clockInTime: "2026-05-10T23:00:00Z",
        clockOutTime: "2026-05-11T01:00:00Z",
      }),
    ];

    const gaps = buildBillableTransferGapRows({
      sessions,
      startDate: "2026-05-10",
      endDate: "2026-05-10",
      closedThroughByProfileId: {
        w1: "2026-05-10T22:00:00Z",
      },
      timeZone: "America/Los_Angeles",
    });

    expect(gaps).toHaveLength(1);
    expect(gaps[0].gapMinutes).toBe(60);
  });
});

describe("buildPayrollDraftRows", () => {
  it("includes same-day project transfer gaps as paid review rows", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s1",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "home",
        projectName: "Home",
        clockInTime: "2026-05-10T16:00:00Z",
        clockOutTime: "2026-05-10T21:00:00Z",
      }),
      makeSession({
        id: "s2",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "dix",
        projectName: "DIX",
        clockInTime: "2026-05-10T22:00:00Z",
        clockOutTime: "2026-05-11T01:00:00Z",
      }),
    ];

    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { s1: true, s2: true },
      requireVideoByProfileId: { w1: false },
      startDate: "2026-05-10",
      endDate: "2026-05-10",
    });

    const gap = rows.find((row) => row.isBillableTransferGap);
    expect(gap?.durationMinutes).toBe(60);
    expect(gap?.projectName).toBe("Home → DIX");
  });

  it("includes only sessions overlapping the period window", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s1",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-01T08:00:00Z",
        clockOutTime: "2026-04-01T17:00:00Z",
      }),
      makeSession({
        id: "s2",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-05-15T08:00:00Z",
        clockOutTime: "2026-05-15T17:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { s1: true, s2: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("s1");
  });

  it("excludes already-paid hours at or before a payroll closure cutoff", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "paid",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-01T08:00:00Z",
        clockOutTime: "2026-04-01T16:00:00Z",
      }),
      makeSession({
        id: "partial",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T16:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { paid: true, partial: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      closedThroughByProfileId: { w1: "2026-04-02T12:00:00Z" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe("partial");
    expect(rows[0].durationMinutes).toBe(240);
  });

  it("attaches GPS / missingCheckout / missingVideo flags", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "s-noGps",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T11:00:00Z",
        checkoutStatus: "pending",
      }),
      makeSession({
        id: "s-open",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-03T08:00:00Z",
        clockOutTime: null,
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { "s-noGps": false, "s-open": true },
      requireVideoByProfileId: { w1: true },
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    const byId = new Map(rows.map((row) => [row.sessionId, row]));
    expect(byId.get("s-noGps")?.hasGps).toBe(false);
    expect(byId.get("s-noGps")?.missingVideo).toBe(true);
    expect(byId.get("s-open")?.missingCheckout).toBe(true);
    expect(byId.get("s-open")?.missingVideo).toBe(false);
  });

  it("flags Vasia's 144h shift as critical severity", () => {
    // 144h closed shift falling inside the period must surface as
    // critical so the payroll draft row renders red, matching Overview.
    const sessions: ManagerSession[] = [
      makeSession({
        id: "vasia",
        profileId: "vasia-id",
        profileName: "Vasia",
        projectId: "p1",
        clockInTime: "2026-04-01T08:00:00Z",
        clockOutTime: "2026-04-07T08:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { vasia: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].shiftSeverity).toBe("critical");
  });

  it("filters by profileId when provided", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "a",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T11:00:00Z",
      }),
      makeSession({
        id: "b",
        profileId: "w2",
        projectId: "p1",
        clockInTime: "2026-04-02T12:00:00Z",
        clockOutTime: "2026-04-02T15:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { a: true, b: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      profileId: "w2",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].profileId).toBe("w2");
  });

  it("marks rows whose clock_in matches a transfer gap inTime", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "transfer",
        profileId: "w1",
        projectId: "p2",
        clockInTime: "2026-04-02T13:00:00Z",
        clockOutTime: "2026-04-02T17:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { transfer: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      transferGaps: [
        { profileId: "w1", inTime: "2026-04-02T13:00:00Z" },
      ],
    });
    expect(rows[0].hasTransferGap).toBe(true);
  });
});

describe("groupPayrollRowsByWorker", () => {
  it("groups rows by worker and counts review flags", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "extreme",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "p1",
        clockInTime: "2026-04-01T08:00:00Z",
        clockOutTime: "2026-04-07T08:00:00Z", // 144h
      }),
      makeSession({
        id: "long",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "p1",
        clockInTime: "2026-04-10T08:00:00Z",
        clockOutTime: "2026-04-11T01:00:00Z", // 17h
      }),
      makeSession({
        id: "open",
        profileId: "w1",
        profileName: "Vasia",
        projectId: "p1",
        clockInTime: "2026-04-15T08:00:00Z",
        clockOutTime: null,
      }),
      makeSession({
        id: "other",
        profileId: "w2",
        profileName: "Aaron",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T16:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { extreme: true, long: false, open: true, other: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    const groups = groupPayrollRowsByWorker(rows);
    // Aaron sorts before Vasia (alphabetical).
    expect(groups.map((g) => g.profileName)).toEqual(["Aaron", "Vasia"]);
    const vasia = groups.find((g) => g.profileName === "Vasia")!;
    expect(vasia.rows.map((r) => r.sessionId)).toEqual([
      "open",
      "long",
      "extreme",
    ]); // newest-first default
    expect(vasia.extremeShiftCount).toBe(1);
    expect(vasia.longShiftCount).toBe(1);
    expect(vasia.missingCheckoutCount).toBe(1);
    expect(vasia.noGpsMinutes).toBe(17 * 60); // only the long shift was no-gps
  });

  it("supports oldest-first intra-worker ordering", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "a",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T11:00:00Z",
      }),
      makeSession({
        id: "b",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-03T08:00:00Z",
        clockOutTime: "2026-04-03T11:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { a: true, b: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    const groups = groupPayrollRowsByWorker(rows, { chronological: "oldest" });
    expect(groups[0].rows.map((r) => r.sessionId)).toEqual(["a", "b"]);
  });
});

describe("groupPayrollRowsByDay", () => {
  it("buckets rows by calendar day, newest day first, ascending within day", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "early",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T10:00:00Z",
      }),
      makeSession({
        id: "late",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T13:00:00Z",
        clockOutTime: "2026-04-02T17:00:00Z",
      }),
      makeSession({
        id: "next",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-03T08:00:00Z",
        clockOutTime: "2026-04-03T11:00:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { early: true, late: true, next: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    const days = groupPayrollRowsByDay(rows);
    expect(days.map((d) => d.dayKey)).toEqual(["2026-04-03", "2026-04-02"]);
    const apr2 = days.find((d) => d.dayKey === "2026-04-02")!;
    expect(apr2.rows.map((r) => r.sessionId)).toEqual(["early", "late"]);
    expect(apr2.totalMinutes).toBe(120 + 240);
  });
});

describe("isManagerRole / isOwnerRole role gates", () => {
  it("classifies the manager-tier roles", () => {
    for (const role of ["owner", "admin", "manager", "supervisor"] as const) {
      expect(isManagerRole(role)).toBe(true);
    }
    for (const role of ["worker", "driver", "subcontractor"] as const) {
      expect(isManagerRole(role)).toBe(false);
    }
  });
  it("scopes financial-view permission to owner + admin only", () => {
    // Manager / supervisor should NOT see financial fields per the
    // owner-vs-manager separation. Worker / driver / subcontractor
    // are obviously out.
    expect(isOwnerRole("owner")).toBe(true);
    expect(isOwnerRole("admin")).toBe(true);
    expect(isOwnerRole("manager")).toBe(false);
    expect(isOwnerRole("supervisor")).toBe(false);
    expect(isOwnerRole("worker")).toBe(false);
  });
});

describe("buildWorkerDisambiguationMap / formatWorkerDisplayLabel", () => {
  it("returns plain name when the roster has no name collisions", () => {
    const workers = [
      { id: "w1", name: "Aaron", role: "worker" as const },
      { id: "w2", name: "Bart", role: "worker" as const },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(formatWorkerDisplayLabel(workers[0], map.get("w1"))).toBe("Aaron");
    expect(map.get("w1")?.isAmbiguous).toBe(false);
  });

  it("appends role + email when two workers share a name and email is known", () => {
    // Two Olivers — manager must be able to tell them apart.
    const workers = [
      { id: "id-1", name: "Oliver", role: "worker" as const, email: "oliver.a@example.com" },
      { id: "id-2", name: "Oliver", role: "driver" as const, email: "oliver.b@example.com" },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(formatWorkerDisplayLabel(workers[0], map.get("id-1"))).toBe(
      "Oliver (worker · oliver.a@example.com)",
    );
    expect(formatWorkerDisplayLabel(workers[1], map.get("id-2"))).toBe(
      "Oliver (driver · oliver.b@example.com)",
    );
  });

  it("falls back to phone when email is missing", () => {
    const workers = [
      { id: "id-1", name: "Oliver", role: "worker" as const, phone: "+1-555-0001" },
      { id: "id-2", name: "Oliver", role: "worker" as const, phone: "+1-555-0002" },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(formatWorkerDisplayLabel(workers[0], map.get("id-1"))).toBe(
      "Oliver (worker · +1-555-0001)",
    );
  });

  it("falls back to a 6-char id when neither email nor phone exists", () => {
    const workers = [
      { id: "abcdef1234", name: "Oliver", role: "worker" as const },
      { id: "fedcba9876", name: "Oliver", role: "worker" as const },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(formatWorkerDisplayLabel(workers[0], map.get("abcdef1234"))).toBe(
      "Oliver (worker · abcdef)",
    );
    expect(formatWorkerDisplayLabel(workers[1], map.get("fedcba9876"))).toBe(
      "Oliver (worker · fedcba)",
    );
  });

  it("ignores casing and surrounding whitespace when checking for collisions", () => {
    const workers = [
      { id: "id-1", name: "Oliver", role: "worker" as const },
      { id: "id-2", name: "  oliver ", role: "worker" as const },
      { id: "id-3", name: "Patrick", role: "worker" as const },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(map.get("id-1")?.isAmbiguous).toBe(true);
    expect(map.get("id-2")?.isAmbiguous).toBe(true);
    expect(map.get("id-3")?.isAmbiguous).toBe(false);
  });

  it("does not flag ambiguity when only one entry exists with a given name", () => {
    const workers = [
      { id: "id-1", name: "Oliver", role: "worker" as const },
    ];
    const map = buildWorkerDisambiguationMap(workers);
    expect(map.get("id-1")?.isAmbiguous).toBe(false);
    expect(formatWorkerDisplayLabel(workers[0], map.get("id-1"))).toBe("Oliver");
  });
});

describe("sumDraftRowMinutes", () => {
  it("returns hours rounded to two decimals", () => {
    const sessions: ManagerSession[] = [
      makeSession({
        id: "a",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-02T08:00:00Z",
        clockOutTime: "2026-04-02T10:30:00Z",
      }),
      makeSession({
        id: "b",
        profileId: "w1",
        projectId: "p1",
        clockInTime: "2026-04-03T08:00:00Z",
        clockOutTime: "2026-04-03T11:15:00Z",
      }),
    ];
    const rows = buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId: { a: true, b: true },
      requireVideoByProfileId: {},
      startDate: "2026-04-01",
      endDate: "2026-04-30",
    });
    const summary = sumDraftRowMinutes(rows);
    expect(summary.totalMinutes).toBe(150 + 195);
    expect(summary.totalHours).toBeCloseTo(5.75, 2);
  });

  it("returns zero on an empty list", () => {
    const summary = sumDraftRowMinutes([]);
    expect(summary.totalMinutes).toBe(0);
    expect(summary.totalHours).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Project workload — overlap-based weekly aggregation
// ─────────────────────────────────────────────────────────────────────

describe("sessionMinutesInWindow", () => {
  it("counts a fully-contained shift in full", () => {
    const minutes = sessionMinutesInWindow({
      clockInTime: "2026-05-04T08:00:00Z",
      clockOutTime: "2026-05-04T17:00:00Z",
      windowStart: new Date("2026-05-04T00:00:00Z"),
      windowEnd: new Date("2026-05-11T00:00:00Z"),
    });
    expect(minutes).toBe(9 * 60);
  });

  it("returns 0 for a shift that does not overlap the window", () => {
    const minutes = sessionMinutesInWindow({
      clockInTime: "2026-04-01T08:00:00Z",
      clockOutTime: "2026-04-01T17:00:00Z",
      windowStart: new Date("2026-05-04T00:00:00Z"),
      windowEnd: new Date("2026-05-11T00:00:00Z"),
    });
    expect(minutes).toBe(0);
  });

  it("clamps to the window end for a shift that ends after the window closes", () => {
    const minutes = sessionMinutesInWindow({
      clockInTime: "2026-05-09T22:00:00Z",
      clockOutTime: "2026-05-11T02:00:00Z",
      windowStart: new Date("2026-05-04T00:00:00Z"),
      windowEnd: new Date("2026-05-11T00:00:00Z"),
    });
    // 22:00 May 9 → 00:00 May 11 = 26 hours
    expect(minutes).toBe(26 * 60);
  });

  it("clamps to the window start for a shift that started before the window", () => {
    const minutes = sessionMinutesInWindow({
      clockInTime: "2026-04-30T15:16:00Z",
      clockOutTime: "2026-05-04T08:00:00Z",
      windowStart: new Date("2026-05-04T00:00:00Z"),
      windowEnd: new Date("2026-05-11T00:00:00Z"),
    });
    // 00:00 May 4 → 08:00 May 4 = 8 hours
    expect(minutes).toBe(8 * 60);
  });

  it("uses now() for open shifts when clockOutTime is null", () => {
    const minutes = sessionMinutesInWindow({
      clockInTime: "2026-05-04T08:00:00Z",
      clockOutTime: null,
      windowStart: new Date("2026-05-04T00:00:00Z"),
      windowEnd: new Date("2026-05-11T00:00:00Z"),
      now: new Date("2026-05-04T14:00:00Z"),
    });
    expect(minutes).toBe(6 * 60);
  });

  it("splits Vasia's 144h shift between previous and current weeks", () => {
    // Spec example: Apr 30 15:16 → May 6 15:22, current week = May 4 → May 11.
    const previousWeekStart = new Date("2026-04-27T00:00:00Z");
    const currentWeekStart = new Date("2026-05-04T00:00:00Z");
    const currentWeekEnd = new Date("2026-05-11T00:00:00Z");

    const previous = sessionMinutesInWindow({
      clockInTime: "2026-04-30T15:16:00Z",
      clockOutTime: "2026-05-06T15:22:00Z",
      windowStart: previousWeekStart,
      windowEnd: currentWeekStart,
    });
    const current = sessionMinutesInWindow({
      clockInTime: "2026-04-30T15:16:00Z",
      clockOutTime: "2026-05-06T15:22:00Z",
      windowStart: currentWeekStart,
      windowEnd: currentWeekEnd,
    });

    // Apr 30 15:16 → May 4 00:00 = 80 hours 44 minutes = 4844 min
    expect(previous).toBe(80 * 60 + 44);
    // May 4 00:00 → May 6 15:22 = 63 hours 22 minutes = 3802 min
    expect(current).toBe(63 * 60 + 22);
    // total roughly 144h (rounding within 1 min)
    expect(previous + current).toBe(144 * 60 + 6);
  });
});

describe("buildProjectSummaries — weekMinutes overlap and abnormal-shift flags", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin to Wednesday May 6 2026 14:00 — current week is Mon May 4 → Sun May 10.
    vi.setSystemTime(new Date("2026-05-06T14:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a fully in-week shift's full duration toward weekMinutes", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Anna" })],
      projects: [makeProject({ id: "p1", name: "Park" })],
      timeEvents: [
        makeEvent({ id: "in", profile_id: "w1", project_id: "p1", event_type: "clock_in", event_time: "2026-05-04T08:00:00Z" }),
        makeEvent({ id: "out", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-05-04T16:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const summaries = buildProjectSummaries(data, sessions);
    const park = summaries.find((p) => p.id === "p1")!;
    expect(park.weekMinutes).toBe(8 * 60);
    expect(park.extremeShiftCount).toBe(0);
    expect(park.longShiftCount).toBe(0);
  });

  it("splits a cross-week shift so only the current-week tail counts toward weekMinutes", () => {
    // Vasia regression: shift starts last Thursday, ends Wednesday this
    // week. Original code dropped the entire shift because clockInTime
    // < weekStart. Overlap-based aggregation must keep the in-week tail.
    //
    // Timezone-invariant assertion: re-derive `weekStart` the same way
    // the implementation does (local midnight Monday) and compare the
    // helper's overlap math against the expected delta. This prevents
    // a flaky run when CI is on UTC vs. PDT vs. local-dev.
    const clockInIso = "2026-04-30T15:16:00Z";
    const clockOutIso = "2026-05-06T15:22:00Z";
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "vasia", name: "Vasia" })],
      projects: [makeProject({ id: "dom", name: "Дом" })],
      timeEvents: [
        makeEvent({ id: "in",  profile_id: "vasia", project_id: "dom", event_type: "clock_in",  event_time: clockInIso }),
        makeEvent({ id: "out", profile_id: "vasia", project_id: "dom", event_type: "clock_out", event_time: clockOutIso }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const summaries = buildProjectSummaries(data, sessions);
    const dom = summaries.find((p) => p.id === "dom")!;

    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() + mondayOffset);

    const totalMinutes = Math.round(
      (new Date(clockOutIso).getTime() - new Date(clockInIso).getTime()) /
        60_000,
    );
    const expectedOverlap = Math.round(
      (new Date(clockOutIso).getTime() - weekStart.getTime()) / 60_000,
    );

    // overlap is positive (clockIn before weekStart, clockOut after) and
    // strictly less than the total — i.e. the shift was split, not
    // double-counted.
    expect(expectedOverlap).toBeGreaterThan(0);
    expect(expectedOverlap).toBeLessThan(totalMinutes);
    expect(dom.weekMinutes).toBe(expectedOverlap);

    // 144h total > 24h → critical / extreme.
    expect(dom.extremeShiftCount).toBe(1);
    expect(dom.longShiftCount).toBe(0);
    expect(dom.longestShift?.workerName).toBe("Vasia");
    expect(dom.longestShift?.durationMinutes).toBe(totalMinutes);
  });

  it("flags an 18h shift as long but not extreme", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Bart" })],
      projects: [makeProject({ id: "p1", name: "Park" })],
      timeEvents: [
        makeEvent({ id: "in",  profile_id: "w1", project_id: "p1", event_type: "clock_in",  event_time: "2026-05-04T06:00:00Z" }),
        makeEvent({ id: "out", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-05-05T00:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const summaries = buildProjectSummaries(data, sessions);
    const park = summaries.find((p) => p.id === "p1")!;
    expect(park.longShiftCount).toBe(1);
    expect(park.extremeShiftCount).toBe(0);
    expect(park.longestShift?.durationMinutes).toBe(18 * 60);
  });

  it("does NOT flag a shift just under the warn threshold", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Aaron" })],
      projects: [makeProject({ id: "p1", name: "Park" })],
      timeEvents: [
        makeEvent({ id: "in",  profile_id: "w1", project_id: "p1", event_type: "clock_in",  event_time: "2026-05-04T08:00:00Z" }),
        // 15h 59m — below the 16h warn threshold.
        makeEvent({ id: "out", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-05-04T23:59:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const summaries = buildProjectSummaries(data, sessions);
    const park = summaries.find((p) => p.id === "p1")!;
    expect(park.longShiftCount).toBe(0);
    expect(park.extremeShiftCount).toBe(0);
    // longestShift is still recorded (used for the per-project chip / detail).
    expect(park.longestShift?.durationMinutes).toBe(15 * 60 + 59);
  });

  it("scopes weekMinutes per project (one shift on each project)", () => {
    const data = makeWorkspace({
      profiles: [makeProfile({ id: "w1", name: "Anna" })],
      projects: [
        makeProject({ id: "p1", name: "Alpha" }),
        makeProject({ id: "p2", name: "Beta" }),
      ],
      timeEvents: [
        makeEvent({ id: "a-in",  profile_id: "w1", project_id: "p1", event_type: "clock_in",  event_time: "2026-05-04T08:00:00Z" }),
        makeEvent({ id: "a-out", profile_id: "w1", project_id: "p1", event_type: "clock_out", event_time: "2026-05-04T11:00:00Z" }),
        makeEvent({ id: "b-in",  profile_id: "w1", project_id: "p2", event_type: "clock_in",  event_time: "2026-05-05T08:00:00Z" }),
        makeEvent({ id: "b-out", profile_id: "w1", project_id: "p2", event_type: "clock_out", event_time: "2026-05-05T13:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const summaries = buildProjectSummaries(data, sessions);
    const byId = new Map(summaries.map((s) => [s.id, s]));
    expect(byId.get("p1")?.weekMinutes).toBe(3 * 60);
    expect(byId.get("p2")?.weekMinutes).toBe(5 * 60);
  });
});
