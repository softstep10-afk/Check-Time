import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const doc = readFileSync(
  resolve(process.cwd(), "docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md"),
  "utf8",
);

const sqlBlocks = [...doc.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);

describe("Supabase Step 0 audit pack", () => {
  it("covers the required read-only Supabase audit surfaces", () => {
    for (const term of [
      "Applied Migrations",
      "RLS",
      "Storage",
      "grants",
      "schema",
      "service-role",
      "owner",
      "manager",
      "worker",
      "driver",
      "projects",
      "tasks",
      "media",
      "messages",
      "time_events",
      "payroll/archive",
      "worker_location_consents",
      "safety_acknowledgements",
    ]) {
      expect(doc).toContain(term);
    }
  });

  it("keeps embedded SQL read-only", () => {
    expect(sqlBlocks.length).toBeGreaterThanOrEqual(10);
    for (const block of sqlBlocks) {
      const normalized = block.trim().toLowerCase();
      expect(normalized.startsWith("select") || normalized.startsWith("with")).toBe(true);
      expect(normalized).not.toMatch(/\b(insert|update|delete|alter|drop|create|truncate|grant|revoke)\b/);
    }
  });

  it("warns not to mutate production database state", () => {
    expect(doc).toContain("Do not run migrations");
    expect(doc).toContain("Do not edit RLS policies");
    expect(doc).toContain("Do not paste secret values");
    expect(doc).toContain("no SQL writes, migrations, schema changes, RLS changes, Storage policy changes, or production data mutations were performed");
  });
});
