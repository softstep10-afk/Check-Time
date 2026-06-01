import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { validateClientContactSaveBody } from "@/lib/client-directory";
import { requireManagerContext } from "@/lib/manager-data";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(
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
        { error: "Client contacts are temporarily unavailable." },
        { status: 503 },
      );
    }

    const { data: existingClient, error: existingError } = await adminClient
      .from("clients")
      .select("id, org_id, name")
      .eq("id", clientId.value)
      .eq("org_id", profile.org_id)
      .maybeSingle<{ id: string; org_id: string; name: string }>();

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
    const validation = validateClientContactSaveBody(body);

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    if (validation.payload.is_primary) {
      const { error: primaryError } = await adminClient
        .from("client_contacts")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("client_id", clientId.value)
        .eq("org_id", profile.org_id)
        .eq("is_primary", true);

      if (primaryError) {
        return NextResponse.json({ error: primaryError.message }, { status: 500 });
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await adminClient
      .from("client_contacts")
      .insert({
        org_id: profile.org_id,
        client_id: clientId.value,
        ...validation.payload,
        created_at: now,
        updated_at: now,
      })
      .select("id, name, is_primary")
      .single<{ id: string; name: string; is_primary: boolean }>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data) {
      await logAuditServer(adminClient, {
        orgId: profile.org_id,
        actorId: profile.id,
        actorName: profile.name,
        actorRole: profile.role,
        action: "client_contact_created",
        targetType: "client",
        targetId: clientId.value,
        afterData: {
          contact_id: data.id,
          contact_name: data.name,
          is_primary: data.is_primary,
        },
      });
    }

    revalidatePath("/clients");
    revalidatePath(`/clients/${clientId.value}`);

    return NextResponse.json({ ok: true, contactId: data?.id ?? null });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
