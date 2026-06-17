export function WorkerBootFallback({
  title = "Загружаем рабочий экран",
  detail = "Подготавливаем смену и задачи. Экран появится автоматически.",
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="mx-auto flex min-h-screen max-w-[500px] flex-col border-x border-[var(--border-subtle)]">
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <section
            className="w-full rounded-[var(--radius-lg)] border p-5 text-center"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-card)",
            }}
            role="status"
            aria-live="polite"
          >
            <div
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)] border font-[var(--font-jarvis)] text-lg font-bold"
              style={{
                borderColor: "rgba(191, 162, 52, 0.45)",
                color: "var(--brand-yellow)",
                background: "rgba(191, 162, 52, 0.12)",
              }}
              aria-hidden
            >
              CT
            </div>
            <h1 className="mt-4 text-lg font-bold">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{detail}</p>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-primary)]">
              <div
                className="h-full w-1/2 animate-pulse rounded-full"
                style={{ background: "var(--brand-yellow)" }}
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
