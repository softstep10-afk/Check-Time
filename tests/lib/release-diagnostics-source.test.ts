import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const diagnosticsPageSource = readSource("src/app/(manager)/admin/diagnostics/page.tsx");
const managerLayoutSource = readSource("src/app/(manager)/layout.tsx");
const releaseScriptSource = readSource("scripts/alpha7-release-audit.mjs");

describe("release diagnostics source guards", () => {
  it("keeps production diagnostics owner/admin-only", () => {
    expect(diagnosticsPageSource).toContain("requireManagerContext");
    expect(diagnosticsPageSource).toContain("if (profile.role !== \"owner\" && profile.role !== \"admin\")");
    expect(diagnosticsPageSource).toContain("redirect(\"/overview\")");
    expect(managerLayoutSource).toContain("href: \"/admin/diagnostics\"");
    expect(managerLayoutSource).toContain("ownerOnly: true");
  });

  it("exposes release metadata without service secrets or private data", () => {
    expect(diagnosticsPageSource).toContain("getReleaseDiagnostics()");
    expect(diagnosticsPageSource).toContain("does not expose secrets");
    expect(diagnosticsPageSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(diagnosticsPageSource).not.toContain("DATABASE_URL");
    expect(diagnosticsPageSource).not.toContain("createAdminClient");
  });

  it("keeps release audit read-only", () => {
    expect(releaseScriptSource).toContain("git");
    expect(releaseScriptSource).toContain("vercel");
    expect(releaseScriptSource).not.toContain("[\"deploy\"");
    expect(releaseScriptSource).not.toContain("writeFile");
    expect(releaseScriptSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
