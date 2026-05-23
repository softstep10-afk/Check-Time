import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translations } from "@/lib/i18n/translations";

const teamPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/TeamPage.tsx"),
  "utf8",
);
const teamMemberPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/TeamMemberPage.tsx"),
  "utf8",
);
const updateRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/team/update-profile/route.ts"),
  "utf8",
);
const createRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/team/create/route.ts"),
  "utf8",
);
const srcBusinessSources = [
  "src/lib/material-driver-permissions.ts",
  "src/components/manager/ProjectDetailPage.tsx",
  "src/app/api/manager/tasks/route.ts",
  "src/components/worker/WorkerShell.tsx",
].map((file) => readFileSync(resolve(process.cwd(), file), "utf8")).join("\n");

describe("driver role setup path", () => {
  it("labels the driver role in Russian without relying on the raw key", () => {
    expect(translations["roles.driver"].ru).toBe("Водитель");
  });

  it("filters create-role options through owner/admin role permissions", () => {
    expect(teamPageSource).toContain("canCreateTeamRole(managerRole, role)");
    expect(teamPageSource).toContain('t(`roles.${role}` as TranslationKey)');
  });

  it("filters profile-edit role options and saves through the guarded API route", () => {
    expect(teamMemberPageSource).toContain("canUpdateTeamRole(managerRole, profile.role, role)");
    expect(teamMemberPageSource).toContain('fetch("/api/team/update-profile"');
    expect(teamMemberPageSource).toContain('t(`roles.${role}` as TranslationKey)');
  });

  it("guards driver role assignment server-side", () => {
    expect(updateRouteSource).toContain("canUpdateTeamRole(actor.role, targetProfile.role, nextRole)");
    expect(updateRouteSource).toContain("Only owner/admin can assign the driver role.");
    expect(updateRouteSource).toContain(".eq(\"org_id\", actor.org_id)");
    expect(createRouteSource).toContain("canCreateTeamRole(profile.role, role)");
    expect(createRouteSource).toContain("Only owner/admin can create driver team members.");
  });

  it("does not hardcode Sanya in source business logic", () => {
    expect(srcBusinessSources).not.toMatch(/\bSanya\b|Саня/);
  });
});
