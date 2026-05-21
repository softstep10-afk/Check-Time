import type { SupabaseClient } from "@supabase/supabase-js";
import { createProjectPlanningId, type ProjectPlanningAttachment } from "@/lib/project-planning";
import { inferUploadContentType, validateUploadFile } from "@/lib/upload-limits";
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
  const validation = validateUploadFile(file);
  if (!validation.ok) {
    return validation.error.reason === "too_large"
      ? `too_large:${validation.error.limitMb}`
      : "unsupported_type";
  }
  return null;
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
  const contentType = inferUploadContentType(file);
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
