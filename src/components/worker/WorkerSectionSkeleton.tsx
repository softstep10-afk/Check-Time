export function WorkerSectionSkeleton({
  label = "Loading worker section",
}: {
  label?: string;
}) {
  return (
    <section className="space-y-3" role="status" aria-label={label} aria-live="polite">
      <div className="h-4 w-28 animate-pulse rounded bg-[var(--bg-card)]" />
      <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4">
        <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--bg-primary)]" />
        <div className="mt-3 h-3 w-full animate-pulse rounded bg-[var(--bg-primary)]" />
        <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-[var(--bg-primary)]" />
      </div>
    </section>
  );
}
