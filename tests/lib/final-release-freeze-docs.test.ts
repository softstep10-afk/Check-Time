import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const freezePath = resolve(process.cwd(), "docs/ALPHA7_FINAL_RELEASE_FREEZE.md");
const qaPath = resolve(process.cwd(), "docs/ALPHA7_FINAL_QA_CHECKLIST.md");
const freezeDoc = readFileSync(freezePath, "utf8");
const qaDoc = readFileSync(qaPath, "utf8");

describe("Alpha-7 final release freeze docs", () => {
  it("creates the final release freeze and QA checklist docs", () => {
    expect(existsSync(freezePath)).toBe(true);
    expect(existsSync(qaPath)).toBe(true);
  });

  it("records deployed commits, known risks, blocked Supabase items, and rollback discipline", () => {
    for (const term of [
      "Known Production Deploy Trail",
      "303f358",
      "c023509",
      "Known Risks",
      "Blocked Supabase",
      "Do Not Touch Zones",
      "Rollback Procedure",
      "00099_wash_and_reset.sql",
      "Supabase Step 0",
      "/admin/diagnostics",
    ]) {
      expect(freezeDoc).toContain(term);
    }
  });

  it("covers owner, manager, worker, driver, project, tasks, media, messages, shift, payroll/archive, offline, and consent QA", () => {
    for (const term of [
      "Owner/admin",
      "Manager",
      "Worker",
      "Driver",
      "Project",
      "Tasks",
      "Media",
      "Messages",
      "Start shift",
      "Payroll",
      "Archive",
      "Offline",
      "GPS consent",
      "Safety Brief",
    ]) {
      expect(qaDoc).toContain(term);
    }
  });

  it("keeps the final pack as process-only with no database mutation instructions", () => {
    expect(freezeDoc).toContain("does not deploy, run SQL, create migrations");
    expect(qaDoc).toContain("Do not run SQL");
    expect(freezeDoc).not.toContain("vercel deploy --prod");
    expect(freezeDoc).not.toContain("supabase db push");
  });
});
