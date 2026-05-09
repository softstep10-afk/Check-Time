import { describe, expect, it } from "vitest";
import {
  assessDeviceLocationAccuracy,
  buildWorkerSessions,
  deriveClockState,
  isValidGeoPoint,
  parseCoordinateInputPair,
  parseGeoPoint,
} from "@/lib/worker-utils";
import type { WorkerMediaItem, WorkerProject } from "@/lib/worker-types";
import type { TimeEvent } from "@/types/database";

describe("isValidGeoPoint", () => {
  it("accepts coordinates inside the legal latitude and longitude ranges", () => {
    expect(isValidGeoPoint({ lat: 37.7749, lng: -122.4194 })).toBe(true);
  });

  it("rejects coordinates outside the legal latitude and longitude ranges", () => {
    expect(isValidGeoPoint({ lat: 91, lng: -122.4194 })).toBe(false);
    expect(isValidGeoPoint({ lat: 37.7749, lng: -181 })).toBe(false);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidGeoPoint({ lat: Number.NaN, lng: -122.4194 })).toBe(false);
    expect(isValidGeoPoint({ lat: 37.7749, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("parseGeoPoint", () => {
  it("parses valid WKT points", () => {
    expect(parseGeoPoint("SRID=4326;POINT(-122.4194 37.7749)")).toEqual({
      lat: 37.7749,
      lng: -122.4194,
    });
  });

  it("rejects WKT points with out-of-range coordinates", () => {
    expect(parseGeoPoint("SRID=4326;POINT(-122.4194 123.456)")).toBeNull();
  });

  it("rejects object points with out-of-range coordinates", () => {
    expect(
      parseGeoPoint({
        latitude: 37.7749,
        longitude: -200,
      }),
    ).toBeNull();
  });
});

describe("parseCoordinateInputPair", () => {
  it("accepts boundary latitude and longitude values", () => {
    expect(parseCoordinateInputPair("-90", "180", { allowBlank: false })).toEqual({
      point: { lat: -90, lng: 180 },
      error: null,
    });
  });

  it("requires both coordinates in create flows", () => {
    expect(parseCoordinateInputPair("", "", { allowBlank: false })).toEqual({
      point: null,
      error: "missing",
    });
    expect(parseCoordinateInputPair("37.7749", "", { allowBlank: false })).toEqual({
      point: null,
      error: "missing",
    });
  });

  it("rejects out-of-range values before save", () => {
    expect(parseCoordinateInputPair("95", "-181", { allowBlank: false })).toEqual({
      point: null,
      error: "invalid",
    });
    expect(parseCoordinateInputPair("90.000001", "180.000001", { allowBlank: false })).toEqual({
      point: null,
      error: "invalid",
    });
  });

  it("allows blank coordinates on legacy edit paths when nothing was entered", () => {
    expect(parseCoordinateInputPair("", "", { allowBlank: true })).toEqual({
      point: null,
      error: null,
    });
  });

  it("returns a valid point when both values are in range", () => {
    expect(parseCoordinateInputPair("37.7749", "-122.4194", { allowBlank: false })).toEqual({
      point: { lat: 37.7749, lng: -122.4194 },
      error: null,
    });
  });
});

describe("assessDeviceLocationAccuracy", () => {
  it("keeps finite browser accuracy values in meters", () => {
    expect(assessDeviceLocationAccuracy(18.4)).toEqual({
      accuracyMeters: 18,
      shouldWarn: false,
    });
  });

  it("warns when browser accuracy is poor", () => {
    expect(assessDeviceLocationAccuracy(125.7)).toEqual({
      accuracyMeters: 126,
      shouldWarn: true,
    });
  });

  it("warns when browser accuracy is unavailable", () => {
    expect(assessDeviceLocationAccuracy(undefined)).toEqual({
      accuracyMeters: null,
      shouldWarn: true,
    });
  });
});

describe("buildWorkerSessions checkout video proof", () => {
  const orgId = "org-1";
  const profileId = "worker-1";
  const projectId = "project-1";
  const otherProjectId = "project-2";

  function project(id = projectId): WorkerProject {
    return {
      id,
      org_id: orgId,
      name: id === projectId ? "Home" : "Other",
      address: null,
      notes: null,
      status: "active",
      rate: 0,
      site_point: null,
      radius_m: 150,
      start_date: null,
      end_date: null,
      settings: {},
      timeline_status: null,
      budget_status: null,
      deleted_at: null,
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
      assignedAt: null,
      site: null,
    };
  }

  function event(overrides: Partial<TimeEvent>): TimeEvent {
    return {
      id: overrides.id ?? "event-1",
      org_id: orgId,
      profile_id: profileId,
      project_id: overrides.project_id ?? projectId,
      event_type: overrides.event_type ?? "clock_in",
      event_time: overrides.event_time ?? "2026-05-01T08:00:00.000Z",
      server_time: overrides.server_time ?? overrides.event_time ?? "2026-05-01T08:00:00.000Z",
      gps_point: null,
      gps_accuracy_m: null,
      gps_source: null,
      adjusts_event_id: null,
      adjust_reason: null,
      adjusted_by: null,
      video_status: overrides.video_status ?? "not_required",
      video_storage_path: null,
      notes: null,
      metadata: {},
      created_at: overrides.created_at ?? overrides.event_time ?? "2026-05-01T08:00:00.000Z",
      ...overrides,
    };
  }

  function checkoutMedia(overrides: Partial<WorkerMediaItem>): WorkerMediaItem {
    return {
      id: overrides.id ?? "media-1",
      org_id: orgId,
      project_id: overrides.project_id ?? projectId,
      uploaded_by: profileId,
      media_type: "video",
      storage_path: "org/project/video.mp4",
      filename: "video.mp4",
      file_size: 123,
      mime_type: "video/mp4",
      caption: null,
      is_checkout: true,
      time_event_id: overrides.time_event_id ?? null,
      ai_analysis: null,
      metadata: {},
      deleted_at: null,
      created_at: overrides.created_at ?? "2026-05-07T10:00:00.000Z",
      projectName: "Home",
      ...overrides,
    };
  }

  it("clears pending checkout when media is already linked to the clock_out event", () => {
    const sessions = buildWorkerSessions(
      [
        event({ id: "in", event_type: "clock_in", event_time: "2026-05-07T08:00:00.000Z" }),
        event({
          id: "out",
          event_type: "clock_out",
          event_time: "2026-05-07T17:00:00.000Z",
          video_status: "pending",
        }),
      ],
      [project()],
      [checkoutMedia({ time_event_id: "out" })],
    );

    expect(sessions[0].checkoutStatus).toBe("uploaded");
    expect(deriveClockState(sessions).pendingCheckoutEventId).toBeNull();
  });

  it("treats orphan checkout media inside a long shift window as proof", () => {
    const sessions = buildWorkerSessions(
      [
        event({ id: "in", event_type: "clock_in", event_time: "2026-05-01T08:00:00.000Z" }),
        event({
          id: "out",
          event_type: "clock_out",
          event_time: "2026-05-07T08:00:00.000Z",
          video_status: "pending",
        }),
      ],
      [project()],
      [checkoutMedia({ id: "orphan", time_event_id: null, created_at: "2026-05-07T08:05:00.000Z" })],
    );

    expect(sessions[0].durationMinutes).toBe(144 * 60);
    expect(sessions[0].checkoutStatus).toBe("uploaded");
    expect(deriveClockState(sessions).pendingCheckoutEventId).toBeNull();
  });

  it("keeps the pending warning when orphan checkout media belongs to another project", () => {
    const sessions = buildWorkerSessions(
      [
        event({ id: "in", event_type: "clock_in", event_time: "2026-05-07T08:00:00.000Z" }),
        event({
          id: "out",
          event_type: "clock_out",
          event_time: "2026-05-07T17:00:00.000Z",
          video_status: "pending",
        }),
      ],
      [project(), project(otherProjectId)],
      [checkoutMedia({ id: "wrong-project", project_id: otherProjectId, time_event_id: null })],
    );

    expect(sessions[0].checkoutStatus).toBe("pending");
    expect(deriveClockState(sessions).pendingCheckoutEventId).toBe("out");
  });
});
