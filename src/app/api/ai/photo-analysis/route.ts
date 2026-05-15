import { NextRequest, NextResponse } from "next/server";
import { analyzePhotoEvidence } from "@/lib/ai/service";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Media } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";

    if (!mediaId) {
      return NextResponse.json({ error: "Media id is required." }, { status: 400 });
    }

    let media: Media | null = null;
    if (auth.kind === "preview") {
      media = auth.managerData.media.find((item) => item.id === mediaId) ?? null;
    } else {
      const mediaResult = await supabase
        .from("media")
        .select("*")
        .eq("id", mediaId)
        .single<Media>();

      assertNoError(mediaResult.error, "Media query failed");
      media = mediaResult.data ?? null;
    }

    if (!media) {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }

    const data =
      auth.kind === "preview" ? auth.managerData : await getManagerWorkspaceData();
    const projectName =
      media.project_id
        ? data.projects.find((project) => project.id === media.project_id)?.name ?? "Unknown project"
        : "Unlinked project";
    const relatedTasks = data.tasks
      .filter((task) => task.project_id === media.project_id)
      .map((task) => task.title)
      .slice(0, 6);
    const analysis = await analyzePhotoEvidence({
      mediaId: media.id,
      mediaType: media.media_type,
      filename: media.filename ?? media.media_type,
      caption: media.caption ?? "",
      isCheckout: media.is_checkout,
      projectName,
      createdAt: media.created_at,
      relatedTasks,
    });

    let persisted = false;
    // Wave X2 (00011_media_project_privacy.sql) note: this route uses
    // the admin client to persist ai_analysis back, which bypasses RLS.
    // That's safe here because requireManagerContext() above already
    // gated the request to manager / admin / owner — workers cannot
    // call this endpoint and trigger an analyze on a foreign-project
    // media row.
    const adminClient = auth.kind === "authenticated" ? createAdminClient() : null;

    if (adminClient) {
      const persistResult = await adminClient
        .from("media")
        .update({
          ai_analysis: {
            ...analysis,
            analyzedAt: new Date().toISOString(),
          },
        })
        .eq("id", media.id)
        .eq("org_id", media.org_id);

      persisted = !persistResult.error;
    }

    return NextResponse.json({
      ok: true,
      analysis,
      persisted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
