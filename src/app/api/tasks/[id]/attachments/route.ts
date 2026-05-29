import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { assertTaskAttachmentMediaTargets } from "@/lib/server/file-attachment-guard";
import { readRequiredUuid, readUuidArray } from "@/lib/server/id-guards";
import { TaskDispatchError } from "@/lib/server/task-dispatch";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  getAttachmentMediaIds,
  getAttachmentRefs,
  linkMediaToTask,
  mergeTaskAttachmentRefs,
  type TaskAttachmentRef,
} from "@/lib/task-attachments";
import type { Task } from "@/types/database";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawTaskId } = await params;
    const taskId = readRequiredUuid(rawTaskId, "task id");
    if (!taskId.ok) {
      return NextResponse.json({ error: taskId.error }, { status: taskId.status });
    }

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
      .select("id, name, org_id, role")
      .eq("id", user.id)
      .maybeSingle<{
        id: string;
        name: string;
        org_id: string;
        role: string;
      }>();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
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
    if (attachmentMediaIds.value.length === 0) {
      return NextResponse.json({ error: "No attachments provided." }, { status: 400 });
    }

    // Read through the user-scoped client first so existing task RLS
    // decides who may see/attach to this task before the service-role
    // client performs the metadata update.
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("id, org_id, project_id, assigned_to, title, deleted_at, metadata")
      .eq("id", taskId.value)
      .eq("org_id", profile.org_id)
      .maybeSingle<
        Pick<
          Task,
          "id" | "org_id" | "project_id" | "assigned_to" | "title" | "deleted_at" | "metadata"
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

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Task attachment update is temporarily unavailable." },
        { status: 503 },
      );
    }

    const safeAttachmentMediaIds = await assertTaskAttachmentMediaTargets(adminClient, {
      orgId: profile.org_id,
      projectId: task.project_id,
      mediaIds: attachmentMediaIds.value,
    });

    const { data: mediaRows, error: mediaError } = await adminClient
      .from("media")
      .select("id, filename, mime_type, media_type, storage_path")
      .in("id", safeAttachmentMediaIds);
    if (mediaError) {
      return NextResponse.json({ error: "Attachment lookup failed." }, { status: 500 });
    }

    const mediaById = new Map(
      ((mediaRows ?? []) as TaskAttachmentRef[]).map((row) => [row.id, row]),
    );
    const nextRefs = safeAttachmentMediaIds
      .map((id) => mediaById.get(id))
      .filter((ref): ref is TaskAttachmentRef => Boolean(ref));
    if (nextRefs.length !== safeAttachmentMediaIds.length) {
      return NextResponse.json({ error: "Attachment is not available." }, { status: 404 });
    }

    const metadata = asRecord(task.metadata);
    const nextIds = Array.from(
      new Set([...getAttachmentMediaIds({ metadata }), ...safeAttachmentMediaIds]),
    );
    const nextMetadata = {
      ...metadata,
      attachment_media_ids: nextIds,
      attachment_refs: mergeTaskAttachmentRefs(getAttachmentRefs({ metadata }), nextRefs),
    };

    const { data: updatedTask, error: updateError } = await adminClient
      .from("tasks")
      .update({ metadata: nextMetadata })
      .eq("id", task.id)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .select("id, metadata")
      .maybeSingle<Pick<Task, "id" | "metadata">>();
    if (updateError || !updatedTask) {
      return NextResponse.json(
        { error: updateError?.message ?? "Task attachment update failed." },
        { status: 500 },
      );
    }

    await linkMediaToTask(adminClient, task.id, safeAttachmentMediaIds);
    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action: "task_attachments_added",
      targetType: "task",
      targetId: task.id,
      beforeData: {
        attachment_media_ids: getAttachmentMediaIds({ metadata }),
      },
      afterData: {
        attachment_media_ids: nextIds,
        added_attachment_media_ids: safeAttachmentMediaIds,
      },
    });

    revalidatePath("/tasks");
    revalidatePath("/my-tasks");
    revalidatePath("/projects");
    revalidatePath("/project");
    revalidatePath("/command-center");
    revalidatePath("/overview");
    if (task.project_id) {
      revalidatePath(`/projects/${task.project_id}`);
      revalidatePath(`/project/${task.project_id}`);
    }
    if (task.assigned_to) {
      revalidatePath(`/team/${task.assigned_to}`);
    }

    return NextResponse.json({
      ok: true,
      task: updatedTask,
      attachments: nextRefs,
    });
  } catch (error) {
    if (error instanceof TaskDispatchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Task attachment update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
