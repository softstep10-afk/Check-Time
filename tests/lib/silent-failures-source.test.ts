import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("silent failure hygiene source guards", () => {
  const workerShell = readSource("src/components/worker/WorkerShell.tsx");
  const offlineUploads = readSource("src/lib/offline-uploads.ts");
  const forceCheckout = readSource("src/components/manager/ForceCheckoutButton.tsx");
  const storeVisits = readSource("src/lib/store-visits.ts");
  const storesPage = readSource("src/app/(manager)/stores/page.tsx");

  it("keeps offline media drain failures visible and retryable", () => {
    expect(offlineUploads).toContain('export type OfflineUploadStatus = "pending" | "syncing" | "retry"');
    expect(offlineUploads).toContain("markOfflineUploadStatus");
    expect(workerShell).toContain("markMediaRetry(uploadError.message");
    expect(workerShell).toContain("markMediaRetry(insertError?.message");
    expect(workerShell).toContain('t("uploads.syncFailed")');
  });

  it("reports force-checkout side-effect write failures as partial failures", () => {
    expect(forceCheckout).toContain("const partialFailures: string[] = []");
    expect(forceCheckout).toContain("profileError");
    expect(forceCheckout).toContain("storeVisitResult.ok");
    expect(forceCheckout).toContain("messageError");
    expect(forceCheckout).toContain("auditResult.ok");
    expect(forceCheckout).toContain('"partial"');
    expect(storeVisits).toContain("failures.push");
  });

  it("surfaces supply-store toggle write failures before changing local state", () => {
    const toggleStart = storesPage.indexOf("async function handleToggle");
    const toggleSource = storesPage.slice(toggleStart, storesPage.indexOf("return (", toggleStart));

    expect(toggleSource).toContain("const { error } = await supabase");
    expect(toggleSource).toContain('setMessage(error.message || t("stores.toggleFailed"))');
    expect(toggleSource.indexOf("if (error)")).toBeLessThan(toggleSource.indexOf("setStores((prev)"));
  });
});
