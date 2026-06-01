import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { validateClientSaveBody } from "@/lib/client-directory";
import { requireManagerContext } from "@/lib/manager-data";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BusinessClient } from "@/types/database";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawId } = await params;
    const clientId = readRequiredUuid(rawId, "client id");
    if (!clientId.ok) {
      return NextResponse.json({ error: clientId.error }, { status: clientId.status });
    }

    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Client saves are temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data: existingClient, error: existingError } = await adminClient
      .from("clients")
      .select("*")
      .eq("id", clientId.value)
      .eq("org_id", profile.org_id)
      .maybeSingle<BusinessClient>();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 500 });
    }

    if (!existingClient) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const validation = validateClientSaveBody(body, {
      fallbackStatus: existingClient.status,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const updatedAt = new Date().toISOString();
    const { error: updateError } = await adminClient
      .from("clients")
      .update({
        ...validation.payload,
        updated_by: profile.id,
        updated_at: updatedAt,
      })
      .eq("id", clientId.value)
      .eq("org_id", profile.org_id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    const deactivated =
      existingClient.status !== "inactive" && validation.payload.status === "inactive";

    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action: deactivated ? "client_deactivated" : "client_updated",
      targetType: "client",
      targetId: clientId.value,
      beforeData: {
        name: existingClient.name,
        status: existingClient.status,
      },
      afterData: {
        name: validation.payload.name,
        status: validation.payload.status,
        updated_at: updatedAt,
      },
    });

    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId.value}`);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
