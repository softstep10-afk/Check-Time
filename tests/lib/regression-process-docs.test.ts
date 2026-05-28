import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Alpha-7 regression process guardrails", () => {
  it("keeps the permanent impact, smoke, and dangerous-zone docs in place", () => {
    const impact = read("docs/REGRESSION_IMPACT_RULES_ALPHA7.md");
    const smoke = read("docs/CRITICAL_PATH_SMOKE_ALPHA7.md");
    const dangerous = read("docs/DANGEROUS_ZONES_ALPHA7.md");

    expect(impact).toContain("Mandatory Impact Map");
    expect(impact).toContain("Dangerous zones touched");
    expect(smoke).toContain("Core Smoke Checklist");
    expect(smoke).toContain("Project media tabs");
    expect(dangerous).toContain("Stop-And-Report Rules");
    expect(dangerous).toContain("service-role");
  });

  it("wires process scripts into package scripts", () => {
    const packageJson = read("package.json");
    const impactScript = read("scripts/alpha7-impact-template.mjs");
    const smokeScript = read("scripts/alpha7-critical-smoke.mjs");

    expect(packageJson).toContain("\"alpha7:impact-template\"");
    expect(packageJson).toContain("\"alpha7:critical-smoke\"");
    expect(impactScript).toContain("Alpha-7 Impact Map");
    expect(smokeScript).toContain("CRITICAL_PATH_SMOKE_ALPHA7.md");
  });

  it("keeps release docs requiring impact and dangerous-zone review", () => {
    const predeploy = read("docs/PREDEPLOY_CHECKLIST.md");
    const release = read("docs/RELEASE_FREEZE_ALPHA7.md");
    const ownerQa = read("docs/OWNER_MANUAL_QA_CHECKLIST.md");

    expect(predeploy).toContain("Dangerous zones touched");
    expect(predeploy).toContain("alpha7:critical-smoke");
    expect(release).toContain("dangerous-zone declaration");
    expect(release).toContain("CRITICAL_PATH_SMOKE_ALPHA7.md");
    expect(ownerQa).toContain("CRITICAL_PATH_SMOKE_ALPHA7.md");
  });
});
