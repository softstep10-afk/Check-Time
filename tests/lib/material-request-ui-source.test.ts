import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);

describe("manager material request UI source", () => {
  it("keeps manual row editing while adding Excel paste import", () => {
    expect(projectDetailSource).toContain("parseMaterialSpecPaste");
    expect(projectDetailSource).toContain("handleImportMaterialSpec");
    expect(projectDetailSource).toContain("materials.pasteSpecTitle");
    expect(projectDetailSource).toContain("setOrderRows((current) =>");
    expect(projectDetailSource).toContain("materials.addPosition");
  });

  it("saves parsed material items and task attachment ids without requiring a driver", () => {
    expect(projectDetailSource).toContain("const driverUserId = orderAssignedTo || null");
    expect(projectDetailSource).toContain("attachmentMediaIds: uploadedMediaIds");
    expect(projectDetailSource).toContain("materialItems,");
    expect(projectDetailSource).toContain("uploadTaskAttachment");
    expect(projectDetailSource).toContain("ACCEPT_ALL_UPLOADS");
  });
});
