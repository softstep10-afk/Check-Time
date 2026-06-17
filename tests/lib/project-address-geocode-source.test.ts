import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectsPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectsPage.tsx"),
  "utf8",
);

describe("project address GPS binding", () => {
  it("requires a current forward geocode before saving an addressed non-driver project", () => {
    expect(projectsPageSource).toContain("ADDRESS_GEOCODE_DEBOUNCE_MS");
    expect(projectsPageSource).toContain("addressLookupMatchesCurrentAddress");
    expect(projectsPageSource).toContain("requireCurrentAddressLookup");
    expect(projectsPageSource).toContain("projects.addressLookupRequiredBeforeSave");
    expect(projectsPageSource).toContain("driverTimeProject || !address.trim()");
  });

  it("keeps explicit coordinate overrides gated by distance warning and confirmation", () => {
    expect(projectsPageSource).toContain("ADDRESS_COORDINATE_MISMATCH_THRESHOLD_METERS");
    expect(projectsPageSource).toContain("haversineMeters");
    expect(projectsPageSource).toContain("projects.addressCoordinateOverrideWarning");
    expect(projectsPageSource).toContain("projects.addressCoordinateOverrideConfirmRequired");
    expect(projectsPageSource).toContain("handleCreateCoordinateOverride({ keepDeviceLocation: true })");
    expect(projectsPageSource).toContain("handleEditCoordinateOverride({ keepDeviceLocation: true })");
  });
});
