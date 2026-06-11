import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { logAuditServer } from "@/lib/audit-server";
import { requireManagerContext } from "@/lib/manager-data";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { BusinessClient, Project, ProjectClient } from "@/types/database";

type ProjectLinkRecord = Pick<Project, "id" | "org_id" | "name" | "status" | "deleted_at">;
type ClientLinkRecord = Pick<BusinessClient, "id" | "org_id" | "name" | "status">;

function readBodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function revalidateClientProjectPaths(projectId: string, clientId: string, previousClientId?: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  if (previousClientId && previousClientId !== clientId) {
    revalidatePath(`/clients/${previousClientId}`);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawProjectId } = await params;
    const projectId = readRequiredUuid(rawProjectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }

    const rawBody = (await request.json().catch(() => ({}))) as unknown;
    const body = readBodyObject(rawBody);
    const clientId = readRequiredUuid(body.clientId, "client id");
    if (!clientId.ok) {
      return NextResponse.json({ error: clientId.error }, { status: clientId.status });
    }
    const replace = body.replace === true;

    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Client project links are temporarily unavailable." },
        { status: 503 },
      );
    }

    const [projectResult, clientResult, existingLinkResult] = await Promise.all([
      adminClient
        .from("projects")
        .select("id, org_id, name, status, deleted_at")
        .eq("id", projectId.value)
        .eq("org_id", profile.org_id)
        .maybeSingle<ProjectLinkRecord>(),
      adminClient
        .from("clients")
        .select("id, org_id, name, status")
        .eq("id", clientId.value)
        .eq("org_id", profile.org_id)
        .maybeSingle<ClientLinkRecord>(),
      adminClient
        .from("project_clients")
        .select("*")
        .eq("project_id", projectId.value)
        .eq("org_id", profile.org_id)
        .eq("status", "active")
        .order("linked_at", { ascending: false })
        .limit(1)
        .returns<ProjectClient[]>(),
    ]);

    if (projectResult.error) {
      return NextResponse.json({ error: projectResult.error.message }, { status: 500 });
    }
    if (clientResult.error) {
      return NextResponse.json({ error: clientResult.error.message }, { status: 500 });
    }
    if (existingLinkResult.error) {
      return NextResponse.json({ error: existingLinkResult.error.message }, { status: 500 });
    }

    const project = projectResult.data;
    const client = clientResult.data;
    if (!project || project.deleted_at || project.status === "archived") {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (!client) {
      return NextResponse.json({ error: "Client not found." }, { status: 404 });
    }
    if (client.status !== "active") {
      return NextResponse.json(
        { error: "Inactive clients cannot be linked to projects." },
        { status: 400 },
      );
    }

    const existingLink = existingLinkResult.data?.[0] ?? null;
    if (existingLink?.client_id === client.id) {
      return NextResponse.json({ ok: true, unchanged: true });
    }
    if (existingLink && !replace) {
      return NextResponse.json(
        {
          error: "Project already has an active client. Confirm replace to change it.",
          code: "CLIENT_LINK_REPLACE_REQUIRED",
        },
        { status: 409 },
      );
    }

    const previousClientResult = existingLink
      ? await adminClient
          .from("clients")
          .select("id, org_id, name, status")
          .eq("id", existingLink.client_id)
          .eq("org_id", profile.org_id)
          .maybeSingle<ClientLinkRecord>()
      : null;
    const previousClient = previousClientResult?.data ?? null;
    const now = new Date().toISOString();

    if (existingLink) {
      const { error: unlinkError } = await adminClient
        .from("project_clients")
        .update({
          status: "inactive",
          unlinked_by: profile.id,
          unlinked_at: now,
          updated_at: now,
        })
        .eq("id", existingLink.id)
        .eq("org_id", profile.org_id)
        .eq("status", "active");

      if (unlinkError) {
        return NextResponse.json({ error: unlinkError.message }, { status: 500 });
      }
    }

    const { data: insertedLink, error: insertError } = await adminClient
      .from("project_clients")
      .insert({
        org_id: profile.org_id,
        project_id: project.id,
        client_id: client.id,
        status: "active",
        linked_by: profile.id,
        linked_at: now,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single<{ id: string }>();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const action = existingLink ? "client_project_changed" : "client_project_linked";
    const beforeData = previousClient
      ? {
          project_id: project.id,
          project_name: project.name,
          client_id: previousClient.id,
          client_name: previousClient.name,
        }
      : null;
    const afterData = {
      project_id: project.id,
      project_name: project.name,
      client_id: client.id,
      client_name: client.name,
      link_id: insertedLink?.id ?? null,
    };

    if (previousClient) {
      await logAuditServer(adminClient, {
        orgId: profile.org_id,
        actorId: profile.id,
        actorName: profile.name,
        actorRole: profile.role,
        action,
        targetType: "client",
        targetId: previousClient.id,
        beforeData,
        afterData,
      });
    }

    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action,
      targetType: "client",
      targetId: client.id,
      beforeData,
      afterData,
    });

    revalidateClientProjectPaths(project.id, client.id, previousClient?.id);

    return NextResponse.json({ ok: true, linkId: insertedLink?.id ?? null });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: rawProjectId } = await params;
    const projectId = readRequiredUuid(rawProjectId, "project id");
    if (!projectId.ok) {
      return NextResponse.json({ error: projectId.error }, { status: projectId.status });
    }

    const supabase = await createClient();
    const { profile } = await requireManagerContext(supabase);
    const adminClient = createAdminClient();

    if (!adminClient) {
      return NextResponse.json(
        { error: "Client project links are temporarily unavailable." },
        { status: 503 },
      );
    }

    const [projectResult, existingLinkResult] = await Promise.all([
      adminClient
        .from("projects")
        .select("id, org_id, name, status, deleted_at")
        .eq("id", projectId.value)
        .eq("org_id", profile.org_id)
        .maybeSingle<ProjectLinkRecord>(),
      adminClient
        .from("project_clients")
        .select("*")
        .eq("project_id", projectId.value)
        .eq("org_id", profile.org_id)
        .eq("status", "active")
        .order("linked_at", { ascending: false })
        .limit(1)
        .returns<ProjectClient[]>(),
    ]);

    if (projectResult.error) {
      return NextResponse.json({ error: projectResult.error.message }, { status: 500 });
    }
    if (existingLinkResult.error) {
      return NextResponse.json({ error: existingLinkResult.error.message }, { status: 500 });
    }
    const project = projectResult.data;
    if (!project || project.deleted_at) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const existingLink = existingLinkResult.data?.[0] ?? null;
    if (!existingLink) {
      return NextResponse.json({ ok: true, unchanged: true });
    }

    const { data: client, error: clientError } = await adminClient
      .from("clients")
      .select("id, org_id, name, status")
      .eq("id", existingLink.client_id)
      .eq("org_id", profile.org_id)
      .maybeSingle<ClientLinkRecord>();
    if (clientError) {
      return NextResponse.json({ error: clientError.message }, { status: 500 });
    }

    const now = new Date().toISOString();
    const { error: unlinkError } = await adminClient
      .from("project_clients")
      .update({
        status: "inactive",
        unlinked_by: profile.id,
        unlinked_at: now,
        updated_at: now,
      })
      .eq("id", existingLink.id)
      .eq("org_id", profile.org_id)
      .eq("status", "active");

    if (unlinkError) {
      return NextResponse.json({ error: unlinkError.message }, { status: 500 });
    }

    await logAuditServer(adminClient, {
      orgId: profile.org_id,
      actorId: profile.id,
      actorName: profile.name,
      actorRole: profile.role,
      action: "client_project_unlinked",
      targetType: "client",
      targetId: existingLink.client_id,
      beforeData: {
        project_id: project.id,
        project_name: project.name,
        client_id: existingLink.client_id,
        client_name: client?.name ?? null,
      },
      afterData: {
        project_id: project.id,
        project_name: project.name,
        client_id: null,
      },
    });

    revalidateClientProjectPaths(project.id, existingLink.client_id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal server error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
