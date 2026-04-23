export default function TimelineLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-24`} />
        <div className={`${pulse} h-8 w-48`} />
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`${pulse} h-9`} />
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 flex items-start justify-between gap-3"
          >
            <div className="space-y-2 flex-1">
              <div className={`${pulse} h-4 w-1/3`} />
              <div className={`${pulse} h-3 w-1/4`} />
            </div>
            <div className="space-y-2 text-right">
              <div className={`${pulse} h-3 w-28`} />
              <div className={`${pulse} h-3 w-20 ml-auto`} />
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
