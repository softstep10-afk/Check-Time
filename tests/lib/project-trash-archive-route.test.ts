import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/projects/[id]/route.ts"),
  "utf8",
);

const projectArchiveRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/projects/[id]/archive/route.ts"),
  "utf8",
);

const deleteRouteSource = projectRouteSource.slice(
  projectRouteSource.indexOf("export async function DELETE"),
  projectRouteSource.indexOf("export async function PATCH"),
);

describe("project trash/archive routes", () => {
  it("soft-deletes projects without marking them archived", () => {
    expect(deleteRouteSource).toContain('action: "project_moved_to_trash"');
    expect(deleteRouteSource).toContain("deleted_at: deletedAt");
    expect(deleteRouteSource).not.toContain('status: "archived"');
  });

  it("keeps trash audit data separate from archive status", () => {
    const auditAfterData = deleteRouteSource.slice(
      deleteRouteSource.indexOf("afterData: {"),
      deleteRouteSource.indexOf("revalidatePath(\"/overview\")"),
    );

    expect(auditAfterData).toContain("deleted_at: deletedAt");
    expect(auditAfterData).not.toContain('status: "archived"');
  });

  it("preserves archive route semantics separately from trash", () => {
    expect(projectArchiveRouteSource).toContain('action: "project_archived"');
    expect(projectArchiveRouteSource).toContain('status: "archived"');
    expect(projectArchiveRouteSource).toContain("deleted_at: null");
    expect(projectArchiveRouteSource).toContain("archived_at: now");
    expect(projectArchiveRouteSource).toContain("archived_by: archivedBy");
  });
});
