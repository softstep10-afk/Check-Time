export default function SettingsLoading() {
  const pulse = "animate-pulse rounded-[var(--radius-md)] bg-[var(--bg-surface-raised)]";
  return (
    <div className="mx-auto max-w-[1200px] space-y-5 p-5">
      <section className="space-y-2">
        <div className={`${pulse} h-3 w-28`} />
        <div className={`${pulse} h-8 w-48`} />
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${pulse} h-[140px]`} />
        ))}
      </section>
    </div>
  );
}
