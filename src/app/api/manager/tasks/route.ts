import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import {
  createManagerTask,
  TaskDispatchError,
} from "@/lib/server/task-dispatch";
import { assertTaskAttachmentMediaTargets } from "@/lib/server/file-attachment-guard";
import { readOptionalUuid, readUuidArray } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Task creation is temporarily unavailable." },
        { status: 503 },
      );
    }

    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    const attachmentMediaIds = readUuidArray(body.attachmentMediaIds, {
      label: "attachment media id",
      limit: 50,
    });
    if (!attachmentMediaIds.ok) {
      return NextResponse.json(
        { error: attachmentMediaIds.error },
        { status: attachmentMediaIds.status },
      );
    }
    const projectId = readOptionalUuid(body.projectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    const assignedTo = readOptionalUuid(body.assignedTo, "assigned worker id");
    if (!assignedTo.ok) {
      return NextResponse.json({ error: assignedTo.error }, { status: assignedTo.status });
    }
    const safeAttachmentMediaIds = await assertTaskAttachmentMediaTargets(adminClient, {
      orgId: profile.org_id,
      projectId: projectId.value,
      mediaIds: attachmentMediaIds.value,
    });
    const task = await createManagerTask(adminClient, {
      orgId: profile.org_id,
      actor: profile,
      title: readText(body.title),
      description: readText(body.description) || null,
      projectId: projectId.value,
      assignedTo: assignedTo.value,
      priority: readPriority(body.priority),
      dueDate: readText(body.dueDate) || null,
      source: readText(body.source) || "manager_task",
      auditAction: "task_created",
      metadata: {
        attachment_media_ids: safeAttachmentMediaIds,
      },
    });

    revalidatePath("/tasks");
    revalidatePath("/command-center");
    revalidatePath("/overview");
    revalidatePath("/projects");
    revalidatePath("/my-tasks");
    if (task.project_id) {
      revalidatePath(`/projects/${task.project_id}`);
      revalidatePath(`/project/${task.project_id}`);
    }
    if (task.assigned_to) {
      revalidatePath(`/team/${task.assigned_to}`);
    }

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    const status = error instanceof TaskDispatchError ? error.status : 500;
    const message =
      error instanceof TaskDispatchError && error.status < 500
        ? error.message
        : "Task was not created. No changes were made.";
    return NextResponse.json({ error: message }, { status });
  }
}
