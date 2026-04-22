import type { SupabaseClient } from "@supabase/supabase-js";
import { validateUploadFile } from "@/lib/upload-limits";
import { guessMediaType, slugifyFilename } from "@/lib/worker-utils";

/**
 * Cloud-backed file pickers (Google Drive, iCloud, OneDrive) frequently
 * hand the browser a File whose `.type` is the empty string. Falling
 * back to the filename extension so Storage receives a real
 * Content-Type header instead of "application/octet-stream", which
 * many bucket configurations refuse outright.
 */
function inferContentType(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "application/octet-stream";
}

export type UploadAttachmentParams = {
  orgId: string;
  projectId: string;
  uploadedBy: string;
  file: File;
};

export type UploadAttachmentResult =
  | { ok: true; mediaId: string }
  | { ok: false; error: string };

/**
 * Upload a single file to the existing `media` storage bucket and insert
 * the corresponding `media` row, returning the new media.id. The caller
 * stores the returned id (along with others, for multi-file uploads) in
 * the task's `metadata.attachment_media_ids` jsonb array.
 *
 * Reuses the same upload+insert pattern proven to work for receipts and
 * worker journal photos. No schema, RLS, or bucket changes.
 */
export async function uploadTaskAttachment(
  supabase: SupabaseClient,
  { orgId, projectId, uploadedBy, file }: UploadAttachmentParams,
): Promise<UploadAttachmentResult> {
  // Heuristics that hint at local-picker vs cloud-picker (Google Drive,
  // OneDrive, iCloud, etc). The JS File API does not expose source,
  // but cloud-backed pickers usually leave file.type empty and may
  // strip the extension off file.name.
  const hasExtension = /\.[A-Za-z0-9]{2,5}$/.test(file.name);
  const ctor = (file as { constructor?: { name?: string } }).constructor?.name;
  console.log("[task-attach] upload start", {
    name: file.name,
    type: file.type,
    size: file.size,
    lastModified: file.lastModified,
    isFile: file instanceof File,
    isBlob: file instanceof Blob,
    constructor: ctor,
    hasExtension,
    mimeEmpty: file.type === "",
    orgId,
    projectId,
    uploadedBy,
  });

  const validation = validateUploadFile(file);
  if (!validation.ok) {
    console.error("[task-attach] validation REJECTED", {
      reason: validation.error.reason,
      // For unsupported_type, .mime holds whatever validateUploadFile
      // tried (file.type if non-empty, else file.name as fallback).
      attempted: "mime" in validation.error ? validation.error.mime : null,
      fileNameSeen: file.name,
      fileTypeSeen: file.type,
    });
    return { ok: false, error: `validation: ${validation.error.reason}` };
  }
  console.log("[task-attach] validation ok", { kind: validation.kind });

  const safeName = slugifyFilename(file.name || `attachment-${Date.now()}`);
  const storagePath = `${orgId}/${projectId}/tasks/${Date.now()}-${safeName}`;
  console.log("[task-attach] storage upload begin", { storagePath });

  const resolvedContentType = inferContentType(file);
  const { error: uploadErr } = await supabase.storage
    .from("media")
    .upload(storagePath, file, {
      upsert: false,
      cacheControl: "3600",
      contentType: resolvedContentType,
    });
  if (uploadErr) {
    console.error("[task-attach] storage upload FAIL", uploadErr);
    return { ok: false, error: `storage: ${uploadErr.message}` };
  }
  console.log("[task-attach] storage upload ok");

  const metadata = { kind: "task_attachment" as const };
  if (metadata.kind !== "task_attachment") {
    console.warn("[upload-guard] expected metadata.kind=task_attachment, got:", metadata);
  }
  const { data, error: insertErr } = await supabase
    .from("media")
    .insert({
      org_id: orgId,
      project_id: projectId,
      uploaded_by: uploadedBy,
      media_type: guessMediaType(file),
      storage_path: storagePath,
      filename: file.name,
      file_size: file.size,
      mime_type: resolvedContentType,
      caption: null,
      is_checkout: false,
      time_event_id: null,
      metadata,
    })
    .select("id")
    .single<{ id: string }>();

  if (insertErr || !data) {
    console.error("[task-attach] media insert FAIL", insertErr);
    return { ok: false, error: `media-insert: ${insertErr?.message ?? "no data"}` };
  }
  console.log("[task-attach] media insert ok", { mediaId: data.id });
  return { ok: true, mediaId: data.id };
}

/**
 * Best-effort reverse-link: stamp media rows with `metadata.task_id` so
 * orphan cleanup and later analytics can find a media row's parent task
 * without scanning the whole tasks table. Failures are swallowed — the
 * primary linkage (tasks.metadata.attachment_media_ids) is already in
 * place and is the source of truth for the UI.
 */
export async function linkMediaToTask(
  supabase: SupabaseClient,
  taskId: string,
  mediaIds: string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  console.log("[task-attach] linkMediaToTask start", { taskId, count: mediaIds.length });
  const { data: rows, error: selErr } = await supabase
    .from("media")
    .select("id, metadata")
    .in("id", mediaIds);
  if (selErr) {
    console.error("[task-attach] linkMediaToTask select FAIL", selErr);
    return;
  }
  for (const row of (rows ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null }>) {
    const meta = row.metadata ?? {};
    const { error: updErr } = await supabase
      .from("media")
      .update({ metadata: { ...meta, task_id: taskId } })
      .eq("id", row.id);
    if (updErr) console.error("[task-attach] linkMediaToTask update FAIL", { id: row.id, err: updErr });
  }
  console.log("[task-attach] linkMediaToTask done");
}

export type TaskAttachmentRef = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  media_type: string;
  storage_path: string;
};

/** Bulk fetch media rows by id; subject to the caller's media RLS. */
export async function fetchTaskAttachments(
  supabase: SupabaseClient,
  mediaIds: string[],
): Promise<Map<string, TaskAttachmentRef>> {
  if (mediaIds.length === 0) return new Map();
  const { data } = await supabase
    .from("media")
    .select("id, filename, mime_type, media_type, storage_path")
    .in("id", mediaIds);
  const map = new Map<string, TaskAttachmentRef>();
  for (const row of (data ?? []) as TaskAttachmentRef[]) {
    map.set(row.id, row);
  }
  return map;
}

/** Defensive read of attachment_media_ids from task.metadata. */
export function getAttachmentMediaIds(task: { metadata?: unknown }): string[] {
  const meta = task.metadata as Record<string, unknown> | null | undefined;
  const ids = meta?.attachment_media_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}
