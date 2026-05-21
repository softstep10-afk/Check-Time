import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createManagerTask,
  TaskDispatchError,
} from "@/lib/server/task-dispatch";
import type { MessagePriority } from "@/lib/message-types";

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
      const messageId = readText(item.messageId);
      const recipientId = readText(item.recipientId);
      if (!messageId || !recipientId) {
        throw new TaskDispatchError("Message and recipient are required.", 400);
      }

      const { data: message, error: messageError } = await adminClient
        .from("messages")
        .select("id, org_id, sender_id, recipient_id")
        .eq("id", messageId)
        .eq("org_id", profile.org_id)
        .maybeSingle<{
          id: string;
          org_id: string;
          sender_id: string;
          recipient_id: string;
        }>();

      if (messageError) {
        throw new TaskDispatchError(messageError.message, 500);
      }
      if (!message || message.sender_id !== profile.id || message.recipient_id !== recipientId) {
        throw new TaskDispatchError("Message does not belong to this dispatch.", 403);
      }

      const task = await createManagerTask(adminClient, {
        orgId: profile.org_id,
        actor: profile,
        title: readText(item.title),
        description: readText(item.description) || null,
        projectId: readText(item.projectId) || null,
        assignedTo: recipientId,
        priority: taskPriorityFromMessage(body.priority),
        source: readText(item.source) || "message_task",
        messageId,
        auditAction: "task_created_from_message",
        metadata: {
          recipient_id: recipientId,
          attachment_filename: readText(item.attachmentFilename) || null,
        },
      });
      tasks.push(task);
    }

    revalidatePath("/tasks");
    revalidatePath("/command-center");
    revalidatePath("/overview");
    for (const task of tasks) {
      if (task.project_id) revalidatePath(`/projects/${task.project_id}`);
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
