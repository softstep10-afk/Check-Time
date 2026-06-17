import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const layoutSource = read("src/app/(worker)/layout.tsx");
const loadingSource = read("src/app/(worker)/loading.tsx");
const errorSource = read("src/app/(worker)/error.tsx");
const workerDataSource = read("src/lib/worker-data.ts");
const workerShellSource = read("src/components/worker/WorkerShell.tsx");
const workerProjectViewSource = read("src/components/worker/WorkerProjectView.tsx");
const shellDataRouteSource = read("src/app/api/worker/shell-data/route.ts");

describe("worker shell loading resilience source guards", () => {
  it("keeps worker layout bootstrap-only so chrome is not blocked by full shell data", () => {
    expect(layoutSource).toContain("getWorkerShellBootstrapData");
    expect(layoutSource).toContain("<WorkerShell initialData={workerShellData}>{children}</WorkerShell>");
    expect(layoutSource).not.toContain("WorkerBootFallback");
    expect(layoutSource).not.toContain("getWorkerShellData");
    expect(layoutSource).toContain("export default async function Layout");
  });

  it("keeps explicit worker loading and error screens", () => {
    expect(loadingSource).not.toContain("WorkerBootFallback");
    expect(loadingSource).not.toContain("min-h-screen");
    expect(loadingSource).not.toContain("Загружаем рабочий экран");
    expect(loadingSource).toContain("WorkerSectionSkeleton");
    expect(errorSource).toContain('"use client"');
    expect(errorSource).toContain("Не удалось открыть рабочий экран");
    expect(errorSource).toContain("Обновить");
    expect(errorSource).toContain("unstable_retry ?? reset");
  });

  it("keeps worker data queries timed out and non-fatal after profile bootstrap", () => {
    expect(workerDataSource).toContain("WORKER_QUERY_TIMEOUT_MS");
    expect(workerDataSource).toContain("Promise.race");
    expect(workerDataSource).toContain("rowsOrEmpty");
    expect(workerDataSource).toContain("PROFILE_BOOTSTRAP_SELECT");
    expect(workerDataSource).toContain("buildSyntheticWorkerProfile");
    expect(workerDataSource).toContain(".maybeSingle<ProfileWithoutRate>()");
    expect(workerDataSource).not.toContain("assertNoError");
    expect(workerDataSource).not.toContain(".single<Profile>()");
  });

  it("uses one client channel for full worker shell data", () => {
    expect(workerDataSource).toContain("export async function loadWorkerShellData");
    expect(workerDataSource).toContain("getWorkerShellBootstrapData");
    expect(shellDataRouteSource).toContain("loadWorkerShellData");
    expect(workerShellSource).toContain('fetch("/api/worker/shell-data"');
    expect(workerShellSource).toContain("applyQueuedEventsToShell(fullData, eventQueue)");
    expect(workerShellSource).not.toContain("setShell(initialData)");
    expect(workerShellSource).not.toContain("startTransition(() => router.refresh())");
  });

  it("leaves page-prop project refreshes outside the shell data channel", () => {
    const projectRefreshCount = (workerProjectViewSource.match(/router\.refresh\(\)/g) ?? []).length;
    expect(projectRefreshCount).toBeGreaterThanOrEqual(2);
    expect(workerProjectViewSource).toContain("onSaved={() => router.refresh()}");
  });
});
