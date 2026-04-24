import { redirect } from "next/navigation";
import { TeamMemberPage } from "@/components/manager/TeamMemberPage";
import { getTeamPageData } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
} from "@/lib/manager-utils";
import type { Media } from "@/types/database";

export const revalidate = 30;

export default async function TeamMemberRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTeamPageData();
  const sessions = buildManagerSessions(data);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const projectSummaries = buildProjectSummaries(data, sessions);
  const profile = profileSummaries.find((item) => item.id === id);

  if (!profile) {
    // Soft redirect instead of 404 so clicking a stale worker link
    // just sends the manager back to the roster rather than hitting
    // Next's default not-found shell.
    redirect("/team");
  }

  const assignments = data.assignments.filter((assignment) => assignment.profile_id === id);
  const tasks = data.tasks.filter((task) => task.assigned_to === id && !task.deleted_at).slice(0, 20);
  const workerSessions = sessions.filter((session) => session.profileId === id).slice(0, 20);

  // Closed store visits in the last 7 days, newest first.
  // Date.now() is fine here — server component, runs once per request.
  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const workerStoreVisits = data.storeVisits
    .filter(
      (visit) =>
        visit.worker_id === id &&
        Boolean(visit.exited_at) &&
        new Date(visit.entered_at).getTime() >= sevenDaysAgo,
    )
    .slice(0, 20);

  // Worker's recent journal entries (newest first), enriched with project name.
  // getTeamPageData skips media on purpose — query just this worker's rows
  // inline so the detail page still renders the journal without a broad
  // org-wide fetch.
  const projectsById = new Map(data.projects.map((p) => [p.id, p.name]));
  const supabase = await createClient();
  const { data: workerMediaRows } = await supabase
    .from("media")
    .select("*")
    .eq("uploaded_by", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<Media[]>();
  const workerMedia = (workerMediaRows ?? []).map((m) => ({
    ...m,
    projectName: m.project_id ? projectsById.get(m.project_id) ?? null : null,
  }));

  return (
    <TeamMemberPage
      orgId={data.manager.org_id}
      managerId={data.manager.id}
      profile={profile}
      projects={projectSummaries}
      assignments={assignments}
      tasks={tasks}
      sessions={workerSessions}
      storeVisits={workerStoreVisits}
      media={workerMedia}
    />
  );
}
