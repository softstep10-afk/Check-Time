import { describe, expect, it } from "vitest";
import {
  DRIVER_TIME_PROJECT_KIND,
  isDriverTimeProject,
  isGpsWarningSuppressedForProject,
  mergeDriverTimeProjectSettings,
  readDriverTimeProjectFlag,
} from "@/lib/driver-time-projects";

describe("driver time projects", () => {
  it("detects driver time projects from existing settings", () => {
    expect(isDriverTimeProject({ settings: { projectKind: DRIVER_TIME_PROJECT_KIND } })).toBe(true);
    expect(isDriverTimeProject({ settings: { gpsNotRequired: true } })).toBe(true);
    expect(isDriverTimeProject({ settings: { client_tone: "green" } })).toBe(false);
  });

  it("uses the same helper to suppress GPS warning surfaces", () => {
    expect(isGpsWarningSuppressedForProject({ settings: { projectKind: DRIVER_TIME_PROJECT_KIND } })).toBe(true);
    expect(isGpsWarningSuppressedForProject({ settings: {} })).toBe(false);
  });

  it("merges driver-time settings without dropping unrelated settings", () => {
    expect(mergeDriverTimeProjectSettings({ client_tone: "red" }, true)).toEqual({
      client_tone: "red",
      projectKind: DRIVER_TIME_PROJECT_KIND,
      gpsNotRequired: true,
    });
  });

  it("removes only driver-time markers when disabled", () => {
    expect(
      mergeDriverTimeProjectSettings(
        {
          client_tone: "yellow",
          projectKind: DRIVER_TIME_PROJECT_KIND,
          gpsNotRequired: true,
        },
        false,
      ),
    ).toEqual({ client_tone: "yellow" });
  });

  it("accepts checkbox-style and explicit project kind inputs", () => {
    expect(readDriverTimeProjectFlag("on")).toBe(true);
    expect(readDriverTimeProjectFlag(DRIVER_TIME_PROJECT_KIND)).toBe(true);
    expect(readDriverTimeProjectFlag("false")).toBe(false);
  });
});
