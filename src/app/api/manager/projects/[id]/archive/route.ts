import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
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
        message:
          "Project archive needs SUPABASE_SERVICE_ROLE_KEY on the server before manager mutations can run safely.",
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
    const { id } = await params;
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

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
