export default function ProjectsLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-28`} />
        <div className={`${pulse} h-8 w-56`} />
        <div className={`${pulse} h-3 w-80`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <article key={i} className="surface-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className={`${pulse} h-4 w-40`} />
                <div className={`${pulse} h-3 w-56`} />
              </div>
              <div className={`${pulse} h-5 w-16 rounded-full`} />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className={`${pulse} h-[52px]`} />
              ))}
            </div>
            <div className={`${pulse} h-3 w-2/3`} />
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className={`${pulse} h-8 w-20`} />
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
