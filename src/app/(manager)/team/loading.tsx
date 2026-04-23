export default function TeamLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-24`} />
        <div className={`${pulse} h-8 w-48`} />
      </section>

      <section className="surface-card p-4 space-y-3 overflow-x-auto">
        <div className="grid grid-cols-[40px_1.5fr_1fr_1fr_1fr_1fr_1fr] gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={`h-${i}`} className={`${pulse} h-3`} />
          ))}
          {Array.from({ length: 5 }).flatMap((_, row) => [
            <div key={`av-${row}`} className={`${pulse} h-8 w-8 rounded-full`} />,
            ...Array.from({ length: 6 }).map((__, col) => (
              <div key={`c-${row}-${col}`} className={`${pulse} h-4`} />
            )),
          ])}
        </div>
      </section>
    </div>
  );
}
