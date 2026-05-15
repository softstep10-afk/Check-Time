import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import {
  mergeProjectPlanningSettings,
  normalizeMaterialSpecItems,
  normalizeProjectEstimations,
} from "@/lib/project-planning";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type ProjectPlanningRow = {
  id: string;
  org_id: string;
  settings: Record<string, unknown> | null;
};

function readBodyRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function PUT(
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
        { error: "Project planning saves need SUPABASE_SERVICE_ROLE_KEY on the server." },
        { status: 503 },
      );
    }

    const body = readBodyRecord(await request.json().catch(() => ({})));
    const hasMaterialSpec = Object.prototype.hasOwnProperty.call(body, "materialSpecItems");
    const hasEstimations = Object.prototype.hasOwnProperty.call(body, "estimations");

    if (!hasMaterialSpec && !hasEstimations) {
      return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    }

    if (hasEstimations) {
      const financeAllowed = await hasFinanceAccess(supabase, {
        id: profile.id,
        role: profile.role,
      });
      if (!financeAllowed) {
        return NextResponse.json(
          { error: "Finance access is required to update project estimates." },
          { status: 403 },
        );
      }
    }

    const { data: project, error: projectError } = await adminClient
      .from("projects")
      .select("id, org_id, settings")
      .eq("id", id)
      .eq("org_id", profile.org_id)
      .maybeSingle<ProjectPlanningRow>();

    if (projectError) {
      return NextResponse.json({ error: projectError.message }, { status: 500 });
    }

    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const materialSpecItems = hasMaterialSpec
      ? normalizeMaterialSpecItems(body.materialSpecItems)
      : undefined;
    const estimations = hasEstimations
      ? normalizeProjectEstimations(body.estimations)
      : undefined;
    const settings = mergeProjectPlanningSettings(project.settings, {
      materialSpecItems,
      estimations,
    });

    const { error: updateError } = await adminClient
      .from("projects")
      .update({ settings })
      .eq("id", id)
      .eq("org_id", profile.org_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath(`/project/${id}`);

    return NextResponse.json({
      ok: true,
      materialSpecItems,
      estimations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
