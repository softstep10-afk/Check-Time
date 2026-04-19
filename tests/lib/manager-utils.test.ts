import { describe, it, expect } from "vitest";
import {
  computeOvertime,
  computePayrollPreview,
  buildManagerSessions,
} from "@/lib/manager-utils";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Organization,
  PayrollClosure,
  Profile,
  Project,
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

function makeWorkspace(opts: {
  profiles?: Profile[];
  projects?: Project[];
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
    assignments: [],
    tasks: [],
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
        makeEvent({ id: "b1", profile_id: "w1", project_id: "p2", event_type: "clock_in", event_time: "2026-04-01T13:00:00Z" }),
        makeEvent({ id: "b2", profile_id: "w1", project_id: "p2", event_type: "clock_out", event_time: "2026-04-01T17:00:00Z" }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const preview = computePayrollPreview(data, sessions, "2026-04-30");
    expect(preview.lines).toHaveLength(2);
    expect(preview.workersCount).toBe(1);
    expect(preview.totalHours).toBeCloseTo(8, 2);
    expect(preview.totalAmount).toBe(240);
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
