import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("receipts and PIN hygiene source guards", () => {
  it("loads manager project receipts through the bounded server route", () => {
    const projectDetail = source("src/components/manager/ProjectDetailPage.tsx");

    expect(projectDetail).toContain('fetch(`/api/manager/projects/${projectId}/receipts`)');
    expect(projectDetail).not.toMatch(
      /\.select\("\*"\)\s*\.eq\("project_id", projectId\)\s*\.eq\("metadata->>category", "receipt"\)/,
    );
  });

  it("keeps the receipts route authenticated, role-gated, org-scoped, and bounded", () => {
    const route = source("src/app/api/manager/projects/[id]/receipts/route.ts");

    expect(route).toContain("supabase.auth.getUser()");
    expect(route).toContain("isManagerRole(actor.role)");
    expect(route).toContain('.select("id, role, org_id")');
    expect(route).toContain('.eq("org_id", actor.org_id)');
    expect(route).toContain("RECEIPT_ROW_LIMIT");
    expect(route).toContain("RECEIPT_SELECT");
  });

  it("returns only the UI-consumed PIN from reset-pin", () => {
    const route = source("src/app/api/team/reset-pin/route.ts");

    expect(route).toContain("return NextResponse.json({ pin: newPin });");
    expect(route).not.toContain("ok: true, pin");
  });
});
