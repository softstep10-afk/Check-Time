import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import {
  createManagerTask,
  TaskDispatchError,
} from "@/lib/server/task-dispatch";
import { assertTaskAttachmentMediaTargets } from "@/lib/server/file-attachment-guard";
import { readOptionalUuid, readUuidArray } from "@/lib/server/id-guards";
import {
  buildMaterialTaskMetadata,
  buildMaterialTaskTitle,
  normalizeMaterialTaskUrgency,
} from "@/lib/material-tasks";
import { isEligibleMaterialTaker } from "@/lib/material-driver-permissions";
import { readMaterialDriverProfileIdsFromEnv } from "@/lib/server/material-driver-config";
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

function readMaterialPayload(value: unknown): {
  enabled: boolean;
  materialName: string;
  urgency: "urgent" | "normal";
  neededDate: string;
  notes: string;
  quantity: string;
  unit: string;
  orderId: string;
  orderNote: string;
  orderSize: number | null;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      enabled: false,
      materialName: "",
      urgency: "normal",
      neededDate: "",
      notes: "",
      quantity: "",
      unit: "",
      orderId: "",
      orderNote: "",
      orderSize: null,
    };
  }
  const input = value as Record<string, unknown>;
  const enabled = input.enabled === true || input.materialRequest === true;
  const orderSize = typeof input.orderSize === "number" && Number.isFinite(input.orderSize)
    ? Math.max(1, Math.floor(input.orderSize))
    : null;
  return {
    enabled,
    materialName: readText(input.materialName),
    urgency: normalizeMaterialTaskUrgency(input.urgency),
    neededDate: readText(input.neededDate),
    notes: readText(input.notes),
    quantity: readText(input.quantity),
    unit: readText(input.unit),
    orderId: readText(input.orderId),
    orderNote: readText(input.orderNote),
    orderSize,
  };
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
    const material = readMaterialPayload(body.material);
    const configuredMaterialDriverIds = readMaterialDriverProfileIdsFromEnv();
    const safeAttachmentMediaIds = await assertTaskAttachmentMediaTargets(adminClient, {
      orgId: profile.org_id,
      projectId: projectId.value,
      mediaIds: attachmentMediaIds.value,
    });
    const materialEnabled = material.enabled && material.materialName.length > 0;
    if (materialEnabled && assignedTo.value) {
      const { data: assignee, error: assigneeError } = await adminClient
        .from("profiles")
        .select("id, org_id, role, is_active, deleted_at")
        .eq("id", assignedTo.value)
        .eq("org_id", profile.org_id)
        .maybeSingle<{
          id: string;
          org_id: string;
          role: string;
          is_active: boolean;
          deleted_at: string | null;
        }>();
      if (assigneeError) {
        return NextResponse.json(
          { error: "Driver validation failed." },
          { status: 500 },
        );
      }
      if (!assignee || assignee.deleted_at || !assignee.is_active) {
        return NextResponse.json(
          { error: "Driver is not available." },
          { status: 404 },
        );
      }
      if (!isEligibleMaterialTaker(assignee, {
        configuredDriverProfileIds: configuredMaterialDriverIds,
      })) {
        return NextResponse.json(
          { error: "Material tasks can only be assigned to eligible drivers or workers." },
          { status: 403 },
        );
      }
    }
    const title = materialEnabled
      ? readText(body.title) || buildMaterialTaskTitle(null, material.materialName)
      : readText(body.title);
    const description = materialEnabled
      ? material.notes || readText(body.description) || null
      : readText(body.description) || null;
    const priority: TaskPriority = materialEnabled
      ? material.urgency === "urgent"
        ? "urgent"
        : "medium"
      : readPriority(body.priority);
    const dueDate = materialEnabled
      ? material.neededDate || readText(body.dueDate) || null
      : readText(body.dueDate) || null;
    const task = await createManagerTask(adminClient, {
      orgId: profile.org_id,
      actor: profile,
      title,
      description,
      projectId: projectId.value,
      assignedTo: assignedTo.value,
      priority,
      dueDate,
      source: materialEnabled ? "manager_material_task" : readText(body.source) || "manager_task",
      auditAction: "task_created",
      metadata: {
        attachment_media_ids: safeAttachmentMediaIds,
        ...(materialEnabled
          ? buildMaterialTaskMetadata({
              materialName: material.materialName,
              materialNotes: material.notes || null,
              urgency: material.urgency,
              neededDate: dueDate,
              requestedBy: profile.id,
              driverUserId: assignedTo.value,
              projectId: projectId.value,
              quantity: material.quantity || null,
              unit: material.unit || null,
              orderId: material.orderId || null,
              orderNote: material.orderNote || material.notes || null,
              orderSize: material.orderSize,
            })
          : {}),
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
