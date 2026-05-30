import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY_VERSION,
  buildSafetyAckInsert,
  canConfirmSafetyBrief,
  normalizeSafetySignedName,
} from "@/lib/safety-acknowledgements";

const safetySource = readFileSync(
  resolve(process.cwd(), "src/lib/safety-acknowledgements.ts"),
  "utf8",
);
const workerProjectSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const safetyModalSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/SafetyBriefModal.tsx"),
  "utf8",
);
const auditPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(manager)/admin/audit/page.tsx"),
  "utf8",
);

describe("safety acknowledgement audit helpers", () => {
  it("builds an insert payload linked to worker, org, project, version, and typed name", () => {
    expect(
      buildSafetyAckInsert({
        orgId: "org-1",
        workerId: "worker-1",
        projectId: "project-1",
        safetyVersion: DEFAULT_SAFETY_VERSION,
        signedName: " Test   Worker ",
      }),
    ).toEqual({
      org_id: "org-1",
      worker_id: "worker-1",
      project_id: "project-1",
      safety_version: DEFAULT_SAFETY_VERSION,
      signed_name: "Test Worker",
    });
  });

  it("requires checkbox plus a non-empty typed safety signature name", () => {
    expect(normalizeSafetySignedName(" Test   Worker ")).toBe("Test Worker");
    expect(canConfirmSafetyBrief(false, "Test Worker")).toBe(false);
    expect(canConfirmSafetyBrief(true, "")).toBe(false);
    expect(canConfirmSafetyBrief(true, "   ")).toBe(false);
    expect(canConfirmSafetyBrief(true, " Test Worker ")).toBe(true);
    expect(() =>
      buildSafetyAckInsert({
        orgId: "org-1",
        workerId: "worker-1",
        projectId: null,
        safetyVersion: DEFAULT_SAFETY_VERSION,
        signedName: "   ",
      }),
    ).toThrow("Typed safety signature name is required.");
  });

  it("checks existing acknowledgement by worker and safety version before asking again", () => {
    expect(safetySource).toContain(".from(\"safety_acknowledgements\")");
    expect(safetySource).toContain(".eq(\"worker_id\", params.workerId)");
    expect(safetySource).toContain(".eq(\"safety_version\", params.safetyVersion)");
    expect(workerProjectSource).toContain("readLatestSafetyAck");
    expect(workerProjectSource).toContain("DEFAULT_SAFETY_VERSION");
    expect(workerProjectSource).toContain('ackState === "acknowledged"');
  });

  it("captures typed name in the modal and owner/admin audit view", () => {
    expect(safetyModalSource).toContain("safety.signatureLabel");
    expect(safetyModalSource).toContain("onInput={(event) => setSignedName(event.currentTarget.value)}");
    expect(safetyModalSource).toContain("canConfirmSafetyBrief");
    expect(workerProjectSource).toContain("signedName,");
    expect(auditPageSource).toContain("id, worker_id, project_id, signed_name");
    expect(auditPageSource).toContain("row.signed_name?.trim()");
  });
});
