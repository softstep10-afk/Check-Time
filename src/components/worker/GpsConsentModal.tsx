"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { canConfirmGpsConsent } from "@/lib/gps-consent-ui";

export function GpsConsentModal({
  workerName,
  onAccept,
  onDecline,
}: {
  workerName: string;
  onAccept: (signedName: string) => void | Promise<void>;
  onDecline: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [busyAction, setBusyAction] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");

  const canConfirm = canConfirmGpsConsent(agreed, signedName);

  async function handleAccept() {
    if (!canConfirm || busyAction) return;
    setBusyAction("accept");
    setError("");
    try {
      await onAccept(signedName.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gps.consentSaveFailed"));
      setBusyAction(null);
    }
  }

  async function handleDecline() {
    if (busyAction) return;
    setBusyAction("decline");
    setError("");
    try {
      await onDecline();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gps.consentSaveFailed"));
      setBusyAction(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="w-full max-w-[420px] rounded-[16px] p-6"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "rgba(59, 130, 246, 0.14)" }}
          >
            <MapPin size={20} className="text-[var(--blue)]" />
          </div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("gps.consentTitle")}
          </h2>
        </div>

        <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">
          {t("gps.consentBody")}
        </p>

        <p className="mt-3 text-sm font-medium leading-6 text-[var(--text-primary)]">
          {t("gps.consentClarification")}
        </p>

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={Boolean(busyAction)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="text-sm text-[var(--text-primary)]">
            {t("gps.consentAgree")}
          </span>
        </label>

        <div className="mt-4">
          <label className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {t("gps.consentSignature")}
          </label>
          <input
            type="text"
            value={signedName}
            onChange={(e) => setSignedName(e.target.value)}
            onInput={(e) => setSignedName(e.currentTarget.value)}
            placeholder={workerName}
            disabled={Boolean(busyAction)}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        </div>

        {error ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-[var(--red)]">
            {t("gps.consentSaveFailed")}: {error}
          </div>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => void handleAccept()}
            disabled={!canConfirm || Boolean(busyAction)}
            className="flex-1 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold"
            style={{
              background: canConfirm && !busyAction ? "var(--brand-yellow)" : "var(--border-default)",
              color: canConfirm && !busyAction ? "var(--text-inverse)" : "var(--text-muted)",
            }}
          >
            {busyAction === "accept" ? t("common.saving") : t("gps.consentConfirm")}
          </button>
          <button
            type="button"
            onClick={() => void handleDecline()}
            disabled={Boolean(busyAction)}
            className="flex-1 rounded-[var(--radius-md)] border px-4 py-3 text-sm font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {busyAction === "decline" ? t("common.saving") : t("gps.consentDecline")}
          </button>
        </div>
      </div>
    </div>
  );
}
