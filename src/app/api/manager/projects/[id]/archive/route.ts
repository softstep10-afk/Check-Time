import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { requireManagerContext } from "@/lib/manager-data";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function isMissingArchiveColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /column .* archived_(at|by)/i.test(error.message ?? "");
}

async function archiveProject(args: {
  adminClient: ReturnType<typeof createAdminClient>;
  projectId: string;
  orgId: string;
  archivedBy: string;
}) {
  const { adminClient, projectId, orgId, archivedBy } = args;
  if (!adminClient) {
    return {
      data: null,
      error: {
        message: "Project archive is temporarily unavailable.",
      },
    };
  }

  const now = new Date().toISOString();
  const first = await adminClient
    .from("projects")
    .update({
      status: "archived",
      deleted_at: null,
      archived_at: now,
      archived_by: archivedBy,
    })
    .eq("id", projectId)
    .eq("org_id", orgId)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (first.error && isMissingArchiveColumnError(first.error)) {
    return adminClient
      .from("projects")
      .update({
        status: "archived",
        deleted_at: null,
      })
      .eq("id", projectId)
      .eq("org_id", orgId)
      .select("id")
      .maybeSingle<{ id: string }>();
  }

  return first;
}

async function handleArchive(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const projectId = readRequiredUuid(rawId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }
    const id = projectId.value;
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();
    const { data: beforeProject } = adminClient
      ? await adminClient
          .from("projects")
          .select("id, name, status, deleted_at, archived_at")
          .eq("id", id)
          .eq("org_id", profile.org_id)
          .maybeSingle<{
            id: string;
            name: string;
            status: string;
            deleted_at: string | null;
            archived_at?: string | null;
          }>()
      : { data: null };

    const { data, error } = await archiveProject({
      adminClient,
      projectId: id,
      orgId: profile.org_id,
      archivedBy: profile.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    if (adminClient) {
      await logAuditServer(adminClient, {
        orgId: profile.org_id,
        actorId: profile.id,
        actorName: profile.name,
        actorRole: profile.role,
        action: "project_archived",
        targetType: "project",
        targetId: id,
        beforeData: beforeProject
          ? {
              name: beforeProject.name,
              status: beforeProject.status,
              deleted_at: beforeProject.deleted_at,
              archived_at: beforeProject.archived_at ?? null,
            }
          : null,
        afterData: {
          status: "archived",
          deleted_at: null,
          archived_by: profile.id,
        },
      });
    }

    revalidatePath("/overview");
    revalidatePath("/projects");
    revalidatePath("/tasks");
    revalidatePath("/archive");
    revalidatePath(`/archive/projects/${id}`);
    revalidatePath(`/projects/${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleArchive(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handleArchive(request, context);
}
