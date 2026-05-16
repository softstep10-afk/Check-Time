import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectPlanningId, type ProjectPlanningAttachment } from "@/lib/project-planning";
import { guessMediaType, slugifyFilename } from "@/lib/worker-utils";

type UploadPlanningAttachmentParams = {
  orgId: string;
  projectId: string;
  uploadedBy: string;
  file: File;
};

type UploadPlanningAttachmentResult =
  | { ok: true; attachment: ProjectPlanningAttachment }
  | { ok: false; error: string };

function validatePlanningFile(file: File): string | null {
  const lower = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  const knownType =
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type === "application/pdf" ||
    type === "text/csv" ||
    type === "text/plain" ||
    type === "application/vnd.ms-excel" ||
    type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    type === "application/msword" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const knownExtension = /\.(pdf|csv|tsv|txt|xlsx?|docx?|jpe?g|png|webp|heic|heif|gif|mp4|mov|webm)$/i.test(lower);
  if (!knownType && !knownExtension) return "unsupported_type";

  const limitMb = type.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(lower) ? 500 : 100;
  const sizeMb = file.size / (1024 * 1024);
  return sizeMb > limitMb ? `too_large:${limitMb}` : null;
}

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
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

export async function uploadProjectPlanningAttachment(
  supabase: SupabaseClient,
  { orgId, projectId, uploadedBy, file }: UploadPlanningAttachmentParams,
): Promise<UploadPlanningAttachmentResult> {
  const validationError = validatePlanningFile(file);
  if (validationError) {
    return { ok: false, error: `validation: ${validationError}` };
  }

  const safeName = slugifyFilename(file.name || `planning-${Date.now()}`);
  const storagePath = `${orgId}/${projectId}/planning/${Date.now()}-${safeName}`;
  const contentType = inferContentType(file);
  const { error: uploadError } = await supabase.storage
    .from("media")
    .upload(storagePath, file, {
      upsert: false,
      cacheControl: "3600",
      contentType,
    });

  if (uploadError) {
    return { ok: false, error: `storage: ${uploadError.message}` };
  }

  const { data, error: insertError } = await supabase
    .from("media")
    .insert({
      org_id: orgId,
      project_id: projectId,
      uploaded_by: uploadedBy,
      media_type: guessMediaType(file),
      storage_path: storagePath,
      filename: file.name,
      file_size: file.size,
      mime_type: contentType,
      caption: null,
      is_checkout: false,
      time_event_id: null,
      metadata: { kind: "project_planning_attachment" },
    })
    .select("id")
    .single<{ id: string }>();

  if (insertError || !data) {
    return { ok: false, error: `media-insert: ${insertError?.message ?? "no data"}` };
  }

  return {
    ok: true,
    attachment: {
      id: createProjectPlanningId("att"),
      name: file.name || "Project planning file",
      url: "",
      kind: "file",
      note: "",
      mediaId: data.id,
      storagePath,
      fileName: file.name,
      mimeType: contentType,
      createdAt: new Date().toISOString(),
    },
  };
}
