import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEffectiveOpenTask } from "@/lib/task-status";
import type { Task } from "@/types/database";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * POST /api/worker/claim-task
 *
 * Body: { taskId: string }
 *
 * Lets a worker take ownership of an unassigned project-level task. The
 * write goes through the service-role admin client because the tasks
 * UPDATE policy is manager-scoped and a worker-client UPDATE silently
 * affects zero rows under RLS — same rationale that drives
 * /api/worker/link-checkout-video.
 *
 * Predicates re-asserted at the UPDATE so a TOCTOU race (two workers
 * tapping Claim at the same instant) cannot widen the blast radius:
 *   • assigned_to IS NULL  → the second writer's update sees zero rows.
 *   • project_id matches the task we read.
 *   • org_id matches the caller's org.
 *   • deleted_at IS NULL.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { taskId?: unknown } | null;
    const taskId = typeof body?.taskId === "string" ? body.taskId : "";
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, org_id, role, project_access_mode")
      .eq("id", user.id)
      .maybeSingle<{
        id: string;
        org_id: string;
        role: string;
        project_access_mode: "list" | "all_active" | null;
      }>();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    // Read the task through the user-scoped client first so RLS gates
    // visibility before we use the admin client. A worker who can't see
    // the task can't claim it.
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, project_id, assigned_to, org_id, status, completed_at, deleted_at, metadata")
      .eq("id", taskId)
      .maybeSingle<{
        id: string;
        project_id: string | null;
        assigned_to: string | null;
        org_id: string;
        status: Task["status"];
        completed_at: string | null;
        deleted_at: string | null;
        metadata: Record<string, unknown> | null;
      }>();
    if (taskError || !task) {
      return NextResponse.json(
        { error: taskError?.message ?? "Task not found." },
        { status: 404 },
      );
    }

    if (task.deleted_at) {
      return NextResponse.json({ error: "Task has been deleted." }, { status: 410 });
    }
    if (!isEffectiveOpenTask(task)) {
      return NextResponse.json({ error: "Task is already closed." }, { status: 409 });
    }
    if (task.assigned_to !== null) {
      return NextResponse.json(
        { error: "Task is already assigned." },
        { status: 409 },
      );
    }
    if (!task.project_id) {
      return NextResponse.json(
        { error: "Common (no-project) tasks cannot be claimed here." },
        { status: 400 },
      );
    }
    if (task.org_id !== profile.org_id) {
      return NextResponse.json({ error: "Org mismatch." }, { status: 403 });
    }

    const { data: taskProject } = await supabase
      .from("projects")
      .select("id, status")
      .eq("id", task.project_id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; status: string }>();
    if (!taskProject || taskProject.status === "archived") {
      return NextResponse.json(
        { error: "Project is not available to this worker." },
        { status: 403 },
      );
    }

    // Reuse the same project-access predicate the worker project page
    // and project-tasks POST route apply: 'list' mode requires an
    // assignment row, 'all_active' mode requires no exclusion against
    // an active project. Keeps a worker from claiming tasks on
    // projects they can't see.
    const accessMode = profile.project_access_mode === "all_active" ? "all_active" : "list";
    let allowed = false;
    if (accessMode === "list") {
      const { data: assignment } = await supabase
        .from("project_assignments")
        .select("project_id")
        .eq("project_id", task.project_id)
        .eq("profile_id", user.id)
        .maybeSingle();
      allowed = Boolean(assignment);
    } else {
      if (taskProject.status === "active") {
        const { data: exclusion, error: exclusionError } = await supabase
          .from("project_exclusions")
          .select("id")
          .eq("project_id", task.project_id)
          .eq("profile_id", user.id)
          .maybeSingle();
        allowed = exclusionError ? true : !exclusion;
      }
    }
    if (!allowed) {
      return NextResponse.json(
        { error: "Project is not available to this worker." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server admin client is not configured." },
        { status: 500 },
      );
    }

    const nextMetadata = {
      ...asRecord(task.metadata),
      claimed_from_unassigned: true,
      original_assigned_to: null,
      claimed_by: user.id,
      claimed_at: new Date().toISOString(),
    };

    const { data: updated, error: updateError } = await admin
      .from("tasks")
      .update({ assigned_to: user.id, metadata: nextMetadata })
      .eq("id", taskId)
      .is("assigned_to", null)
      .is("deleted_at", null)
      .eq("project_id", task.project_id)
      .eq("org_id", profile.org_id)
      .neq("status", "done")
      .is("completed_at", null)
      .select("*")
      .maybeSingle<Task>();

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 },
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: "Task is already assigned or closed." },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, task: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
