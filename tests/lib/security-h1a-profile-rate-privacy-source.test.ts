import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSource(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function walkSourceFiles(dir: string): string[] {
  const absolute = resolve(root, dir);
  const entries = readdirSync(absolute);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(absolute, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(relative(root, path)));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(relative(root, path).split(sep).join("/"));
    }
  }

  return files;
}

const srcFiles = walkSourceFiles("src");
const profileSelectsSource = readSource("src/lib/profile-selects.ts");
const profileRatesSource = readSource("src/lib/profile-rates.ts");

const hourlyRateAllowlist = new Set([
  "src/app/api/team/create/route.ts",
  "src/app/api/team/update-profile/route.ts",
  "src/components/manager/PayrollCalculator.tsx",
  "src/components/manager/TeamMemberPage.tsx",
  "src/components/manager/TeamPage.tsx",
  "src/lib/manager-utils.ts",
  "src/lib/preview-data.ts",
  "src/lib/profile-rates.ts",
  "src/lib/profile-selects.ts",
  "src/types/database.ts",
]);

describe("Security H1A/H1B profile rate privacy source guards", () => {
  it("keeps the safe profile DTO free of compensation and PIN fields", () => {
    const safeSelectBlock = profileSelectsSource.slice(
      profileSelectsSource.indexOf("export const SAFE_PROFILE_SELECT"),
      profileSelectsSource.indexOf("export type SafeProfile"),
    );

    expect(safeSelectBlock).toContain('"id"');
    expect(safeSelectBlock).toContain('"org_id"');
    expect(safeSelectBlock).toContain('"require_video"');
    expect(safeSelectBlock).toContain('"project_access_mode"');
    expect(safeSelectBlock).not.toContain("hourly_rate");
    expect(safeSelectBlock).not.toContain("pin_hash");
  });

  it("does not use broad profiles.select star reads anywhere in app source", () => {
    const offenders = srcFiles.flatMap((file) => {
      const source = readSource(file);
      const matches =
        source.match(/\.from\(["']profiles["']\)(?:(?!\.from\().)*?\.select\(["']\*["']\)/gs) ??
        [];
      return matches.map((match) => `${file}: ${match.replace(/\s+/g, " ")}`);
    });

    expect(offenders).toEqual([]);
  });

  it("keeps hourly_rate references restricted to finance/payroll/team-rate allowlist", () => {
    const offenders = srcFiles.filter((file) => {
      if (hourlyRateAllowlist.has(file)) return false;
      return readSource(file).includes("hourly_rate");
    });

    expect(offenders).toEqual([]);
  });

  it("keeps the hourly_rate selector centralized in the finance-gated profile rate module", () => {
    const safeSelectBlock = profileSelectsSource.slice(
      profileSelectsSource.indexOf("export const SAFE_PROFILE_SELECT"),
      profileSelectsSource.indexOf("export type SafeProfile"),
    );

    expect(safeSelectBlock).not.toContain("hourly_rate");
    expect(profileSelectsSource).not.toContain("PROFILE_WITH_RATE_SELECT");
    expect(profileRatesSource).toContain("PROFILE_WITH_RATE_SELECT");
    expect(profileRatesSource).toContain("hourly_rate");
    expect(profileRatesSource).toContain("resolveProfileRateAccess");
    expect(profileRatesSource).toContain("hasFinanceAccess");
    expect(profileRatesSource.indexOf("hasFinanceAccess")).toBeLessThan(
      profileRatesSource.indexOf(".select(PROFILE_WITH_RATE_SELECT)"),
    );

    const offenders = srcFiles.filter((file) => {
      if (file === "src/lib/profile-rates.ts") return false;
      return readSource(file).includes("PROFILE_WITH_RATE_SELECT");
    });

    expect(offenders).toEqual([]);
  });

  it("keeps known non-finance profile loaders on the safe profile select", () => {
    for (const file of [
      "src/lib/worker-data.ts",
      "src/app/(manager)/schedule/SchedulePageClient.tsx",
      "src/app/api/schedule/route.ts",
      "src/app/(manager)/managers/page.tsx",
      "src/app/(manager)/location-data/page.tsx",
      "src/app/(manager)/reports/annual/AnnualReportClient.tsx",
    ]) {
      const source = readSource(file);
      expect(source).toContain("SAFE_PROFILE_SELECT");
      expect(source).not.toContain("hourly_rate");
    }
  });

  it("keeps payroll rate reads behind finance-gated paths", () => {
    for (const file of [
      "src/app/api/payroll/run/route.ts",
      "src/app/api/payroll/export/route.ts",
      "src/app/api/team/pay-worker/route.ts",
      "src/lib/manager-data.ts",
    ]) {
      const source = readSource(file);
      expect(source).toContain("resolveProfileRateAccess");
      expect(source).toContain("loadProfilesWithRatesForFinance");
      expect(source.indexOf("profileRateAccess")).toBeLessThan(
        source.indexOf("loadProfilesWithRatesForFinance(supabase"),
      );
    }
  });

  it("keeps worker, client, and non-finance surfaces from importing the rate helper", () => {
    const forbiddenImportFiles = srcFiles.filter((file) => {
      if (file === "src/lib/profile-rates.ts") return false;
      const isForbiddenSurface =
        file.includes("/worker/") ||
        file.includes("/clients") ||
        file.includes("/client") ||
        file.includes("Worker") ||
        file.includes("Client");
      return isForbiddenSurface && readSource(file).includes("@/lib/profile-rates");
    });

    expect(forbiddenImportFiles).toEqual([]);
  });

  it("keeps team create/update hourly_rate writes on existing server API paths only", () => {
    expect(readSource("src/app/api/team/create/route.ts")).toContain("hasFinanceAccess");
    expect(readSource("src/app/api/team/create/route.ts")).toContain("hourly_rate: hourlyRate");
    expect(readSource("src/app/api/team/update-profile/route.ts")).toContain("hasFinanceAccess");
    expect(readSource("src/app/api/team/update-profile/route.ts")).toContain(
      "updates.hourly_rate = hourlyRate",
    );
  });
});
