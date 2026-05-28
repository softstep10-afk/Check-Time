import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canConfirmGpsConsent } from "@/lib/gps-consent-ui";

const modalSource = readFileSync(
  resolve(process.cwd(), "src/components/worker/GpsConsentModal.tsx"),
  "utf8",
);

describe("GPS consent modal enablement", () => {
  it("requires the checkbox and a non-empty signature name", () => {
    expect(canConfirmGpsConsent(false, "Test Worker")).toBe(false);
    expect(canConfirmGpsConsent(true, "")).toBe(false);
    expect(canConfirmGpsConsent(true, "   ")).toBe(false);
    expect(canConfirmGpsConsent(true, "T")).toBe(true);
    expect(canConfirmGpsConsent(true, " Test Worker ")).toBe(true);
  });

  it("handles mobile input events and async save errors without closing falsely", () => {
    expect(modalSource).toContain("onInput={(e) => setSignedName(e.currentTarget.value)}");
    expect(modalSource).toContain('busyAction === "accept"');
    expect(modalSource).toContain("gps.consentSaveFailed");
    expect(modalSource).toContain("await onAccept(signedName.trim())");
  });
});
