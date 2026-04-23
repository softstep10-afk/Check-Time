export default function OverviewLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-28`} />
        <div className={`${pulse} h-8 w-64`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="surface-card p-4 space-y-2">
            <div className={`${pulse} h-3 w-20`} />
            <div className={`${pulse} h-7 w-24`} />
            <div className={`${pulse} h-3 w-28`} />
          </div>
        ))}
      </section>

      <section className="surface-card p-4 space-y-3">
        <div className={`${pulse} h-4 w-40`} />
        <div
          className={`${pulse} h-[220px] w-full md:h-[300px] flex items-center justify-center`}
          style={{ color: "var(--text-muted)" }}
        >
          <span className="text-xs font-semibold">Загрузка карты…</span>
        </div>
      </section>

      <section className="surface-card p-4 space-y-3">
        <div className={`${pulse} h-4 w-40`} />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`${pulse} h-8 w-8 rounded-full`} />
            <div className="flex-1 space-y-2">
              <div className={`${pulse} h-3 w-1/3`} />
              <div className={`${pulse} h-3 w-1/2`} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
