import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/app/api/media/[id]/route.ts"),
  "utf8",
);

const projectDetailSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectDetailPage.tsx"),
  "utf8",
);

const planningSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectPlanningSections.tsx"),
  "utf8",
);

const planningRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/manager/projects/[id]/planning/route.ts"),
  "utf8",
);

describe("media delete route and UI guards", () => {
  it("checks actor permission before creating the admin client", () => {
    expect(routeSource.indexOf("canDeleteMediaEverywhereServer(profile)")).toBeGreaterThan(-1);
    expect(routeSource.indexOf("canDeleteMediaEverywhereServer(profile)")).toBeLessThan(
      routeSource.indexOf("createAdminClient()"),
    );
    expect(routeSource).toContain('status: 401');
    expect(routeSource).toContain("softDeleteMediaForActor");
  });

  it("routes receipt delete through the guarded API and hides the action otherwise", () => {
    expect(projectDetailSource).toContain("canDeleteMedia: boolean");
    expect(projectDetailSource).toContain('fetch(`/api/media/${receipt.id}`, { method: "DELETE" })');
    expect(projectDetailSource).toContain("{canDeleteMedia ? (");
    expect(projectDetailSource).not.toContain('.from("media")\n      .update({ deleted_at: deletedAt })\n      .eq("id", receipt.id)');
  });

  it("keeps planning media attachment removal behind the same UI flag", () => {
    expect(planningSource).toContain("canDeleteMedia: boolean");
    expect(planningSource).toContain("isMediaPlanningAttachment");
    expect(planningSource).toContain("!isMediaPlanningAttachment(attachment) || canDeleteMedia");
    expect(planningSource).toContain("!estimateHasMediaAttachments(estimate) || canDeleteMedia");
    expect(planningRouteSource).toContain("getRemovedProjectPlanningMediaIds");
    expect(planningRouteSource).toContain("canDeleteMediaEverywhereServer(profile)");
  });
});
