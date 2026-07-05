"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldCheck, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
  canConfirmSafetyBrief,
  DEFAULT_SAFETY_RULE_KEYS,
  SAFETY_REFERENCE_KEYS,
} from "@/lib/safety-acknowledgements";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Fullscreen jobsite Safety Brief — pre-shift acknowledgement screen.
 *
 * Worker reads the rule list + Washington construction safety references,
 * ticks "I have read and understand today's safety rules", then taps
 * Confirm. The actual ack write + clockIn happen in the parent — this
 * component is presentational, with one ack-saving busy state passed in
 * so the Confirm button shows progress while the parent writes the row.
 */
export function SafetyBriefModal({
  open,
  projectName,
  workerName,
  ruleKeys,
  busy = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  projectName: string;
  workerName?: string | null;
  /** Optional override; defaults to DEFAULT_SAFETY_RULE_KEYS. */
  ruleKeys?: TranslationKey[];
  /** True while the parent is writing the ack row. Disables Confirm. */
  busy?: boolean;
  /**
   * When set, the parent's last ack-write attempt failed. The modal
   * stays open with this message rendered above the Confirm button so
   * the worker can read the failure reason and retry. clockIn must
   * NOT have run if errorMessage is set.
   */
  errorMessage?: string | null;
  onConfirm: (signedName: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const [signedName, setSignedName] = useState("");

  // Reset the local acknowledgement state every time the screen re-opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAcknowledged(false);
    setSignedName("");
  }, [open]);

  // ESC = cancel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, busy]);

  // Lock body scroll while the brief is open so the underlying project
  // page doesn't scroll behind a fullscreen overlay on mobile.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const todayLabel = useMemo(() => {
    if (!open) return "";
    return new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hourCycle: "h23",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [open]);

  if (!open) return null;
  // SSR safety — `"use client"` boundary still server-renders the initial
  // tree, but because `open` starts false the early return above guards
  // that path. Once we reach here we are in the browser.
  if (typeof document === "undefined") return null;

  const rules = ruleKeys ?? DEFAULT_SAFETY_RULE_KEYS;
  const canConfirm = canConfirmSafetyBrief(acknowledged, signedName) && !busy;
  const normalizedSignedName = signedName.trim();

  // Render through a portal directly to <body> so the brief never gets
  // containing-block trapped by an ancestor's transform / filter /
  // contain — which is what was making `fixed inset-0` collapse to the
  // worker shell's 500px column on production and leaving the brief
  // looking like the old small modal.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: "var(--bg-primary)", height: "100dvh" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-brief-title"
    >
      <header
        className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
      >
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="shrink-0 text-[var(--brand-yellow)]" />
          <h1
            id="safety-brief-title"
            className="text-base font-bold leading-tight text-[var(--text-primary)] sm:text-lg"
          >
            {t("safety.briefTitle")}
          </h1>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label={t("safety.closeCta")}
          title={t("safety.closeCta")}
          className="-mr-2 inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] disabled:opacity-50"
        >
          <X size={18} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[640px] space-y-5">
          <p className="text-sm text-[var(--text-secondary)]">
            {t("safety.briefSubtitle")}
          </p>

          <section
            className="rounded-[var(--radius-md)] border p-3 text-xs sm:text-sm"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {t("safety.projectLabel")}
              </dt>
              <dd className="font-semibold text-[var(--text-primary)]">{projectName}</dd>
              {workerName ? (
                <>
                  <dt className="font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {t("safety.workerLabel")}
                  </dt>
                  <dd className="text-[var(--text-primary)]">{workerName}</dd>
                </>
              ) : null}
              <dt className="font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                {t("safety.dateTimeLabel")}
              </dt>
              <dd className="text-[var(--text-primary)]">{todayLabel}</dd>
            </dl>
          </section>

          <section
            className="rounded-[var(--radius-md)] border p-3 text-xs leading-5 sm:text-sm sm:leading-6"
            style={{
              borderColor: "rgba(245, 158, 11, 0.35)",
              background: "rgba(245, 158, 11, 0.08)",
              color: "var(--text-primary)",
            }}
          >
            <div className="font-semibold">{t("safety.disclaimerTitle")}</div>
            <p className="mt-1 text-[var(--text-secondary)]">{t("safety.disclaimerBody")}</p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {t("safety.rulesTitle")}
            </h2>
            <ol className="mt-2 space-y-2">
              {rules.map((ruleKey, index) => (
                <li
                  key={ruleKey}
                  className="flex items-start gap-3 rounded-[var(--radius-md)] bg-[var(--bg-card)] px-3 py-2.5 text-sm text-[var(--text-primary)]"
                  style={{ border: "1px solid var(--border-default)" }}
                >
                  <span
                    aria-hidden
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                  >
                    {index + 1}
                  </span>
                  <span className="leading-5">{t(ruleKey)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              {t("safety.referencesTitle")}
            </h2>
            <ul
              className="mt-2 space-y-1.5 rounded-[var(--radius-md)] border px-3 py-3 text-xs leading-5 text-[var(--text-secondary)]"
              style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
            >
              {SAFETY_REFERENCE_KEYS.map((refKey) => (
                <li key={refKey} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--text-muted)]"
                  />
                  <span>{t(refKey)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section
            className="rounded-[var(--radius-md)] border p-3 text-sm leading-5 sm:leading-6"
            style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
          >
            <p className="text-[var(--text-secondary)]">{t("safety.acknowledgementStatement")}</p>
            <label className="mt-3 flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm font-semibold text-[var(--text-primary)]"
              style={{ borderColor: "var(--brand-yellow)", background: "rgba(191, 162, 52, 0.08)" }}
            >
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                disabled={busy}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand-yellow)]"
              />
              <span className="leading-5">{t("safety.checkboxLabel")}</span>
            </label>
            <label className="mt-3 block text-sm font-semibold text-[var(--text-primary)]">
              {t("safety.signatureLabel")}
              <input
                type="text"
                value={signedName}
                onInput={(event) => setSignedName(event.currentTarget.value)}
                disabled={busy}
                autoComplete="name"
                placeholder={workerName?.trim() || t("safety.signaturePlaceholder")}
                className="mt-2 w-full rounded-[var(--radius-sm)] border px-3 py-3 text-base text-[var(--text-primary)] outline-none disabled:opacity-50"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-primary)",
                }}
              />
            </label>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
              {t("safety.signatureHint")}
            </p>
          </section>
        </div>
      </main>

      <footer
        className="flex flex-col gap-2 border-t px-4 py-3 sm:px-6"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-card)" }}
      >
        {errorMessage ? (
          <div
            role="alert"
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold sm:text-sm"
            style={{
              borderColor: "rgba(212, 81, 94, 0.4)",
              background: "rgba(212, 81, 94, 0.08)",
              color: "var(--red)",
            }}
          >
            {t("safety.saveFailed")}: {errorMessage}
          </div>
        ) : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-[var(--radius-sm)] border px-4 py-3 text-sm font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
        >
          {t("safety.cancelCta")}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(normalizedSignedName)}
          disabled={!canConfirm}
          className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold disabled:opacity-50"
          style={{
            background: canConfirm ? "#f59e0b" : "var(--border-default)",
            color: canConfirm ? "var(--text-inverse)" : "var(--text-muted)",
          }}
        >
          {busy ? t("safety.savingCta") : t("safety.confirmCta")}
        </button>
        </div>
      </footer>
    </div>,
    document.body,
  );
}
