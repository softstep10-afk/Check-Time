import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { canConfirmJarvisWriteAction } from "@/lib/role-permissions";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createManagerTask,
  TaskDispatchError,
} from "@/lib/server/task-dispatch";
import type { TaskPriority } from "@/types/database";

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPriority(value: unknown): TaskPriority {
  return value === "urgent" || value === "high" || value === "low" || value === "medium"
    ? value
    : "medium";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind !== "authenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { profile } = auth.context;
    if (!canConfirmJarvisWriteAction(profile.role)) {
      return NextResponse.json(
        { error: "Only owner/admin can confirm Jarvis task actions." },
        { status: 403 },
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Jarvis task creation is temporarily unavailable." },
        { status: 503 },
      );
    }

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    const task = await createManagerTask(adminClient, {
      orgId: profile.org_id,
      actor: profile,
      title: readText(body.title),
      description: readText(body.description) || null,
      projectId: readText(body.projectId) || null,
      assignedTo: readText(body.assignedTo) || null,
      priority: readPriority(body.priority),
      dueDate: readText(body.dueDate) || null,
      source: "jarvis_create_task",
      auditAction: "jarvis_task_created",
      metadata: {
        requested_by_jarvis: true,
        project_name: readText(body.projectName) || null,
        assigned_to_name: readText(body.assignedToName) || null,
      },
    });

    revalidatePath("/tasks");
    revalidatePath("/command-center");
    revalidatePath("/overview");
    revalidatePath("/my-tasks");
    if (task.project_id) {
      revalidatePath(`/projects/${task.project_id}`);
      revalidatePath(`/project/${task.project_id}`);
    }
    if (task.assigned_to) {
      revalidatePath(`/team/${task.assigned_to}`);
    }

    return NextResponse.json({
      ok: true,
      taskId: task.id,
      task,
    });
  } catch (error) {
    const status = error instanceof TaskDispatchError ? error.status : 500;
    const fallback =
      error instanceof TaskDispatchError && error.status < 500
        ? error.message
        : "Jarvis could not create the task. No changes were made.";
    return NextResponse.json({ error: safeClientErrorMessage(error, fallback) }, { status });
  }
}
