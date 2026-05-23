import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const detailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);

const updateRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/projects/[id]/route.ts"),
  "utf8",
);

describe("project detail deadline editing", () => {
  it("exposes the existing start and deadline fields in the project detail edit form", () => {
    expect(detailSource).toContain('name="start_date"');
    expect(detailSource).toContain('label={t("projects.startDate")}');
    expect(detailSource).toContain("defaultValue={project.start_date ?? \"\"}");
    expect(detailSource).toContain('name="end_date"');
    expect(detailSource).toContain('label={t("projects.endDate")}');
    expect(detailSource).toContain("defaultValue={project.end_date ?? \"\"}");
  });

  it("sends changed project dates through the existing update payload", () => {
    expect(detailSource).toContain('const startDate = formData.get("start_date")?.toString() ?? "";');
    expect(detailSource).toContain('const endDate = formData.get("end_date")?.toString() ?? "";');
    expect(detailSource).toContain("start_date: startDate || null");
    expect(detailSource).toContain("end_date: endDate || null");
  });

  it("continues to display the saved deadline from the existing project end_date field", () => {
    expect(detailSource).toContain('{project.end_date ? (');
    expect(detailSource).toContain('{t("schedule.deadline")}:');
    expect(detailSource).toContain("{project.end_date}");
  });

  it("keeps project updates behind the existing manager context gate", () => {
    expect(updateRouteSource).toContain("const { profile } = await requireManagerContext(supabase);");
    expect(updateRouteSource).toContain("fallbackStartDate: existingProject.start_date");
    expect(updateRouteSource).toContain("fallbackEndDate: existingProject.end_date");
    expect(updateRouteSource).toContain("updateProjectTolerant(");
  });
});
