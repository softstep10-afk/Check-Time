import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);

function indexOfRequired(source: string, token: string) {
  const index = source.indexOf(token);
  expect(index, `${token} should exist`).toBeGreaterThanOrEqual(0);
  return index;
}

describe("worker mobile navigation layout", () => {
  it("keeps the worker navigation at the top before the main scroll content", () => {
    const topNavIndex = indexOfRequired(workerShellSource, 'data-testid="worker-mobile-top-nav"');
    const mainIndex = indexOfRequired(workerShellSource, '<main className="flex-1');

    expect(topNavIndex).toBeLessThan(mainIndex);
  });

  it("keeps all worker route destinations available", () => {
    for (const href of [
      "/clock",
      "/my-projects",
      "/journal",
      "/my-tasks",
      "/schedule",
      "/hours",
    ]) {
      expect(workerShellSource).toContain(`href: "${href}"`);
    }
  });

  it("adds explicit mobile spacing so task and schedule buttons do not visually merge", () => {
    expect(workerShellSource).toContain("gap-2.5");
    expect(workerShellSource).toContain("whitespace-nowrap");
    expect(workerShellSource).toContain("min-h-10");
  });

  it("does not keep the duplicate fixed bottom worker nav", () => {
    expect(workerShellSource).not.toContain("fixed bottom-0 left-0 right-0 z-30");
  });
});
