import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { validateClientSaveBody } from "@/lib/client-directory";
import { requireManagerContext } from "@/lib/manager-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Client saves are temporarily unavailable." },
        { status: 503 },
      );
    }

    const rawBody = (await request.json()) as unknown;
    const body =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};
    const validation = validateClientSaveBody(body);

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    const now = new Date().toISOString();
    const { data, error } = await adminClient
      .from("clients")
      .insert({
        org_id: profile.org_id,
        ...validation.payload,
        created_by: profile.id,
        updated_by: profile.id,
        created_at: now,
        updated_at: now,
      })
      .select("id, name, status")
      .single<{ id: string; name: string; status: string }>();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data) {
      await logAuditServer(adminClient, {
        orgId: profile.org_id,
        actorId: profile.id,
        actorName: profile.name,
        actorRole: profile.role,
        action: "client_created",
        targetType: "client",
        targetId: data.id,
        afterData: {
          name: data.name,
          status: data.status,
        },
      });
    }

    revalidatePath("/clients");

    return NextResponse.json({ ok: true, clientId: data?.id ?? null });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
