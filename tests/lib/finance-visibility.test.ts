import { describe, expect, it } from "vitest";
import {
  buildManagerSessions,
  buildProjectSummaries,
  getOverviewStats,
} from "@/lib/manager-utils";
import { buildAssistantSnapshot } from "@/lib/ai/service";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Media,
  Organization,
  Profile,
  Project,
  TimeEvent,
} from "@/types/database";

function profile(overrides: Partial<Profile> & Pick<Profile, "id" | "name">): Profile {
  return {
    org_id: "org",
    role: "worker",
    pin_hash: null,
    color: "#ffffff",
    is_active: true,
    require_video: false,
    hourly_rate: 40,
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
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function event(
  overrides: Partial<TimeEvent> &
    Pick<TimeEvent, "id" | "profile_id" | "project_id" | "event_type" | "event_time">,
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

describe("finance visibility gates", () => {
  it("removes receipt totals from project and overview summaries when financials are hidden", () => {
    const data = workspace({
      projects: [project({ id: "p1", name: "Build" })],
      media: [
        media({
          id: "r1",
          project_id: "p1",
          metadata: { category: "receipt", amount: 125.5 },
        }),
      ],
    });

    const visible = buildProjectSummaries(data, [], { includeFinancials: true });
    const hidden = buildProjectSummaries(data, [], { includeFinancials: false });
    const hiddenStats = getOverviewStats(data, [], hidden, []);

    expect(visible[0].receiptTotal).toBe(125.5);
    expect(hidden[0].receiptTotal).toBe(0);
    expect(hiddenStats.receiptTotal).toBe(0);
  });

  it("removes payroll preview amounts from overview and assistant snapshots when financials are hidden", () => {
    const data = workspace({
      profiles: [profile({ id: "worker", name: "Worker", hourly_rate: 40 })],
      projects: [project({ id: "p1", name: "Build" })],
      timeEvents: [
        event({
          id: "in",
          profile_id: "worker",
          project_id: "p1",
          event_type: "clock_in",
          event_time: "2026-04-01T08:00:00Z",
        }),
        event({
          id: "out",
          profile_id: "worker",
          project_id: "p1",
          event_type: "clock_out",
          event_time: "2026-04-01T12:00:00Z",
        }),
      ],
    });
    const sessions = buildManagerSessions(data);
    const projects = buildProjectSummaries(data, sessions, { includeFinancials: false });
    const stats = getOverviewStats(data, sessions, projects, [], {
      includeFinancials: false,
    });
    const snapshot = buildAssistantSnapshot(data, [], { includeFinancials: false });

    expect(stats.unpaidHours).toBe(0);
    expect(stats.unpaidAmount).toBe(0);
    expect(snapshot.hasFinanceAccess).toBe(false);
    expect(snapshot.unpaidHours).toBe(0);
    expect(snapshot.unpaidAmount).toBe(0);
  });
});
