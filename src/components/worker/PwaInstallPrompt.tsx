"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  PWA_INSTALLED_KEY,
  PWA_INSTALL_DISMISSED_AT_KEY,
  PWA_IOS_HINT_DISMISSED_KEY,
  isIosSafari,
  shouldShowAndroidInstall,
  shouldShowIosHint,
} from "@/lib/pwa-install";

// Chrome/Android fires this before offering the native install mini-infobar.
// It isn't in lib.dom yet, so declare the minimal shape we use.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches === true;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mm || iosStandalone;
}

function readAndroidState() {
  const installed = localStorage.getItem(PWA_INSTALLED_KEY) === "true";
  const raw = localStorage.getItem(PWA_INSTALL_DISMISSED_AT_KEY);
  const parsed = raw == null ? null : Number(raw);
  const dismissedAt = parsed != null && Number.isFinite(parsed) ? parsed : null;
  return { installed, dismissedAt };
}

/**
 * Worker-only install affordance (PWA Task 1). Mounted inside WorkerShell, so it
 * only renders for a logged-in crew member. No service worker / caching — this
 * is install UX only:
 *  - Android/Chrome: captures `beforeinstallprompt`, shows an "Install app"
 *    action, calls prompt() on tap, respects userChoice (hide forever on accept,
 *    throttle on dismiss), and listens for `appinstalled`.
 *  - iOS Safari: shows a short manual "Add to Home Screen" hint (dismissible).
 * All state persists in localStorage.
 */
export function PwaInstallPrompt() {
  const { t } = useTranslation();
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showAndroid, setShowAndroid] = useState(false);
  const [showIos, setShowIos] = useState(false);

  // Android install-prompt capture + appinstalled.
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleBeforeInstall(event: Event) {
      // Suppress Chrome's default mini-infobar so we can offer our own action.
      event.preventDefault();
      if (isStandaloneDisplay()) return;
      if (!shouldShowAndroidInstall(readAndroidState(), Date.now())) return;
      setInstallEvent(event as BeforeInstallPromptEvent);
      setShowAndroid(true);
    }

    function handleInstalled() {
      // Fired whether install came from our action or the browser's own UI.
      localStorage.setItem(PWA_INSTALLED_KEY, "true");
      setShowAndroid(false);
      setShowIos(false);
      setInstallEvent(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  // iOS Safari manual hint (no beforeinstallprompt on iOS).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneDisplay()) return;
    const iosSafari = isIosSafari(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    const dismissed = localStorage.getItem(PWA_IOS_HINT_DISMISSED_KEY) === "true";
    setShowIos(
      shouldShowIosHint({ isIosSafari: iosSafari, isStandalone: false, dismissed }),
    );
  }, []);

  const handleInstallTap = useCallback(async () => {
    if (!installEvent) return;
    setShowAndroid(false);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        localStorage.setItem(PWA_INSTALLED_KEY, "true");
      } else {
        localStorage.setItem(PWA_INSTALL_DISMISSED_AT_KEY, String(Date.now()));
      }
    } catch {
      // If prompt() throws (already consumed / unsupported), throttle so we
      // don't loop the worker on a broken affordance.
      localStorage.setItem(PWA_INSTALL_DISMISSED_AT_KEY, String(Date.now()));
    } finally {
      setInstallEvent(null);
    }
  }, [installEvent]);

  const handleAndroidDismiss = useCallback(() => {
    localStorage.setItem(PWA_INSTALL_DISMISSED_AT_KEY, String(Date.now()));
    setShowAndroid(false);
    setInstallEvent(null);
  }, []);

  const handleIosDismiss = useCallback(() => {
    localStorage.setItem(PWA_IOS_HINT_DISMISSED_KEY, "true");
    setShowIos(false);
  }, []);

  if (showAndroid && installEvent) {
    return (
      <div
        className="mt-3 rounded-[var(--radius-md)] border px-3 py-3"
        style={{
          background: "rgba(191, 162, 52, 0.1)",
          borderColor: "rgba(191, 162, 52, 0.24)",
        }}
        role="region"
        aria-label={t("pwa.installTitle")}
      >
        <p className="text-sm font-bold text-[var(--brand-yellow)]">
          {t("pwa.installTitle")}
        </p>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{t("pwa.installBody")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleInstallTap}
            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
            style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
          >
            {t("pwa.installAction")}
          </button>
          <button
            type="button"
            onClick={handleAndroidDismiss}
            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {t("pwa.installLater")}
          </button>
        </div>
      </div>
    );
  }

  if (showIos) {
    return (
      <div
        className="mt-3 flex items-start justify-between gap-3 rounded-[var(--radius-md)] px-3 py-3"
        style={{ background: "rgba(59, 130, 246, 0.1)", color: "var(--blue)" }}
        role="region"
        aria-label={t("pwa.installTitle")}
      >
        <div className="min-w-0">
          <p className="text-sm font-bold">{t("pwa.installTitle")}</p>
          <p className="mt-1 text-xs">{t("pwa.iosHintBody")}</p>
        </div>
        <button
          type="button"
          onClick={handleIosDismiss}
          className="shrink-0 border-none bg-transparent p-0 text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "inherit" }}
        >
          {t("common.dismiss")}
        </button>
      </div>
    );
  }

  return null;
}
