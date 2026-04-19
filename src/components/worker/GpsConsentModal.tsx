"use client";

import { useState } from "react";
import { MapPin } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function GpsConsentModal({
  workerName,
  onAccept,
  onDecline,
}: {
  workerName: string;
  onAccept: (signedName: string) => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [signedName, setSignedName] = useState("");

  const canConfirm = agreed && signedName.trim().length >= 2;

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

        <label className="mt-4 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
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
            placeholder={workerName}
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => onAccept(signedName.trim())}
            disabled={!canConfirm}
            className="flex-1 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold"
            style={{
              background: canConfirm ? "var(--brand-yellow)" : "var(--border-default)",
              color: canConfirm ? "var(--text-inverse)" : "var(--text-muted)",
            }}
          >
            {t("gps.consentConfirm")}
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="flex-1 rounded-[var(--radius-md)] border px-4 py-3 text-sm font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            {t("gps.consentDecline")}
          </button>
        </div>
      </div>
    </div>
  );
}
