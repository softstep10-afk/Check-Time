import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAFETY_VERSION,
  buildSafetyAckInsert,
} from "@/lib/safety-acknowledgements";

const safetySource = readFileSync(
  resolve(process.cwd(), "src/lib/safety-acknowledgements.ts"),
  "utf8",
);
const workerProjectSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);

describe("safety acknowledgement audit helpers", () => {
  it("builds an insert payload linked to worker, org, project, and version", () => {
    expect(
      buildSafetyAckInsert({
        orgId: "org-1",
        workerId: "worker-1",
        projectId: "project-1",
        safetyVersion: DEFAULT_SAFETY_VERSION,
      }),
    ).toEqual({
      org_id: "org-1",
      worker_id: "worker-1",
      project_id: "project-1",
      safety_version: DEFAULT_SAFETY_VERSION,
    });
  });

  it("checks existing acknowledgement by worker and safety version before asking again", () => {
    expect(safetySource).toContain(".from(\"safety_acknowledgements\")");
    expect(safetySource).toContain(".eq(\"worker_id\", params.workerId)");
    expect(safetySource).toContain(".eq(\"safety_version\", params.safetyVersion)");
    expect(workerProjectSource).toContain("readLatestSafetyAck");
    expect(workerProjectSource).toContain("DEFAULT_SAFETY_VERSION");
    expect(workerProjectSource).toContain('ackState === "acknowledged"');
  });
});
