import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { logAuditServer } from "@/lib/audit-server";
import {
  insertProjectTolerant,
  validateProjectSaveBody,
} from "@/lib/project-save";
import { canConfirmJarvisWriteAction } from "@/lib/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind !== "authenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { profile } = auth.context;
    if (!canConfirmJarvisWriteAction(profile.role)) {
      return NextResponse.json(
        { error: "Only owner/admin can confirm Jarvis project actions." },
        { status: 403 },
      );
    }

    const adminClient = createAdminClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: "Jarvis project creation is temporarily unavailable." },
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
      console.error("[Jarvis action] create-project failed", {
        message: error.message,
      });
      return NextResponse.json(
        { error: "Jarvis could not create the project. No changes were made." },
        { status: 500 },
      );
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
    if (process.env.NODE_ENV !== "production") {
      console.error("[Jarvis action] create-project exception", error);
    }
    return NextResponse.json(
      { error: "Jarvis could not create the project. No changes were made." },
      { status: 500 },
    );
  }
}
