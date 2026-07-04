import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  buildMaterialTaskMetadata,
  normalizeMaterialTaskUrgency,
  type MaterialTaskUrgency,
} from "@/lib/material-tasks";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Task, TaskPriority } from "@/types/database";

type MaterialOrderRowInput = {
  name?: unknown;
  quantity?: unknown;
  unit?: unknown;
};

const TASK_PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "urgent"]);

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPriority(value: unknown): TaskPriority {
  return typeof value === "string" && TASK_PRIORITIES.has(value as TaskPriority)
    ? (value as TaskPriority)
    : "medium";
}

function readQuantity(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : value.trim();
  }
  return null;
}

function readRows(value: unknown): Array<{ name: string; quantity: string | number | null; unit: string | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): MaterialOrderRowInput | null =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as MaterialOrderRowInput)
        : null,
    )
    .filter((item): item is MaterialOrderRowInput => Boolean(item))
    .map((item) => ({
      name: readText(item.name),
      quantity: readQuantity(item.quantity),
      unit: readText(item.unit) || null,
    }))
    .filter((item) => item.name.length > 0)
    .slice(0, 100);
}

async function assertWorkerProjectAccess(
  admin: ReturnType<typeof createAdminClient>,
  profile: Pick<Profile, "id" | "org_id" | "project_access_mode">,
  projectId: string,
): Promise<true | NextResponse> {
  if (!admin) {
    return NextResponse.json(
      { error: "Material ordering is temporarily unavailable." },
      { status: 503 },
    );
  }

  const { data: project, error: projectError } = await admin
    .from("projects")
    .select("id, status")
    .eq("id", projectId)
    .eq("org_id", profile.org_id)
    .is("deleted_at", null)
    .maybeSingle<{ id: string; status: string }>();
  if (projectError || !project) {
    return NextResponse.json(
      { error: projectError?.message ?? "Project not found." },
      { status: 404 },
    );
  }
  if (project.status === "archived") {
    return NextResponse.json({ error: "Project is archived." }, { status: 403 });
  }

  const accessMode = profile.project_access_mode === "all_active" ? "all_active" : "list";
  if (accessMode === "list") {
    const { data: assignment } = await admin
      .from("project_assignments")
      .select("project_id")
      .eq("project_id", projectId)
      .eq("profile_id", profile.id)
      .maybeSingle<{ project_id: string }>();
    if (!assignment) {
      return NextResponse.json(
        { error: "Project is not available to this worker." },
        { status: 403 },
      );
    }
    return true;
  }

  if (project.status !== "active") {
    return NextResponse.json(
      { error: "Project is not available to this worker." },
      { status: 403 },
    );
  }
  const { data: exclusion, error: exclusionError } = await admin
    .from("project_exclusions")
    .select("id")
    .eq("project_id", projectId)
    .eq("profile_id", profile.id)
    .maybeSingle<{ id: string }>();
  if (!exclusionError && exclusion) {
    return NextResponse.json(
      { error: "Project is not available to this worker." },
      { status: 403 },
    );
  }
  return true;
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
      .select("id, org_id, name, role, project_access_mode")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "id" | "org_id" | "name" | "role" | "project_access_mode">>();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = readRequiredUuid(body.projectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    const rows = readRows(body.rows);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Material item is required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const access = await assertWorkerProjectAccess(admin, profile, projectId.value);
    if (access !== true) return access;

    const priority = readPriority(body.priority);
    const urgency: MaterialTaskUrgency =
      normalizeMaterialTaskUrgency(priority) === "urgent" ? "urgent" : "normal";
    const orderNote = readText(body.orderNote) || null;
    const orderId = readText(body.orderId) || randomUUID();

    const { data: tasks, error: insertError } = await admin!
      .from("tasks")
      .insert(
        rows.map((row) => ({
          org_id: profile.org_id,
          project_id: projectId.value,
          assigned_to: null,
          assigned_by: profile.id,
          title: row.name,
          description: null,
          priority,
          status: "pending",
          due_date: null,
          metadata: buildMaterialTaskMetadata({
            materialName: row.name,
            urgency,
            neededDate: null,
            requestedBy: profile.id,
            driverUserId: null,
            projectId: projectId.value,
            quantity: row.quantity,
            unit: row.unit,
            orderId,
            orderNote,
            orderSize: rows.length,
          }),
        })),
      )
      .select("*")
      .returns<Task[]>();
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    revalidatePath("/my-projects");
    revalidatePath("/my-tasks");
    revalidatePath("/projects");
    revalidatePath(`/project/${projectId.value}`);
    revalidatePath(`/projects/${projectId.value}`);

    return NextResponse.json({ ok: true, tasks: tasks ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Material order failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
