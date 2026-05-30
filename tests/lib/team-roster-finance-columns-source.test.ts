import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const teamPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/TeamPage.tsx"),
  "utf8",
);
const teamRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/team/page.tsx"),
  "utf8",
);
const teamMemberPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/TeamMemberPage.tsx"),
  "utf8",
);

describe("team roster finance cleanup", () => {
  it("keeps the roster focused on team management columns", () => {
    expect(teamPageSource).toContain('t("team.colName")');
    expect(teamPageSource).toContain('t("team.colCategory")');
    expect(teamPageSource).toContain('t("team.colStatus")');
    expect(teamPageSource).toContain('t("team.colHours")');
    expect(teamPageSource).toContain('t("team.colActions")');
    expect(teamPageSource).toContain("const rosterColumnCount = 5");

    expect(teamPageSource).not.toContain('t("team.colRate")');
    expect(teamPageSource).not.toContain('t("team.colEarned")');
    expect(teamPageSource).not.toContain('t("team.colFinance")');
    expect(teamPageSource).not.toContain("currencyFmt");
    expect(teamPageSource).not.toContain("earnedAmount");
    expect(teamPageSource).not.toContain("totals.earned");
  });

  it("removes finance access controls from the roster without touching profile/payroll storage paths", () => {
    expect(teamPageSource).not.toContain("toggleUserCapability");
    expect(teamPageSource).not.toContain("financeOverrides");
    expect(teamPageSource).not.toContain("handleFinanceToggle");
    expect(teamRouteSource).not.toContain("fetchFinanceAccessUserIds");

    expect(teamPageSource).toContain("hourlyRate: hasFinanceAccess");
    expect(teamMemberPageSource).toContain('name="hourly_rate"');
    expect(teamMemberPageSource).toContain('fetch("/api/team/update-profile"');
  });

  it("keeps profile access and team actions visible from the roster", () => {
    expect(teamPageSource).toContain("formatDurationCompact(profile.weekMinutes)");
    expect(teamPageSource).toContain("href={`/team/${profile.id}`}");
    expect(teamPageSource).toContain("href={`/team/${profile.id}#message`}");
    expect(teamPageSource).toContain("handleRemoveProfile(profile)");
  });
});
