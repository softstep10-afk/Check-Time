import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const claimRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/worker/claim-task/route.ts"),
  "utf8",
);

describe("worker material claim route", () => {
  it("validates material claim eligibility with the shared helper", () => {
    expect(claimRouteSource).toContain("canClaimOpenMaterialTask");
    expect(claimRouteSource).toContain("readMaterialDriverProfileIdsFromEnv");
    expect(claimRouteSource).toContain("isMaterialTask");
    expect(claimRouteSource).toContain("This role cannot claim material tasks.");
  });

  it("keeps first-person-wins predicates on the update", () => {
    expect(claimRouteSource).toContain('.is("assigned_to", null)');
    expect(claimRouteSource).toContain('.neq("status", "done")');
    expect(claimRouteSource).toContain('.is("completed_at", null)');
    expect(claimRouteSource).toContain("Task is already assigned or closed.");
  });

  it("records who claimed the open material task without creating messages", () => {
    expect(claimRouteSource).toContain("delivery_claimed_by");
    expect(claimRouteSource).toContain('schedule_delivery_status: isMaterialDeliveryTask ? "taken" : "claimed"');
    expect(claimRouteSource).not.toContain("message_tasks");
    expect(claimRouteSource).not.toContain("messages");
  });
});
