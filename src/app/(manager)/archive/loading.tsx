export default function ArchiveLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-28`} />
        <div className={`${pulse} h-8 w-56`} />
      </section>
      <section className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${pulse} h-16`} />
        ))}
      </section>
    </div>
  );
}
