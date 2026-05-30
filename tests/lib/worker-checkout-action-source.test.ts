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
const workerShellSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/WorkerShell.tsx"),
  "utf8",
);
const clockPageSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/ClockPage.tsx"),
  "utf8",
);

describe("worker active project checkout action", () => {
  it("keeps a visible explicit checkout entry point inside the active project flow", () => {
    expect(workerProjectViewSource).toContain("clockedInHere ? (");
    expect(workerProjectViewSource).toContain('data-testid="active-project-checkout-button"');
    expect(workerProjectViewSource).toContain("function openCheckoutIfActive()");
    expect(workerProjectViewSource).toContain("onClick={openCheckoutIfActive}");
    expect(workerProjectViewSource).toContain('t("clock.endShiftCta")');
    expect(workerProjectViewSource).toContain("<CheckoutModal open={checkoutOpen}");
    expect(workerProjectViewSource).toContain("const [checkoutOpen, setCheckoutOpen] = useState(false);");
    expect(workerProjectViewSource).not.toContain("<CheckoutModal open={clockedInHere}");
    expect(workerProjectViewSource).not.toContain("useState(clockedInHere");
  });

  it("keeps checkout notes optional while preserving video/upload validation gates", () => {
    expect(checkoutModalSource).toContain(
      "const disabled = !videoSatisfied || uploading || checkingOut;",
    );
    expect(checkoutModalSource).toContain("note: checkoutNote");
    expect(checkoutModalSource).not.toContain("checkoutNote.trim()");
    expect(checkoutModalSource).toContain("const videoSatisfied = !requireVideo || hasVideoToday || pickedAt !== null;");
  });

  it("keeps the mobile checkout sheet roomy and avoids tiny nested scrolling", () => {
    expect(checkoutModalSource).toContain('data-testid="checkout-modal-panel"');
    expect(checkoutModalSource).toContain('role="dialog"');
    expect(checkoutModalSource).toContain('aria-modal="true"');
    expect(checkoutModalSource).toContain("min-h-[100dvh]");
    expect(checkoutModalSource).toContain("sm:max-w-[720px]");
    expect(checkoutModalSource).toContain("fixed inset-0 z-[60] flex items-stretch justify-center overflow-y-auto");
    expect(checkoutModalSource).not.toContain("max-h-[calc(100dvh-1rem)]");
    expect(checkoutModalSource).not.toContain("max-h-[calc(100dvh-0.75rem)]");
    expect(checkoutModalSource).not.toContain("overscroll-contain overflow-y-auto rounded-t");
    expect(checkoutModalSource).toContain("overflow-y-auto");
    expect(checkoutModalSource).toContain('data-testid="checkout-action-row"');
    expect(checkoutModalSource).toContain("sticky bottom-0");
    expect(checkoutModalSource).toContain("env(safe-area-inset-bottom)");
    expect(checkoutModalSource).toContain('data-testid="checkout-confirm"');
    expect(checkoutModalSource).toContain("min-h-12 w-full");
    expect(checkoutModalSource).toContain('id="before-leave-file"');
    expect(checkoutModalSource).toContain("inline-flex min-h-12 w-full items-center justify-center");
    expect(checkoutModalSource).toContain("min-h-[140px] w-full");
  });

  it("closes stale checkout UI when the active shift is already gone", () => {
    expect(checkoutModalSource).toContain("if (shell.clockState.isClockedIn && shell.clockState.currentProjectId) return;");
    expect(checkoutModalSource).toContain("resetAndClose();");
    expect(workerProjectViewSource).toContain("if (!checkoutOpen || isClockedIn) return;");
    expect(clockPageSource).toContain("if (!checkoutOpen || shell.clockState.isClockedIn) return;");
    expect(workerProjectViewSource).toContain("window.setTimeout(() =>");
    expect(clockPageSource).toContain("window.setTimeout(() =>");
    expect(workerProjectViewSource).toContain("if (!isClockedIn)");
    expect(clockPageSource).toContain("if (!shell.clockState.isClockedIn)");
  });

  it("prevents duplicate checkout requests and treats already-ended server state as closed", () => {
    expect(checkoutModalSource).toContain("const checkoutSubmittingRef = useRef(false);");
    expect(checkoutModalSource).toContain("if (disabled || checkoutSubmittingRef.current) return;");
    expect(checkoutModalSource).toContain("setSubmittingCheckout(true);");
    expect(workerShellSource).toContain("const clockOutInFlightRef = useRef(false);");
    expect(workerShellSource).toContain("if (clockOutInFlightRef.current)");
    expect(workerShellSource).toContain("let alreadyClosedRemotely = false;");
    expect(workerShellSource).toContain("response.status === 409");
    expect(workerShellSource).toContain("clearLocalActiveShiftState();");
    expect(workerShellSource).toContain('setBanner({ tone: "info", text: "Shift is already closed." });');
  });
});
