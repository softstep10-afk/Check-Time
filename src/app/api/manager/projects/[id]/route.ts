import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { requireManagerContext } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import { readRequiredUuid } from "@/lib/server/id-guards";
import {
  clampProjectGpsRadius,
  hasValidProjectSiteCoordinates,
  PROJECT_GPS_RADIUS_DEFAULT,
  type ProjectWriteRecord,
  updateProjectTolerant,
  validateProjectSaveBody,
} from "@/lib/project-save";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
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

    if (!adminClient) {
      return NextResponse.json(
        { error: "Project deletes are temporarily unavailable." },
        { status: 503 },
      );
    }

    // Scope the row lookup AND the update by org_id so a manager can
    // never reach across orgs even if RLS is widened later.
    const { data: existingProject, error: existingProjectError } = await adminClient
      .from("projects")
      .select("id, org_id, name, status, deleted_at")
      .eq("id", id)
      .eq("org_id", profile.org_id)
      .maybeSingle<{ id: string; org_id: string; name: string; status: string; deleted_at: string | null }>();

    if (existingProjectError) {
      return NextResponse.json({ error: existingProjectError.message }, { status: 500 });
    }

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const deletedAt = new Date().toISOString();
    const { error: deleteError } = await adminClient
      .from("projects")
      .update({
        deleted_at: deletedAt,
      })
      .eq("id", id)
      .eq("org_id", profile.org_id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action: "project_moved_to_trash",
      targetType: "project",
      targetId: id,
      beforeData: {
        name: existingProject.name,
        status: existingProject.status,
        deleted_at: existingProject.deleted_at,
      },
      afterData: {
        deleted_at: deletedAt,
      },
    });

    revalidatePath("/overview");
    revalidatePath("/projects");
    revalidatePath("/tasks");
    revalidatePath("/archive");
    revalidatePath("/trash");
    revalidatePath(`/projects/${id}`);

    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
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

    if (!adminClient) {
      return NextResponse.json(
        { error: "Project saves are temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data: existingProject, error: existingProjectError } = await adminClient
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("org_id", profile.org_id)
      .maybeSingle<ProjectWriteRecord>();

    if (existingProjectError) {
      return NextResponse.json({ error: existingProjectError.message }, { status: 500 });
    }

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const canSetFinancials = await hasFinanceAccess(supabase, {
      id: profile.id,
      role: profile.role,
    });

    if (!canSetFinancials && Object.prototype.hasOwnProperty.call(body, "rate")) {
      return NextResponse.json(
        { error: "Finance access is required to update project rates." },
        { status: 403 },
      );
    }

    const validation = validateProjectSaveBody(body, {
      allowBlankCoordinates: hasValidProjectSiteCoordinates(existingProject),
      fallbackRate: existingProject.rate,
      fallbackRadius: existingProject.radius_m,
      fallbackGpsRadius: clampProjectGpsRadius(
        existingProject.gps_radius_m,
        PROJECT_GPS_RADIUS_DEFAULT,
      ),
      defaultStatus: existingProject.status,
      fallbackStartDate: existingProject.start_date,
      fallbackEndDate: existingProject.end_date,
      fallbackSettings: existingProject.settings,
      fallbackTimelineStatus: existingProject.timeline_status,
      fallbackBudgetStatus: existingProject.budget_status,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { error } = await updateProjectTolerant(
      adminClient,
      id,
      validation.payload,
      profile.org_id,
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
