"use client";

import { useEffect } from "react";

export default function WorkerError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error("[worker] route render failed", error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen max-w-[500px] flex-col border-x border-[var(--border-subtle)]">
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <section
            className="w-full rounded-[var(--radius-lg)] border p-6 text-center shadow-sm"
            style={{
              borderColor: "rgba(212, 81, 94, 0.35)",
              background: "var(--bg-card)",
            }}
          >
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--accent-primary)]/15 text-lg font-semibold text-[var(--accent-primary)]">
              CT
            </div>
            <h1 className="text-xl font-semibold">Не удалось открыть рабочий экран</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Проверьте связь и обновите экран.
            </p>
            {error.digest ? (
              <p className="mt-3 break-all text-xs text-[var(--text-muted)]">
                Код ошибки: {error.digest}
              </p>
            ) : null}
            <button
              type="button"
              onClick={retry}
              className="button-base button-primary mt-4 w-full px-4 py-3 text-sm"
            >
              Обновить
            </button>
          </section>
        </main>
      </div>
    </div>
  );
}
