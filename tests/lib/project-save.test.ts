import { describe, expect, it } from "vitest";
import {
  clampProjectGpsRadius,
  getMissingOptionalProjectColumn,
  hasValidProjectSiteCoordinates,
  insertProjectTolerant,
  PROJECT_GPS_RADIUS_DEFAULT,
  PROJECT_GPS_RADIUS_MAX,
  PROJECT_GPS_RADIUS_MIN,
  validateProjectSaveBody,
} from "@/lib/project-save";

describe("clampProjectGpsRadius", () => {
  it("keeps values inside the supported range", () => {
    expect(clampProjectGpsRadius(75)).toBe(75);
    expect(clampProjectGpsRadius("25")).toBe(PROJECT_GPS_RADIUS_MIN);
    expect(clampProjectGpsRadius("300")).toBe(PROJECT_GPS_RADIUS_MAX);
  });

  it("clamps out-of-range values and falls back on invalid input", () => {
    expect(clampProjectGpsRadius(5)).toBe(PROJECT_GPS_RADIUS_MIN);
    expect(clampProjectGpsRadius(999)).toBe(PROJECT_GPS_RADIUS_MAX);
    expect(clampProjectGpsRadius("bad")).toBe(PROJECT_GPS_RADIUS_DEFAULT);
  });
});

describe("hasValidProjectSiteCoordinates", () => {
  it("accepts valid project site points and rejects invalid ones", () => {
    expect(
      hasValidProjectSiteCoordinates({ site_point: "SRID=4326;POINT(-122.4194 37.7749)" }),
    ).toBe(true);
    expect(
      hasValidProjectSiteCoordinates({ site_point: "SRID=4326;POINT(-222 37.7749)" }),
    ).toBe(false);
  });
});

describe("validateProjectSaveBody", () => {
  it("requires a project name", () => {
    expect(
      validateProjectSaveBody(
        {
          lat: 37.7749,
          lng: -122.4194,
          coordinatesConfirmed: true,
        },
        { allowBlankCoordinates: false },
      ),
    ).toEqual({
      ok: false,
      error: "Project name is required.",
      status: 400,
    });
  });

  it("rejects invalid coordinate pairs", () => {
    expect(
      validateProjectSaveBody(
        {
          name: "Test",
          lat: 95,
          lng: -181,
          coordinatesConfirmed: true,
        },
        { allowBlankCoordinates: false },
      ),
    ).toEqual({
      ok: false,
      error: "Latitude must be between -90 and 90 and longitude must be between -180 and 180.",
      status: 400,
    });
  });

  it("requires explicit coordinate confirmation", () => {
    expect(
      validateProjectSaveBody(
        {
          name: "Test",
          lat: 37.7749,
          lng: -122.4194,
          coordinatesConfirmed: false,
        },
        { allowBlankCoordinates: false },
      ),
    ).toEqual({
      ok: false,
      error: "Confirm these coordinates are correct for this job site before saving.",
      status: 400,
    });
  });

  it("builds a create payload with validated coordinates", () => {
    expect(
      validateProjectSaveBody(
        {
          name: "Warehouse",
          address: "123 Main",
          notes: "Fence ready",
          rate: "42.50",
          radius_m: "180",
          gps_radius_m: "120",
          lat: "37.7749",
          lng: "-122.4194",
          coordinatesConfirmed: true,
          start_date: "2026-04-26",
          end_date: "",
        },
        { allowBlankCoordinates: false },
      ),
    ).toEqual({
      ok: true,
      payload: {
        name: "Warehouse",
        address: "123 Main",
        notes: "Fence ready",
        rate: 42.5,
        radius_m: 180,
        gps_radius_m: 120,
        status: "active",
        start_date: "2026-04-26",
        end_date: null,
        timeline_status: "on_track",
        budget_status: "on_budget",
        settings: {
          client_tone: "green",
        },
        site_point: "SRID=4326;POINT(-122.4194 37.7749)",
      },
    });
  });

  it("preserves existing optional fields when an edit form omits them", () => {
    expect(
      validateProjectSaveBody(
        {
          name: "Warehouse",
          address: "",
          notes: "",
          rate: "42.50",
          radius_m: "180",
          status: "paused",
          lat: null,
          lng: null,
          coordinatesConfirmed: true,
        },
        {
          allowBlankCoordinates: true,
          fallbackGpsRadius: 90,
          fallbackStartDate: "2026-04-01",
          fallbackEndDate: "2026-04-30",
        },
      ),
    ).toEqual({
      ok: true,
      payload: {
        name: "Warehouse",
        address: null,
        notes: null,
        rate: 42.5,
        radius_m: 180,
        gps_radius_m: 90,
        status: "paused",
        start_date: "2026-04-01",
        end_date: "2026-04-30",
        timeline_status: "on_track",
        budget_status: "on_budget",
        settings: {
          client_tone: "green",
        },
      },
    });
  });
});

describe("getMissingOptionalProjectColumn", () => {
  it("recognizes optional project columns missing from older schemas", () => {
    expect(
      getMissingOptionalProjectColumn({
        code: "PGRST204",
        message: "Could not find the 'budget_status' column of 'projects' in the schema cache",
      }),
    ).toBe("budget_status");
    expect(
      getMissingOptionalProjectColumn({
        code: "PGRST204",
        message: "Could not find the 'timeline_status' column of 'projects' in the schema cache",
      }),
    ).toBe("timeline_status");
    expect(
      getMissingOptionalProjectColumn({
        message: "column projects.gps_radius_m does not exist",
      }),
    ).toBe("gps_radius_m");
  });

  it("does not mask missing required columns or unrelated errors", () => {
    expect(
      getMissingOptionalProjectColumn({
        code: "PGRST204",
        message: "Could not find the 'name' column of 'projects' in the schema cache",
      }),
    ).toBeNull();
    expect(
      getMissingOptionalProjectColumn({
        message: "duplicate key value violates unique constraint",
      }),
    ).toBeNull();
  });
});

describe("insertProjectTolerant", () => {
  function makeInsertClient(
    results: Array<{ data: { id: string } | null; error: { code?: string; message?: string } | null }>,
    inserts: Record<string, unknown>[],
  ) {
    return {
      from(table: string) {
        expect(table).toBe("projects");
        return {
          insert(payload: Record<string, unknown>) {
            inserts.push(payload);
            return {
              select() {
                return {
                  async single() {
                    return results.shift() ?? { data: null, error: { message: "No mock result" } };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it("retries inserts without optional columns that are missing from the schema cache", async () => {
    const inserts: Record<string, unknown>[] = [];
    const client = makeInsertClient(
      [
        {
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'budget_status' column of 'projects' in the schema cache",
          },
        },
        {
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'timeline_status' column of 'projects' in the schema cache",
          },
        },
        { data: { id: "project-1" }, error: null },
      ],
      inserts,
    );

    const result = await insertProjectTolerant(client as never, {
      org_id: "org-1",
      name: "Jarvis project",
      budget_status: "on_budget",
      timeline_status: "on_track",
      gps_radius_m: 75,
    });

    expect(result).toEqual({ data: { id: "project-1" }, error: null });
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toHaveProperty("budget_status");
    expect(inserts[1]).not.toHaveProperty("budget_status");
    expect(inserts[1]).toHaveProperty("timeline_status");
    expect(inserts[2]).not.toHaveProperty("budget_status");
    expect(inserts[2]).not.toHaveProperty("timeline_status");
    expect(inserts[2]).toHaveProperty("gps_radius_m", 75);
  });

  it("returns real insert errors without retrying unrelated missing columns", async () => {
    const inserts: Record<string, unknown>[] = [];
    const client = makeInsertClient(
      [
        {
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'name' column of 'projects' in the schema cache",
          },
        },
      ],
      inserts,
    );

    const result = await insertProjectTolerant(client as never, {
      org_id: "org-1",
      name: "Jarvis project",
      budget_status: "on_budget",
    });

    expect(result.error?.message).toContain("'name'");
    expect(inserts).toHaveLength(1);
  });
});
