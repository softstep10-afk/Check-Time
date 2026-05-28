import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workerProjectViewSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerProjectView.tsx"),
  "utf8",
);
const checkoutModalSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/CheckoutModal.tsx"),
  "utf8",
);

describe("worker active project checkout action", () => {
  it("keeps a visible checkout entry point inside the active project flow", () => {
    expect(workerProjectViewSource).toContain("clockedInHere ? (");
    expect(workerProjectViewSource).toContain('data-testid="active-project-checkout-button"');
    expect(workerProjectViewSource).toContain('onClick={() => setCheckoutOpen(true)}');
    expect(workerProjectViewSource).toContain('t("clock.endShiftCta")');
    expect(workerProjectViewSource).toContain("<CheckoutModal open={checkoutOpen}");
  });

  it("keeps checkout notes optional while preserving video/upload validation gates", () => {
    expect(checkoutModalSource).toContain(
      "const disabled = !videoSatisfied || uploading || checkingOut;",
    );
    expect(checkoutModalSource).toContain("note: checkoutNote");
    expect(checkoutModalSource).not.toContain("checkoutNote.trim()");
    expect(checkoutModalSource).toContain("const videoSatisfied = !requireVideo || hasVideoToday || pickedAt !== null;");
  });

  it("keeps the mobile checkout action row visible and not clipped below the note field", () => {
    expect(checkoutModalSource).toContain('data-testid="checkout-modal-panel"');
    expect(checkoutModalSource).toContain("max-h-[calc(100dvh-1rem)]");
    expect(checkoutModalSource).toContain("overflow-y-auto");
    expect(checkoutModalSource).toContain('data-testid="checkout-action-row"');
    expect(checkoutModalSource).toContain("sticky bottom-0");
    expect(checkoutModalSource).toContain("env(safe-area-inset-bottom)");
    expect(checkoutModalSource).toContain('data-testid="checkout-confirm"');
    expect(checkoutModalSource).toContain("min-h-12 w-full");
  });
});
