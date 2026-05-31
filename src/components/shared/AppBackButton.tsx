"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { resolveBackTarget } from "@/lib/nav-back";

/**
 * Global in-app back control.
 *
 * Mounted in the manager app shell (desktop sidebar header + mobile top bar),
 * so it never renders on /login (that route uses the auth layout, not the
 * manager layout). Navigation only: it does not mutate any data.
 *
 * Behaviour: pop real browser history when it exists, otherwise fall back to
 * the owner dashboard (see resolveBackTarget). Pure decision logic lives in
 * @/lib/nav-back so it stays unit-testable.
 */
export function AppBackButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const { t } = useTranslation();

  function handleBack() {
    const historyLength =
      typeof window !== "undefined" ? window.history.length : 0;
    const target = resolveBackTarget(historyLength);
    if (target.action === "history-back") {
      router.back();
    } else {
      router.push(target.path);
    }
  }

  return (
    <button
      type="button"
      onClick={handleBack}
      aria-label={t("nav.back")}
      title={t("nav.back")}
      className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[var(--brand-yellow)] hover:text-[var(--text-primary)] ${className}`}
    >
      <ChevronLeft size={15} />
      <span>{t("nav.back")}</span>
    </button>
  );
}
