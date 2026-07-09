import type { SupabaseClient } from "@supabase/supabase-js";

// Step 3 — shared worker project-access predicate (external-audit HIGH-E #6).
//
// Lifted VERBATIM from the logic claim-task / project-tasks / project-notes /
// material-orders already apply, so a worker cannot act on a project they can't
// see:
//   • 'list'       → requires a project_assignments row for (project, worker).
//   • 'all_active' → the project must be ACTIVE and have no project_exclusions
//                    row for (project, worker). An exclusion READ error fails
//                    OPEN (allowed) — matching the existing routes exactly.
//
// The client is passed in (admin or user-scoped) so each caller keeps the exact
// client — and therefore the exact RLS channel — it used before. This decides
// access only; callers keep their own project-not-found / archived responses.

export type WorkerProjectAccessMode = "list" | "all_active";

export async function assertWorkerCanAccessProject(
  client: SupabaseClient,
  params: {
    workerId: string;
    orgId: string;
    projectId: string;
    accessMode: WorkerProjectAccessMode;
  },
): Promise<boolean> {
  const { workerId, orgId, projectId, accessMode } = params;

  if (accessMode === "list") {
    const { data: assignment } = await client
      .from("project_assignments")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("profile_id", workerId)
      .maybeSingle();
    return Boolean(assignment);
  }

  // all_active: only an ACTIVE project the worker is not excluded from.
  const { data: project } = await client
    .from("projects")
    .select("status")
    .eq("id", projectId)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .maybeSingle<{ status: string }>();
  if (!project || project.status !== "active") return false;

  const { data: exclusion, error: exclusionError } = await client
    .from("project_exclusions")
    .select("id")
    .eq("project_id", projectId)
    .eq("profile_id", workerId)
    .maybeSingle();
  return exclusionError ? true : !exclusion;
}
