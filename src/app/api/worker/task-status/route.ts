import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Task, TaskStatus } from "@/types/database";

const TASK_STATUSES = new Set<TaskStatus>(["pending", "in_progress", "done", "cancelled"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : null;
}

function readTaskStatus(value: unknown): TaskStatus | null {
  return typeof value === "string" && TASK_STATUSES.has(value as TaskStatus)
    ? (value as TaskStatus)
    : null;
}

function readIsoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : trimmed;
}

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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, org_id, name, role")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "id" | "org_id" | "name" | "role">>();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const taskId = readRequiredUuid(body.taskId, "task id");
    if (!taskId.ok) {
      return NextResponse.json({ error: taskId.error }, { status: taskId.status });
    }
    const nextStatus = readTaskStatus(body.nextStatus);
    if (!nextStatus) {
      return NextResponse.json({ error: "Invalid task status." }, { status: 400 });
    }
    const updatePayload = asRecord(body.updatePayload) ?? {};

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Task update is temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id, org_id, project_id, assigned_to, deleted_at, status, completed_at, metadata")
      .eq("id", taskId.value)
      .eq("org_id", profile.org_id)
      .maybeSingle<
        Pick<
          Task,
          | "id"
          | "org_id"
          | "project_id"
          | "assigned_to"
          | "deleted_at"
          | "status"
          | "completed_at"
          | "metadata"
        >
      >();
    if (taskError || !task) {
      return NextResponse.json(
        { error: taskError?.message ?? "Task not found." },
        { status: 404 },
      );
    }
    if (task.deleted_at) {
      return NextResponse.json({ error: "Task has been deleted." }, { status: 410 });
    }
    if (task.assigned_to !== profile.id) {
      return NextResponse.json({ error: "Task is assigned to another person." }, { status: 403 });
    }

    const patch: Record<string, unknown> = {
      status: nextStatus,
      completed_at:
        nextStatus === "done"
          ? readIsoOrNull(updatePayload.completed_at) ?? new Date().toISOString()
          : null,
      completed_by: nextStatus === "done" ? profile.id : null,
    };
    const metadata = asRecord(updatePayload.metadata);
    if (metadata) {
      patch.metadata = {
        ...metadata,
        ...(nextStatus === "done" ? { completed_by_recorded: profile.id } : {}),
      };
    }

    const { data: updated, error: updateError } = await admin
      .from("tasks")
      .update(patch)
      .eq("id", task.id)
      .eq("org_id", profile.org_id)
      .eq("assigned_to", profile.id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle<Task>();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json(
        { error: "Task is no longer assigned to this worker." },
        { status: 409 },
      );
    }

    revalidatePath("/my-tasks");
    revalidatePath("/my-projects");
    revalidatePath("/tasks");
    if (updated.project_id) {
      revalidatePath(`/project/${updated.project_id}`);
      revalidatePath(`/projects/${updated.project_id}`);
    }
    revalidatePath(`/team/${profile.id}`);

    return NextResponse.json({ ok: true, task: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
