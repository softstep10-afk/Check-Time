export default function PayrollLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-24`} />
        <div className={`${pulse} h-8 w-56`} />
      </section>

      <section className="surface-card p-4 flex flex-wrap items-center gap-3">
        <div className={`${pulse} h-9 w-[160px]`} />
        <div className={`${pulse} h-9 w-[160px]`} />
        <div className={`${pulse} h-9 w-28`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="surface-card p-4 space-y-2">
            <div className={`${pulse} h-3 w-20`} />
            <div className={`${pulse} h-7 w-28`} />
            <div className={`${pulse} h-3 w-24`} />
          </div>
        ))}
      </section>

      <section className="surface-card p-4 space-y-3">
        <div className={`${pulse} h-4 w-40`} />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className={`${pulse} h-10 w-10 rounded-full`} />
            <div className="flex-1 space-y-2">
              <div className={`${pulse} h-3 w-1/3`} />
              <div className={`${pulse} h-3 w-1/2`} />
            </div>
            <div className={`${pulse} h-6 w-20`} />
          </div>
        ))}
      </section>
    </div>
  );
}
