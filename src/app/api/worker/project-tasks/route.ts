import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createManagerTask, TaskDispatchError } from "@/lib/server/task-dispatch";
import type { Profile, TaskPriority } from "@/types/database";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "urgent"];

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

    const body = (await request.json()) as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    const requestedPriority =
      typeof body.priority === "string" && PRIORITIES.includes(body.priority as TaskPriority)
        ? (body.priority as TaskPriority)
        : "medium";

    if (!projectId) {
      return NextResponse.json({ error: "Project id is required." }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Task title is required." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, org_id, role, project_access_mode")
      .eq("id", user.id)
      .maybeSingle<
        Pick<Profile, "id" | "name" | "org_id" | "role" | "project_access_mode">
      >();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, org_id, status")
      .eq("id", projectId)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; org_id: string; status: string }>();
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
    let allowed = false;
    if (accessMode === "list") {
      const { data: assignment } = await supabase
        .from("project_assignments")
        .select("project_id")
        .eq("project_id", projectId)
        .eq("profile_id", user.id)
        .maybeSingle();
      allowed = Boolean(assignment);
    } else if (project.status === "active") {
      const { data: exclusion, error: exclusionError } = await supabase
        .from("project_exclusions")
        .select("id")
        .eq("project_id", projectId)
        .eq("profile_id", user.id)
        .maybeSingle();
      allowed = exclusionError ? true : !exclusion;
    }

    if (!allowed) {
      return NextResponse.json({ error: "Project is not available to this worker." }, { status: 403 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server admin client is not configured for worker task creation." },
        { status: 500 },
      );
    }

    const task = await createManagerTask(admin, {
      orgId: profile.org_id,
      actor: {
        id: profile.id,
        name: profile.name,
        role: profile.role,
      },
      title,
      description,
      projectId,
      assignedTo: null,
      priority: requestedPriority,
      source: "worker_project_view",
      auditAction: "task_created_by_worker",
      metadata: {
        createdByWorker: true,
      },
    });

    revalidatePath("/tasks");
    revalidatePath("/projects");
    revalidatePath("/overview");
    revalidatePath("/command-center");
    revalidatePath("/schedule");
    revalidatePath("/my-tasks");
    revalidatePath("/my-projects");
    revalidatePath("/project");
    revalidatePath("/clock");
    revalidatePath("/crew");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/project/${projectId}`);
    revalidatePath(`/team/${user.id}`);

    return NextResponse.json({ ok: true, task });
  } catch (error) {
    if (error instanceof TaskDispatchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
