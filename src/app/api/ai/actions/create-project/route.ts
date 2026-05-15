import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { requireManagerContext } from "@/lib/manager-data";
import {
  insertProjectTolerant,
  validateProjectSaveBody,
} from "@/lib/project-save";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Jarvis project creation needs SUPABASE_SERVICE_ROLE_KEY on the server." },
        { status: 503 },
      );
    }

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    const validation = validateProjectSaveBody(
      {
        name: readText(body.name),
        address: readText(body.address) || null,
        notes: readText(body.notes) || "Created by Jarvis.",
        start_date: readText(body.startDate),
        end_date: readText(body.endDate),
        status: "active",
        coordinatesConfirmed: true,
      },
      {
        allowBlankCoordinates: true,
        requireConfirmation: false,
      },
    );

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const { data, error } = await insertProjectTolerant(adminClient, {
      org_id: profile.org_id,
      ...validation.payload,
      status: "active",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action: "jarvis_project_created",
      targetType: "project",
      targetId: data?.id ?? undefined,
      afterData: {
        name: validation.payload.name,
        address: validation.payload.address,
        start_date: validation.payload.start_date,
        end_date: validation.payload.end_date,
        source: "jarvis",
      },
    });

    revalidatePath("/projects");
    revalidatePath("/overview");

    return NextResponse.json({
      ok: true,
      projectId: data?.id ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
