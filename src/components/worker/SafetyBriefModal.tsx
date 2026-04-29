"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  DEFAULT_SAFETY_RULE_KEYS,
} from "@/lib/safety-acknowledgements";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Pre-shift safety brief. Worker reads the rule list, ticks "I have read
 * and understand", then taps confirm. The actual ack write + clockIn
 * happen in the parent — this component is presentational and resets its
 * checkbox state every time it opens.
 */
export function SafetyBriefModal({
  open,
  projectName,
  ruleKeys,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  projectName: string;
  /** Optional override; defaults to DEFAULT_SAFETY_RULE_KEYS. */
  ruleKeys?: TranslationKey[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset the checkbox every time the modal re-opens so a previous
  // confirm doesn't pre-tick the new prompt.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  // ESC = cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const rules = ruleKeys ?? DEFAULT_SAFETY_RULE_KEYS;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[480px] rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-[var(--brand-yellow)]" />
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("safety.briefTitle").replace("{project}", projectName)}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("safety.briefIntro")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("safety.cancelCta")}
            title={t("safety.cancelCta")}
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {rules.map((ruleKey) => (
            <li
              key={ruleKey}
              className="flex items-start gap-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-secondary)]"
            >
              <span
                aria-hidden
                className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: "var(--brand-yellow)" }}
              />
              <span>{t(ruleKey)}</span>
            </li>
          ))}
        </ul>

        <label className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-3 text-sm text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[var(--brand-yellow)]"
          />
          <span>{t("safety.checkboxLabel")}</span>
        </label>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
          >
            {t("safety.cancelCta")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged}
            className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{
              background: acknowledged ? "#f59e0b" : "var(--border-default)",
              color: acknowledged ? "var(--text-inverse)" : "var(--text-muted)",
            }}
          >
            {t("safety.confirmCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
