"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import {
  dismissPrompt,
  getCurrentSubscription,
  getNotificationPermission,
  isPromptDismissed,
  isPushConfigured,
  isPushOptedOut,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-client";

// Push notifications Phase 1 — worker-side subscribe UI. Mounted once in
// WorkerShell. Shows a small, one-time-dismissible prompt when permission is
// undecided, plus a persistent "Push-уведомления" toggle (the settings control).
// Respects a per-device opt-out; permission-denied is quiet (no repeats).

type UiState = {
  supported: boolean;
  configured: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  optedOut: boolean;
  promptDismissed: boolean;
};

export function PushNotifications() {
  const { t } = useTranslation();
  // null until resolved on the client, so SSR and first paint render nothing
  // (no hydration mismatch) — the state is set asynchronously after mount.
  const [ui, setUi] = useState<UiState | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supported = isPushSupported();
      const subscription = supported ? await getCurrentSubscription() : null;
      if (!alive) return;
      setUi({
        supported,
        configured: isPushConfigured(),
        permission: getNotificationPermission(),
        subscribed: Boolean(subscription),
        optedOut: isPushOptedOut(),
        promptDismissed: isPromptDismissed(),
      });
    })();
    return () => {
      alive = false;
    };
  }, [refresh]);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  const handleEnable = useCallback(async () => {
    setBusy(true);
    await subscribeToPush();
    setBusy(false);
    reload();
  }, [reload]);

  const handleDisable = useCallback(async () => {
    setBusy(true);
    await unsubscribeFromPush();
    setBusy(false);
    reload();
  }, [reload]);

  const handleDismissPrompt = useCallback(() => {
    dismissPrompt();
    reload();
  }, [reload]);

  // Nothing to show until resolved, or when the platform/deploy has no push.
  if (!ui || !ui.supported || !ui.configured) return null;

  const showPrompt =
    ui.permission === "default" && !ui.optedOut && !ui.promptDismissed && !ui.subscribed;
  const isOn = ui.subscribed && ui.permission === "granted";

  return (
    <>
      {showPrompt ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm"
          style={{ background: "rgba(105, 231, 255, 0.08)", borderColor: "rgba(105, 231, 255, 0.22)" }}
          role="status"
        >
          <span className="min-w-0">{t("push.promptBody")}</span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleEnable}
              className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              {t("push.enable")}
            </button>
            <button
              type="button"
              onClick={handleDismissPrompt}
              className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {t("push.notNow")}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="mt-2 flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm"
        style={{ background: "rgba(15, 17, 23, 0.35)" }}
      >
        <span className="min-w-0">
          {t("push.settingLabel")}
          {ui.permission === "denied" ? (
            <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">
              {t("push.deniedHint")}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          disabled={busy || ui.permission === "denied"}
          onClick={isOn ? handleDisable : handleEnable}
          aria-pressed={isOn}
          className="shrink-0 rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.1em]"
          style={{
            background: isOn ? "rgba(15, 168, 120, 0.16)" : "rgba(107, 114, 128, 0.18)",
            color: isOn ? "var(--green)" : "var(--text-muted)",
            opacity: ui.permission === "denied" ? 0.6 : 1,
          }}
        >
          {isOn ? t("push.on") : t("push.off")}
        </button>
      </div>
    </>
  );
}
