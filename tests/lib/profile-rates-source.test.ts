import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const createRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/team/create/route.ts"),
  "utf8",
);
const updateRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/team/update-profile/route.ts"),
  "utf8",
);
const managerDataSource = readFileSync(
  resolve(process.cwd(), "src/lib/manager-data.ts"),
  "utf8",
);
const workerDataSource = readFileSync(
  resolve(process.cwd(), "src/lib/worker-data.ts"),
  "utf8",
);
const profileRatesSource = readFileSync(
  resolve(process.cwd(), "src/lib/profile-rates.ts"),
  "utf8",
);
const profileSelectSource =
  profileRatesSource.match(/export const PROFILE_SELECT_WITHOUT_RATE = \[[\s\S]*?\]\.join\(", "\);/)?.[0] ?? "";
const payrollRunSource = readFileSync(
  resolve(process.cwd(), "src/app/api/payroll/run/route.ts"),
  "utf8",
);
const payrollExportSource = readFileSync(
  resolve(process.cwd(), "src/app/api/payroll/export/route.ts"),
  "utf8",
);
const payWorkerSource = readFileSync(
  resolve(process.cwd(), "src/app/api/team/pay-worker/route.ts"),
  "utf8",
);
const annualReportClientSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/reports/annual/AnnualReportClient.tsx"),
  "utf8",
);
const annualReportRouteSource = readFileSync(
  resolve(process.cwd(), "src/app/api/reports/annual/route.ts"),
  "utf8",
);
const scheduleClientSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/schedule/SchedulePageClient.tsx"),
  "utf8",
);

const rateReadSources = {
  "src/lib/manager-data.ts": managerDataSource,
  "src/lib/worker-data.ts": workerDataSource,
  "src/app/api/payroll/run/route.ts": payrollRunSource,
  "src/app/api/payroll/export/route.ts": payrollExportSource,
  "src/app/api/team/pay-worker/route.ts": payWorkerSource,
  "src/app/(manager)/reports/annual/AnnualReportClient.tsx": annualReportClientSource,
  "src/app/api/reports/annual/route.ts": annualReportRouteSource,
  "src/app/(manager)/schedule/SchedulePageClient.tsx": scheduleClientSource,
};

function readSourceFiles(dir: string): Array<{ file: string; source: string }> {
  const entries: Array<{ file: string; source: string }> = [];
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      entries.push(...readSourceFiles(fullPath));
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
    entries.push({
      file: fullPath.replace(process.cwd(), "").replace(/^[\\/]/, ""),
      source: readFileSync(fullPath, "utf8"),
    });
  }
  return entries;
}

const srcSources = readSourceFiles(resolve(process.cwd(), "src"));

function readCallArg(source: string, callIndex: number): string | null {
  const openIndex = source.indexOf("(", callIndex);
  if (openIndex < 0) return null;

  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex + 1, index).trim();
      }
    }
  }

  return null;
}

function findProfileSelectArgs(source: string): string[] {
  return [...source.matchAll(/\.from\(\s*["']profiles["']\s*\)/g)].map((match) => {
    const currentFromEnd = match.index + match[0].length;
    const nextFromIndex = source.indexOf(".from(", currentFromEnd);
    const after = source.slice(match.index, nextFromIndex === -1 ? undefined : nextFromIndex);
    const selectMatch = after.match(/\.select\s*\(/);
    if (!selectMatch || selectMatch.index === undefined) return "";
    return readCallArg(source, match.index + selectMatch.index) ?? "";
  });
}

function countOrgFilters(source: string, expression: string): number {
  return (source.match(new RegExp(`\\.eq\\("${expression}", org\\.id\\)`, "g")) ?? []).length;
}

describe("profile_rates migration guards", () => {
  it("writes team member rates through profile_rates upsert", () => {
    expect(createRouteSource).toContain("upsertProfileRate(adminClient");
    expect(updateRouteSource).toContain("upsertProfileRate(adminClient");
    expect(createRouteSource).not.toContain("hourly_rate: hourlyRate");
    expect(updateRouteSource).not.toContain("updates.hourly_rate");
  });

  it("hydrates manager and payroll profile rates outside profiles.select star", () => {
    expect(managerDataSource).toContain("hydrateProfilesWithRates");
    expect(managerDataSource).toContain("PROFILE_SELECT_WITHOUT_RATE");

    expect(payrollRunSource).toContain("hydrateProfilesWithRates");
    expect(payrollRunSource).toContain("PROFILE_SELECT_WITHOUT_RATE");

    expect(profileRatesSource).toContain('.from("profile_rates")');
    expect(profileRatesSource).toContain('.select("profile_id, hourly_rate")');
    expect(profileRatesSource).not.toContain("profiles(");
    expect(profileRatesSource).not.toMatch(/\.select\([^)]*pin_hash/);
    // Legacy fallback removed: profile-rates.ts no longer reads the
    // profiles.hourly_rate column; rates come solely from profile_rates.
    expect(profileRatesSource).not.toContain('.from("profiles")');
    expect(profileRatesSource).not.toContain('.select("id, hourly_rate")');

    for (const [file, source] of Object.entries(rateReadSources)) {
      expect(source, file).not.toMatch(/\.from\("profiles"\)\s*\.select\("\*"\)/);
    }

    expect(countOrgFilters(payrollRunSource, "org_id")).toBe(4);
    expect(countOrgFilters(payrollExportSource, "org_id")).toBe(4);
    expect(countOrgFilters(payWorkerSource, "org_id")).toBe(4);
    expect(profileRatesSource).toContain("outside the authenticated org");
  });

  it("keeps annual worker report profile reads on display-safe columns", () => {
    expect(annualReportClientSource).not.toContain('.from("profiles")');
    expect(annualReportRouteSource).toContain('const ANNUAL_PROFILE_SELECT = "id, name, role"');
    expect(annualReportRouteSource).toContain(".select(ANNUAL_PROFILE_SELECT)");
    expect(annualReportClientSource).not.toMatch(/\.from\("profiles"\)\s*\.select\("\*"\)/);
    expect(annualReportRouteSource).not.toMatch(/\.from\("profiles"\)\s*\.select\("\*"\)/);
    expect(annualReportRouteSource).not.toMatch(/hourly_rate|pin_hash/);
    expect(profileRatesSource).toContain('"name"');
    expect(profileRatesSource).toContain('"role"');
    expect(profileRatesSource).toContain('"color"');
    expect(profileRatesSource).toContain('"is_active"');
    expect(profileSelectSource).not.toContain('"hourly_rate"');
    expect(profileSelectSource).not.toContain('"pin_hash"');
  });

  it("keeps schedule profile reads on display-safe columns", () => {
    expect(scheduleClientSource).toContain("PROFILE_SELECT_WITHOUT_RATE");
    expect(scheduleClientSource).toContain("profilesWithoutRates");
    expect(scheduleClientSource).toContain("withNullProfileRate");
    expect(scheduleClientSource).not.toMatch(/\.from\("profiles"\)\s*\.select\("\*"\)/);
  });

  it("does not read the full profiles table anywhere in src", () => {
    for (const { file, source } of srcSources) {
      for (const selectArg of findProfileSelectArgs(source)) {
        expect(selectArg, file).not.toMatch(/^["']\*["']$/);
      }
      expect(source, file).not.toMatch(/profiles(?:![\w_]+)?\s*\(\s*\*/);
    }
  });
});
