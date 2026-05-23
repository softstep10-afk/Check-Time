import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { readOptionalUuid, readUuidArray } from "@/lib/server/id-guards";
import { TaskDispatchError } from "@/lib/server/task-dispatch";

type MediaAttachmentRow = {
  id: string;
  org_id: string;
  project_id: string | null;
  deleted_at: string | null;
};

export async function assertTaskAttachmentMediaTargets(
  adminClient: Pick<SupabaseClient, "from">,
  {
    orgId,
    projectId,
    mediaIds,
  }: {
    orgId: string;
    projectId: string | null;
    mediaIds: string[];
  },
): Promise<string[]> {
  const projectIdResult = readOptionalUuid(projectId, "project id");
  if (!projectIdResult.ok) {
    throw new TaskDispatchError(projectIdResult.error, projectIdResult.status);
  }
  const mediaIdResult = readUuidArray(mediaIds, {
    label: "attachment media id",
    limit: 50,
  });
  if (!mediaIdResult.ok) {
    throw new TaskDispatchError(mediaIdResult.error, mediaIdResult.status);
  }
  const ids = mediaIdResult.value;
  if (ids.length === 0) return [];

  const { data, error } = await adminClient
    .from("media")
    .select("id, org_id, project_id, deleted_at")
    .in("id", ids);

  if (error) {
    throw new TaskDispatchError("Attachment validation failed.", 500);
  }

  const rows = (data ?? []) as MediaAttachmentRow[];
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const allPresent = ids.every((id) => rowsById.has(id));
  const allSameOrg = rows.every((row) => row.org_id === orgId && !row.deleted_at);
  const allSameProject =
    !projectIdResult.value ||
    rows.every((row) => !row.project_id || row.project_id === projectIdResult.value);

  if (!allPresent || !allSameOrg || !allSameProject) {
    throw new TaskDispatchError("Attachment is not available.", 404);
  }

  return ids;
}
