import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);

describe("material driver UI", () => {
  it("passes only driver profiles to the material assignment modal", () => {
    expect(projectDetailSource).toContain("filterMaterialDriverProfiles");
    expect(projectDetailSource).toContain("configuredDriverProfileIds");
    expect(projectDetailSource).toContain("assigneeProfiles={materialDriverProfiles}");
  });

  it("does not fall back to the full team when no drivers exist", () => {
    expect(projectDetailSource).toContain('t("materials.chooseDriver")');
    expect(projectDetailSource).toContain('t("materials.noDriversAvailable")');
    expect(projectDetailSource).not.toContain('assigneeProfiles={[...taskAssigneeProjectProfiles, ...taskAssigneeOtherProfiles]}');
  });
});
