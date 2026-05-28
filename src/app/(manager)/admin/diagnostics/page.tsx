import { redirect } from "next/navigation";
import { requireManagerContext } from "@/lib/manager-data";
import { getReleaseDiagnostics } from "@/lib/release-diagnostics";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDiagnosticsPage() {
  const supabase = await createClient();
  const { profile } = await requireManagerContext(supabase);
  if (profile.role !== "owner" && profile.role !== "admin") {
    redirect("/overview");
  }

  const diagnostics = getReleaseDiagnostics();
  const rows = [
    ["App version", diagnostics.appVersion],
    ["Commit SHA", diagnostics.commitSha],
    ["Short SHA", diagnostics.commitShort],
    ["Branch", diagnostics.branch],
    ["Build time", diagnostics.buildTime],
    ["Deploy environment", diagnostics.deployEnvironment],
    ["Deployment URL", diagnostics.vercelUrl ?? "unknown"],
    ["Node environment", diagnostics.nodeEnv],
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-yellow)]">
              Alpha-7 release diagnostics
            </p>
            <h1 className="mt-2 text-2xl font-bold text-[var(--text-primary)]">
              Production diagnostics
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
              Owner/admin-only release stamp. This page exposes commit and build metadata only; it does not expose secrets,
              tokens, service keys, payroll data, or production records.
            </p>
          </div>
          <span className="rounded-[var(--radius-pill)] border border-[rgba(191,162,52,0.35)] px-3 py-1 text-xs font-bold uppercase text-[var(--brand-yellow)]">
            owner/admin
          </span>
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="border-b border-[var(--border-subtle)] px-4 py-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">Build stamp</h2>
        </div>
        <div className="divide-y divide-[var(--border-subtle)]">
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[180px_1fr]">
              <div className="font-semibold text-[var(--text-secondary)]">{label}</div>
              <div className="break-all font-mono text-[var(--text-primary)]">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card p-4 text-sm text-[var(--text-secondary)]">
        <h2 className="text-base font-bold text-[var(--text-primary)]">Deploy discipline</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>Deploy only from clean git status after the Alpha-7 predeploy checks pass.</li>
          <li>Compare this commit SHA with the intended release commit before manual QA.</li>
          <li>Use rollback by Vercel deployment or alias only; do not run SQL as part of app rollback.</li>
        </ul>
      </section>
    </main>
  );
}
