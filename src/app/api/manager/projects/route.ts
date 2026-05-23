import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { requireManagerContext } from "@/lib/manager-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import {
  insertProjectTolerant,
  validateProjectSaveBody,
} from "@/lib/project-save";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Project saves are temporarily unavailable." },
        { status: 503 },
      );
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
        { error: "Finance access is required to set project rates." },
        { status: 403 },
      );
    }

    const validation = validateProjectSaveBody(body, {
      allowBlankCoordinates: false,
    });

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

    revalidatePath("/projects");

    return NextResponse.json({
      ok: true,
      projectId: data?.id ?? null,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
