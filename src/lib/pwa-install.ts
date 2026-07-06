// Pure logic + localStorage keys for the PWA install prompt (Task 1).
//
// This module holds ONLY framework-free helpers so the show/hide decisions can
// be unit-tested without a DOM. The React component in
// `src/components/worker/PwaInstallPrompt.tsx` wires these to real
// `beforeinstallprompt` / `appinstalled` events and localStorage.
//
// No service worker, no caching — install UX only.

// localStorage keys. `cc_` prefix matches the app's other offline keys
// (cc_offline_time_events, cc_offline_uploads, …).
export const PWA_INSTALLED_KEY = "cc_pwa_installed";
export const PWA_INSTALL_DISMISSED_AT_KEY = "cc_pwa_install_dismissed_at";
export const PWA_IOS_HINT_DISMISSED_KEY = "cc_pwa_ios_hint_dismissed";

// After a worker dismisses the Android install action, wait this long before
// offering it again. Accepting hides it permanently; only a dismissal throttles.
export const ANDROID_DISMISS_THROTTLE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export type AndroidInstallState = {
  /** True once the app was accepted/installed — hide the action forever. */
  installed: boolean;
  /** Epoch ms of the last dismissal, or null if never dismissed. */
  dismissedAt: number | null;
};

/**
 * Whether the Android "Install app" action should be shown, given the stored
 * state and the current time. A captured `beforeinstallprompt` event is a
 * separate precondition handled by the component — this only encodes the
 * installed/throttle policy.
 */
export function shouldShowAndroidInstall(state: AndroidInstallState, now: number): boolean {
  if (state.installed) return false;
  if (state.dismissedAt == null) return true;
  return now - state.dismissedAt >= ANDROID_DISMISS_THROTTLE_MS;
}

/**
 * iOS Safari detection. iPadOS 13+ masquerades as "Macintosh", so a touch-capable
 * Mac user agent is treated as iPad. In-app browsers (Chrome/Firefox/Edge/Opera
 * on iOS) don't expose the Share → Add to Home Screen flow the same way, so they
 * are excluded — the hint would be misleading there.
 */
export function isIosSafari(userAgent: string, maxTouchPoints: number): boolean {
  const isIPhoneIPod = /iPad|iPhone|iPod/.test(userAgent);
  const isIPadOS = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (!isIPhoneIPod && !isIPadOS) return false;
  const isSafari = /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(userAgent);
  return isSafari;
}

/**
 * Whether the iOS manual "Add to Home Screen" hint should be shown. Only on iOS
 * Safari, only when not already running as an installed standalone app, and only
 * if the worker hasn't dismissed it before.
 */
export function shouldShowIosHint(opts: {
  isIosSafari: boolean;
  isStandalone: boolean;
  dismissed: boolean;
}): boolean {
  return opts.isIosSafari && !opts.isStandalone && !opts.dismissed;
}
