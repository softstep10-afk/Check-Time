import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createManagerTask,
  TaskDispatchError,
} from "@/lib/server/task-dispatch";
import { readOptionalUuid, readRequiredUuid } from "@/lib/server/id-guards";
import {
  buildMessageTaskMetadata,
  readLinkedTaskId,
} from "@/lib/message-state";
import type { MessagePriority } from "@/lib/message-types";
import type { Task } from "@/types/database";

type MessageTaskInput = {
  messageId?: unknown;
  recipientId?: unknown;
  title?: unknown;
  description?: unknown;
  projectId?: unknown;
  attachmentFilename?: unknown;
  source?: unknown;
};

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTaskItems(value: unknown): MessageTaskInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as MessageTaskInput)
        : null,
    )
    .filter((item): item is MessageTaskInput => Boolean(item))
    .slice(0, 100);
}

function taskPriorityFromMessage(value: unknown): "medium" | "urgent" {
  const priority = value as MessagePriority;
  return priority === "urgent" ? "urgent" : "medium";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Task dispatch is temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const items = readTaskItems(body.items);
    if (!items.length) {
      return NextResponse.json({ error: "No task items provided." }, { status: 400 });
    }

    const tasks = [];
    for (const item of items) {
      const messageId = readRequiredUuid(item.messageId, "message id");
      const recipientId = readRequiredUuid(item.recipientId, "recipient id");
      const projectId = readOptionalUuid(item.projectId, "project id");
      if (!messageId.ok) {
        throw new TaskDispatchError(messageId.error, messageId.status);
      }
      if (!recipientId.ok) {
        throw new TaskDispatchError(recipientId.error, recipientId.status);
      }
      if (!projectId.ok) {
        throw new TaskDispatchError(projectId.error, projectId.status);
      }

      const { data: message, error: messageError } = await adminClient
        .from("messages")
        .select("id, org_id, sender_id, recipient_id, metadata")
        .eq("id", messageId.value)
        .eq("org_id", profile.org_id)
        .maybeSingle<{
          id: string;
          org_id: string;
          sender_id: string;
          recipient_id: string;
          metadata: Record<string, unknown> | null;
        }>();

      if (messageError) {
        throw new TaskDispatchError(messageError.message, 500);
      }
      if (!message || message.sender_id !== profile.id || message.recipient_id !== recipientId.value) {
        throw new TaskDispatchError("Message does not belong to this dispatch.", 403);
      }

      const linkedTaskId = readLinkedTaskId(message.metadata);
      const existingTaskQuery = adminClient
        .from("tasks")
        .select("*")
        .eq("org_id", profile.org_id)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1);
      const existingTaskResult = linkedTaskId
        ? await existingTaskQuery.eq("id", linkedTaskId).maybeSingle<Task>()
        : await existingTaskQuery
            .filter("metadata->>message_id", "eq", messageId.value)
            .maybeSingle<Task>();
      if (existingTaskResult.error) {
        throw new TaskDispatchError(existingTaskResult.error.message, 500);
      }
      if (linkedTaskId && !existingTaskResult.data) {
        throw new TaskDispatchError("Message is already linked to a task.", 409);
      }
      if (existingTaskResult.data) {
        const existingTask = existingTaskResult.data;
        const nextMetadata = buildMessageTaskMetadata(
          message.metadata,
          existingTask.id,
          typeof message.metadata?.task_created_at === "string"
            ? message.metadata.task_created_at
            : existingTask.created_at,
        );
        const { error: linkError } = await adminClient
          .from("messages")
          .update({ metadata: nextMetadata })
          .eq("id", message.id)
          .eq("org_id", profile.org_id);
        if (linkError) {
          console.warn("message task link update failed:", linkError.message);
        }
        tasks.push(existingTask);
        continue;
      }

      const task = await createManagerTask(adminClient, {
        orgId: profile.org_id,
        actor: profile,
        title: readText(item.title),
        description: readText(item.description) || null,
        projectId: projectId.value,
        assignedTo: recipientId.value,
        priority: taskPriorityFromMessage(body.priority),
        source: readText(item.source) || "message_task",
        messageId: messageId.value,
        auditAction: "task_created_from_message",
        metadata: {
          recipient_id: recipientId.value,
          attachment_filename: readText(item.attachmentFilename) || null,
        },
      });
      const nextMetadata = buildMessageTaskMetadata(
        message.metadata,
        task.id,
        new Date().toISOString(),
      );
      const { error: linkError } = await adminClient
        .from("messages")
        .update({ metadata: nextMetadata })
        .eq("id", message.id)
        .eq("org_id", profile.org_id);
      if (linkError) {
        console.warn("message task link update failed:", linkError.message);
      }
      tasks.push(task);
    }

    revalidatePath("/tasks");
    revalidatePath("/command-center");
    revalidatePath("/overview");
    revalidatePath("/messages");
    revalidatePath("/my-messages");
    revalidatePath("/my-tasks");
    for (const task of tasks) {
      if (task.project_id) {
        revalidatePath(`/projects/${task.project_id}`);
        revalidatePath(`/project/${task.project_id}`);
      }
      if (task.assigned_to) {
        revalidatePath(`/team/${task.assigned_to}`);
      }
    }

    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    const status = error instanceof TaskDispatchError ? error.status : 500;
    const message =
      error instanceof TaskDispatchError && error.status < 500
        ? error.message
        : "Task dispatch failed. No task was created.";
    return NextResponse.json({ error: message }, { status });
  }
}
