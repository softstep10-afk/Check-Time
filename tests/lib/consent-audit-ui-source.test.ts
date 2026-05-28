import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const auditPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/admin/audit/page.tsx"),
  "utf8",
);
const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);

describe("GPS and safety consent audit UI source", () => {
  it("loads GPS consent and safety acknowledgement records for owner/admin review", () => {
    expect(auditPageSource).toContain("worker_location_consents");
    expect(auditPageSource).toContain("safety_acknowledgements");
    expect(auditPageSource).toContain('currentProfile?.role === "owner"');
    expect(auditPageSource).toContain('currentProfile?.role === "admin"');
    expect(auditPageSource).toContain("audit.signaturesTitle");
    expect(auditPageSource).toContain("exportSignatureCsv");
  });

  it("uses DB consent as source of truth and version-aware local cache only as cache", () => {
    expect(workerShellSource).toContain("readLatestConsent");
    expect(workerShellSource).toContain("readCachedGpsConsent");
    expect(workerShellSource).toContain("writeCachedGpsConsent");
    expect(workerShellSource).toContain("hasCachedGpsConsentDecision");
    expect(workerShellSource).toContain("await writeConsent");
  });
});
