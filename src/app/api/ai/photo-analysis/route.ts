import { NextRequest, NextResponse } from "next/server";
import { analyzePhotoEvidence } from "@/lib/ai/service";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createPaidApiLimitGuard,
  isPaidApiLimitError,
  paidApiLimitResponse,
} from "@/lib/paid-api-limits";
import { safeClientErrorMessage } from "@/lib/safe-log";
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
    const mediaId = readRequiredUuid(body.mediaId, "media id");

    if (!mediaId.ok) {
      return NextResponse.json({ error: mediaId.error }, { status: mediaId.status });
    }

    let media: Media | null = null;
    if (auth.kind === "preview") {
      media = auth.managerData.media.find((item) => item.id === mediaId.value) ?? null;
    } else {
      const mediaResult = await supabase
        .from("media")
        .select("*")
        .eq("id", mediaId.value)
        .single<Media>();

      assertNoError(mediaResult.error, "Media query failed");
      media = mediaResult.data ?? null;
    }

    if (!media) {
      return NextResponse.json({ error: "Media not found." }, { status: 404 });
    }
    if (auth.kind === "authenticated" && media.org_id !== auth.context.profile.org_id) {
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
    const adminClient = auth.kind === "authenticated" ? createAdminClient() : null;
    const limitIdentity = auth.kind === "authenticated"
      ? {
          orgId: auth.context.profile.org_id,
          profileId: auth.context.profile.id,
        }
      : {
          orgId: data.org.id,
          profileId: data.manager.id,
        };
    const analysis = await analyzePhotoEvidence({
      mediaId: media.id,
      mediaType: media.media_type,
      filename: media.filename ?? media.media_type,
      caption: media.caption ?? "",
      isCheckout: media.is_checkout,
      projectName,
      createdAt: media.created_at,
      relatedTasks,
    }, {
      beforeProviderCall: createPaidApiLimitGuard({
        adminClient,
        route: "/api/ai/photo-analysis",
        ...limitIdentity,
      }),
    });

    let persisted = false;
    // Wave X2 (00011_media_project_privacy.sql) note: this route uses
    // the admin client to persist ai_analysis back, which bypasses RLS.
    // That's safe here because requireManagerContext() above already
    // gated the request to manager / admin / owner — workers cannot
    // call this endpoint and trigger an analyze on a foreign-project
    // media row.
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
    if (isPaidApiLimitError(error)) {
      return paidApiLimitResponse(error.result);
    }
    return NextResponse.json({ error: safeClientErrorMessage(error) }, { status: 500 });
  }
}
