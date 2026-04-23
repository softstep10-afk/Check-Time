"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { AppMessage } from "@/lib/message-types";

export function MessageOverlay({
  message,
  onDismiss,
}: {
  message: AppMessage;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  // Buzz the phone when an urgent message surfaces. navigator.vibrate is
  // a progressive enhancement — Safari desktop + iOS lack it and that's
  // fine.
  useEffect(() => {
    if (message.priority !== "urgent") return;
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    try {
      navigator.vibrate([200]);
    } catch {
      // Ignore — some browsers reject vibrate without a user gesture.
    }
  }, [message.id, message.priority]);

  if (dismissed) return null;
  const isUrgent = message.priority === "urgent";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: `${message.color}18`, backdropFilter: "blur(6px)" }}
    >
      <div
        className={`w-full max-w-[400px] rounded-[16px] p-6 text-center shadow-2xl ${
          isUrgent ? "clock-pulse" : ""
        }`}
        style={{
          background: "var(--bg-surface)",
          border: `2px solid ${message.color}44`,
          borderLeftWidth: isUrgent ? 6 : 2,
          borderLeftColor: isUrgent ? message.color : `${message.color}44`,
        }}
      >
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: `${message.color}22` }}
        >
          <div
            className="h-4 w-4 rounded-full"
            style={{ background: message.color }}
          />
        </div>

        <div className="text-xs uppercase tracking-[0.14em]" style={{ color: message.color }}>
          {message.from_name}
        </div>

        <div className="mt-3 text-lg font-semibold text-[var(--text-primary)]">
          {message.text}
        </div>

        <button
          type="button"
          onClick={() => {
            setDismissed(true);
            onDismiss();
          }}
          className="mt-6 w-full rounded-[var(--radius-md)] px-6 py-3 text-sm font-semibold text-white"
          style={{ background: message.color }}
        >
          {t("messages.gotIt")}
        </button>
      </div>
    </div>
  );
}
