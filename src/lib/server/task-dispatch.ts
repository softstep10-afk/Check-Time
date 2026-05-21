import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAuditServer } from "@/lib/audit-server";
import type { Profile, Project, TaskPriority } from "@/types/database";

export type ServerTaskDispatchInput = {
  orgId: string;
  actor: Pick<Profile, "id" | "name" | "role">;
  title: string;
  description?: string | null;
  projectId?: string | null;
  assignedTo?: string | null;
  priority?: TaskPriority;
  dueDate?: string | null;
  source: string;
  messageId?: string | null;
  metadata?: Record<string, unknown>;
  auditAction?: string;
};

export type ServerTaskDispatchResult = {
  id: string;
  title: string;
  project_id: string | null;
  assigned_to: string | null;
};

export class TaskDispatchError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TaskDispatchError";
    this.status = status;
  }
}

function trimText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

async function assertProfileTarget(
  adminClient: SupabaseClient,
  orgId: string,
  profileId: string | null | undefined,
) {
  if (!profileId) return null;

  const { data, error } = await adminClient
    .from("profiles")
    .select("id, name, org_id, role, is_active, deleted_at")
    .eq("id", profileId)
    .eq("org_id", orgId)
    .maybeSingle<Pick<Profile, "id" | "name" | "org_id" | "role" | "is_active" | "deleted_at">>();

  if (error) {
    throw new TaskDispatchError(error.message, 500);
  }
  if (!data || data.deleted_at || !data.is_active) {
    throw new TaskDispatchError("Assigned worker is not available.", 404);
  }

  return data;
}

async function assertProjectTarget(
  adminClient: SupabaseClient,
  orgId: string,
  projectId: string | null | undefined,
) {
  if (!projectId) return null;

  const { data, error } = await adminClient
    .from("projects")
    .select("id, name, org_id, status, deleted_at")
    .eq("id", projectId)
    .eq("org_id", orgId)
    .maybeSingle<Pick<Project, "id" | "name" | "org_id" | "status" | "deleted_at">>();

  if (error) {
    throw new TaskDispatchError(error.message, 500);
  }
  if (!data || data.deleted_at || data.status === "archived") {
    throw new TaskDispatchError("Project is not available for task dispatch.", 404);
  }

  return data;
}

export async function createManagerTask(
  adminClient: SupabaseClient,
  input: ServerTaskDispatchInput,
): Promise<ServerTaskDispatchResult> {
  const title = trimText(input.title);
  if (title.length < 2) {
    throw new TaskDispatchError("Task title is required.", 400);
  }

  const description = trimText(input.description) || null;
  const assignedTo = trimText(input.assignedTo) || null;
  const projectId = trimText(input.projectId) || null;
  const priority = input.priority ?? "medium";
  const dueDate = trimText(input.dueDate) || null;

  await assertProfileTarget(adminClient, input.orgId, assignedTo);
  await assertProjectTarget(adminClient, input.orgId, projectId);

  const metadata = {
    ...(input.metadata ?? {}),
    source: input.source,
    message_id: input.messageId ?? input.metadata?.message_id ?? null,
    created_by: input.actor.id,
    created_by_role: input.actor.role,
    created_via: "server_task_dispatch",
  };

  const { data, error } = await adminClient
    .from("tasks")
    .insert({
      org_id: input.orgId,
      project_id: projectId,
      assigned_to: assignedTo,
      assigned_by: input.actor.id,
      title: title.slice(0, 180),
      description,
      priority,
      status: "pending",
      due_date: dueDate,
      metadata,
    })
    .select("id, title, project_id, assigned_to")
    .single<ServerTaskDispatchResult>();

  if (error || !data) {
    throw new TaskDispatchError(error?.message ?? "Task was not created.", 500);
  }

  await logAuditServer(adminClient, {
    orgId: input.orgId,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    action: input.auditAction ?? "task_created_from_dispatch",
    targetType: "task",
    targetId: data.id,
    beforeData: null,
    afterData: {
      title: data.title,
      project_id: data.project_id,
      assigned_to: data.assigned_to,
      priority,
      source: input.source,
      message_id: input.messageId ?? null,
    },
  });

  return data;
}
