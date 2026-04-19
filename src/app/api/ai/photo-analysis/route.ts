import { NextRequest, NextResponse } from "next/server";
import { analyzePhotoEvidence } from "@/lib/ai/service";
import { getManagerWorkspaceData, requireManagerContext } from "@/lib/manager-data";
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
    await requireManagerContext(supabase);
    const body = (await request.json()) as Record<string, unknown>;
    const mediaId = typeof body.mediaId === "string" ? body.mediaId : "";

    if (!mediaId) {
      return NextResponse.json({ error: "Media id is required." }, { status: 400 });
    }

    const mediaResult = await supabase
      .from("media")
      .select("*")
      .eq("id", mediaId)
      .single<Media>();

    assertNoError(mediaResult.error, "Media query failed");

    if (!mediaResult.data) {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }

    const data = await getManagerWorkspaceData();
    const media = mediaResult.data;
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
    const adminClient = createAdminClient();

    if (adminClient) {
      const persistResult = await adminClient
        .from("media")
        .update({
          ai_analysis: {
            ...analysis,
            analyzedAt: new Date().toISOString(),
          },
        })
        .eq("id", media.id);

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
