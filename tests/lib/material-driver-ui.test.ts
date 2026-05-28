import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);

describe("material driver UI", () => {
  it("passes eligible field users to the material assignment modal", () => {
    expect(projectDetailSource).toContain("filterMaterialTakerProfiles");
    expect(projectDetailSource).toContain("configuredDriverProfileIds");
    expect(projectDetailSource).toContain("assigneeProfiles={materialTakerProfiles}");
  });

  it("defaults material creation to the shared open queue without full team fallback", () => {
    expect(projectDetailSource).toContain('t("materials.openQueueOption")');
    expect(projectDetailSource).toContain('t("materials.noMaterialTakersAvailable")');
    expect(projectDetailSource).toContain("const driverUserId = orderAssignedTo || null");
    expect(projectDetailSource).not.toContain('assigneeProfiles={[...taskAssigneeProjectProfiles, ...taskAssigneeOtherProfiles]}');
    expect(projectDetailSource).not.toContain('setOrderError(t("materials.driverRequired"))');
  });
});
