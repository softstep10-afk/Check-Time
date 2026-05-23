import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/tasks/route.ts"),
  "utf8",
);

describe("manager material task route guard", () => {
  it("requires material tasks to have a driver assignee", () => {
    expect(routeSource).toContain("Choose a driver for the material task.");
    expect(routeSource).toContain("Material tasks can only be assigned to drivers.");
    expect(routeSource).toContain("isMaterialDriverProfile");
    expect(routeSource).toContain("readMaterialDriverProfileIdsFromEnv");
    expect(routeSource).toContain("configuredDriverProfileIds");
    expect(routeSource).toContain(".select(\"id, org_id, role, is_active, deleted_at\")");
  });

  it("keeps normal task creation on the same route", () => {
    expect(routeSource).toContain('source: materialEnabled ? "manager_material_task"');
    expect(routeSource).toContain(": readText(body.source) || \"manager_task\"");
    expect(routeSource).toContain("materialEnabled");
  });
});
