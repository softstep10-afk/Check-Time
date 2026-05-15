import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
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
    const { id } = await params;
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        {
          error:
            "Project deletes need SUPABASE_SERVICE_ROLE_KEY on the server before manager mutations can run safely.",
        },
        { status: 503 },
      );
    }

    // Scope the row lookup AND the delete by org_id so a manager can
    // never reach across orgs even if RLS is widened later.
    const { data: existingProject, error: existingProjectError } = await adminClient
      .from("projects")
      .select("id, org_id")
      .eq("id", id)
      .eq("org_id", profile.org_id)
      .maybeSingle<{ id: string; org_id: string }>();

    if (existingProjectError) {
      return NextResponse.json({ error: existingProjectError.message }, { status: 500 });
    }

    if (!existingProject) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    // Hard delete. FK cascade behavior (defined in 00001_foundation.sql):
    //   time_events.project_id        ON DELETE CASCADE  → events purged
    //   project_assignments.project_id ON DELETE CASCADE → assignments purged
    //   media.project_id              ON DELETE SET NULL → media kept, unlinked
    //   tasks.project_id              ON DELETE SET NULL → tasks kept, unlinked
    const { error: deleteError } = await adminClient
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("org_id", profile.org_id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    revalidatePath("/projects");

    return NextResponse.json({ ok: true });
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
    const { id } = await params;
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        {
          error:
            "Project saves need SUPABASE_SERVICE_ROLE_KEY on the server before manager mutations can run safely.",
        },
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
