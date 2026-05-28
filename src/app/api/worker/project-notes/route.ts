import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { appendProjectPublicNote, readProjectPublicNotes } from "@/lib/project-public-notes";
import type { Profile, Project } from "@/types/database";

const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const MAX_NOTE_LENGTH = 2000;

type ProjectNoteProfile = Pick<
  Profile,
  "id" | "name" | "org_id" | "role" | "project_access_mode"
>;

type ProjectNoteProject = Pick<Project, "id" | "org_id" | "status" | "settings">;

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

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const projectId = readRequiredUuid(body.projectId, "project id");
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    if (!text) {
      return NextResponse.json({ error: "Project note is required." }, { status: 400 });
    }
    if (text.length > MAX_NOTE_LENGTH) {
      return NextResponse.json({ error: "Project note is too long." }, { status: 400 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, org_id, role, project_access_mode")
      .eq("id", user.id)
      .maybeSingle<ProjectNoteProfile>();
    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, org_id, status, settings")
      .eq("id", projectId.value)
      .eq("org_id", profile.org_id)
      .is("deleted_at", null)
      .maybeSingle<ProjectNoteProject>();
    if (projectError || !project) {
      return NextResponse.json(
        { error: projectError?.message ?? "Project not found." },
        { status: 404 },
      );
    }
    if (project.status === "archived") {
      return NextResponse.json({ error: "Project is archived." }, { status: 403 });
    }

    let allowed = MANAGER_ROLES.has(profile.role);
    if (!allowed) {
      const accessMode = profile.project_access_mode === "all_active" ? "all_active" : "list";
      if (accessMode === "list") {
        const { data: assignment } = await supabase
          .from("project_assignments")
          .select("project_id")
          .eq("project_id", projectId.value)
          .eq("profile_id", profile.id)
          .maybeSingle();
        allowed = Boolean(assignment);
      } else if (project.status === "active") {
        const { data: exclusion, error: exclusionError } = await supabase
          .from("project_exclusions")
          .select("id")
          .eq("project_id", projectId.value)
          .eq("profile_id", profile.id)
          .maybeSingle();
        allowed = exclusionError ? true : !exclusion;
      }
    }

    if (!allowed) {
      return NextResponse.json(
        { error: "Project is not available to this user." },
        { status: 403 },
      );
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Project notes are temporarily unavailable." },
        { status: 500 },
      );
    }

    const note = {
      id: randomUUID(),
      text,
      authorId: profile.id,
      authorName: profile.name,
      createdAt: new Date().toISOString(),
    };
    const nextSettings = appendProjectPublicNote(project.settings, note);

    const { data: updated, error: updateError } = await admin
      .from("projects")
      .update({ settings: nextSettings })
      .eq("id", project.id)
      .eq("org_id", profile.org_id)
      .select("settings")
      .maybeSingle<Pick<Project, "settings">>();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: updateError?.message ?? "Project note could not be saved." },
        { status: 500 },
      );
    }

    revalidatePath("/projects");
    revalidatePath("/my-projects");
    revalidatePath(`/projects/${project.id}`);
    revalidatePath(`/project/${project.id}`);
    revalidatePath("/overview");
    revalidatePath("/command-center");

    return NextResponse.json({ ok: true, note, notes: readProjectPublicNotes(nextSettings) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
