import { Suspense } from "react";
import { SettingsPage } from "@/components/manager/SettingsPage";
import { getDisplayOrgName } from "@/lib/brand";
import { getManagerWorkspaceData } from "@/lib/manager-data";

// The manager layout chrome paints immediately; the workspace query batch streams
// into this Suspense boundary. Data/computation unchanged — only delivery timing.
export default function SettingsRoutePage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsRouteContent />
    </Suspense>
  );
}

function SettingsSkeleton() {
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

async function SettingsRouteContent() {
  const data = await getManagerWorkspaceData();

  return (
    <SettingsPage
      orgId={data.org.id}
      orgName={getDisplayOrgName(data.org.name)}
      orgSlug={data.org.slug}
      managerName={data.manager.name}
      crewCount={data.profiles.length}
      activeProjectCount={data.projects.filter((project) => project.status === "active").length}
    />
  );
}
