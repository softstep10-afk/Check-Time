import { describe, expect, it } from "vitest";
import {
  ANDROID_DISMISS_THROTTLE_MS,
  isIosSafari,
  shouldShowAndroidInstall,
  shouldShowIosHint,
} from "@/lib/pwa-install";

const NOW = 1_700_000_000_000;

describe("shouldShowAndroidInstall", () => {
  it("shows when never installed and never dismissed", () => {
    expect(shouldShowAndroidInstall({ installed: false, dismissedAt: null }, NOW)).toBe(true);
  });

  it("never shows once installed, even without a dismissal", () => {
    expect(shouldShowAndroidInstall({ installed: true, dismissedAt: null }, NOW)).toBe(false);
  });

  it("hides during the throttle window after a dismissal", () => {
    const dismissedAt = NOW - (ANDROID_DISMISS_THROTTLE_MS - 1);
    expect(shouldShowAndroidInstall({ installed: false, dismissedAt }, NOW)).toBe(false);
  });

  it("shows again once the throttle window has elapsed", () => {
    const dismissedAt = NOW - ANDROID_DISMISS_THROTTLE_MS;
    expect(shouldShowAndroidInstall({ installed: false, dismissedAt }, NOW)).toBe(true);
  });

  it("installed wins over an elapsed dismissal", () => {
    const dismissedAt = NOW - ANDROID_DISMISS_THROTTLE_MS * 2;
    expect(shouldShowAndroidInstall({ installed: true, dismissedAt }, NOW)).toBe(false);
  });
});

describe("isIosSafari", () => {
  const IPHONE_SAFARI =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const IPHONE_CHROME =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
  const IPADOS_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const ANDROID_CHROME =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  const MAC_SAFARI =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

  it("detects iPhone Safari", () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
  });

  it("excludes Chrome on iOS (no Add to Home Screen flow)", () => {
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
  });

  it("detects iPadOS Safari via touch-capable Macintosh UA", () => {
    expect(isIosSafari(IPADOS_SAFARI, 5)).toBe(true);
  });

  it("treats a real (non-touch) Mac as not iOS", () => {
    expect(isIosSafari(MAC_SAFARI, 0)).toBe(false);
  });

  it("does not treat Android Chrome as iOS Safari", () => {
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("shouldShowIosHint", () => {
  it("shows on iOS Safari when not standalone and not dismissed", () => {
    expect(
      shouldShowIosHint({ isIosSafari: true, isStandalone: false, dismissed: false }),
    ).toBe(true);
  });

  it("hides when already running standalone (installed)", () => {
    expect(
      shouldShowIosHint({ isIosSafari: true, isStandalone: true, dismissed: false }),
    ).toBe(false);
  });

  it("hides after the worker dismisses it", () => {
    expect(
      shouldShowIosHint({ isIosSafari: true, isStandalone: false, dismissed: true }),
    ).toBe(false);
  });

  it("never shows off iOS Safari", () => {
    expect(
      shouldShowIosHint({ isIosSafari: false, isStandalone: false, dismissed: false }),
    ).toBe(false);
  });
});
