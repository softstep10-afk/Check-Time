import { NextResponse } from "next/server";
import { readRequiredUuid } from "@/lib/server/id-guards";
import { softDeleteMediaForActor } from "@/lib/server/media-delete";
import {
  canDeleteMediaEverywhereServer,
  getConfiguredMediaDeleteProfileIds,
} from "@/lib/server/media-delete-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

type MediaDeleteProfile = Pick<Profile, "id" | "name" | "role" | "org_id">;

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const mediaId = readRequiredUuid(rawId, "media id");
  if (!mediaId.ok) {
    return NextResponse.json({ error: mediaId.error }, { status: mediaId.status });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, role, org_id")
    .eq("id", user.id)
    .maybeSingle<MediaDeleteProfile>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 403 });
  }

  if (!canDeleteMediaEverywhereServer(profile)) {
    return NextResponse.json(
      { error: "Only Andrey and Sergey can delete media." },
      { status: 403 },
    );
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Media deletion is temporarily unavailable." },
      { status: 503 },
    );
  }

  const result = await softDeleteMediaForActor({
    adminClient,
    actorProfile: profile,
    mediaId: mediaId.value,
    allowedProfileIds: getConfiguredMediaDeleteProfileIds(),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    mediaId: result.mediaId,
    deletedAt: result.deletedAt,
    alreadyDeleted: result.alreadyDeleted,
  });
}
