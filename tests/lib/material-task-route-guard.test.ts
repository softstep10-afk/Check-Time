import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/tasks/route.ts"),
  "utf8",
);

describe("manager material task route guard", () => {
  it("allows open material tasks and validates selected assignees as field takers", () => {
    expect(routeSource).not.toContain("Choose a driver for the material task.");
    expect(routeSource).toContain("Material tasks can only be assigned to eligible drivers or workers.");
    expect(routeSource).toContain("isEligibleMaterialTaker");
    expect(routeSource).toContain("readMaterialDriverProfileIdsFromEnv");
    expect(routeSource).toContain("configuredDriverProfileIds");
    expect(routeSource).toContain(".select(\"id, org_id, role, is_active, deleted_at\")");
    expect(routeSource).toContain("assignedTo: assignedTo.value");
    expect(routeSource).toContain("materialItems: normalizeMaterialTaskItems(input.materialItems)");
  });

  it("keeps normal task creation on the same route", () => {
    expect(routeSource).toContain('source: materialEnabled ? "manager_material_task"');
    expect(routeSource).toContain(": readText(body.source) || \"manager_task\"");
    expect(routeSource).toContain("materialEnabled");
  });

  it("preserves material request attachments in task metadata", () => {
    expect(routeSource).toContain("const attachmentMediaIds = readUuidArray(body.attachmentMediaIds");
    expect(routeSource).toContain("attachment_media_ids: safeAttachmentMediaIds");
    expect(routeSource).toContain("materialItems: material.materialItems");
  });
});
