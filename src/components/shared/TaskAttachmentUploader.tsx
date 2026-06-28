"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  uploadTaskAttachment,
  type TaskAttachmentRef,
} from "@/lib/task-attachments";
import { useTranslation } from "@/lib/i18n";
import { validateUploadFile } from "@/lib/upload-limits";
import { UploadSourceButtons } from "@/components/shared/UploadSourceButtons";

type TaskAttachmentUploaderProps = {
  taskId: string;
  orgId: string;
  projectId: string | null;
  uploadedBy: string;
  disabled?: boolean;
  compact?: boolean;
  onAttached?: (payload: {
    taskId: string;
    metadata: Record<string, unknown> | null;
    attachments: TaskAttachmentRef[];
  }) => void;
};

export function TaskAttachmentUploader({
  taskId,
  orgId,
  projectId,
  uploadedBy,
  disabled = false,
  compact = false,
  onAttached,
}: TaskAttachmentUploaderProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"success" | "error" | "info">("info");

  async function handleFiles(files: FileList | null) {
    const list = Array.from(files ?? []);
    if (list.length === 0) return;

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setMessage(t("tasks.attachmentNeedsConnection"));
      setTone("error");
      return;
    }

    for (const file of list) {
      if (!file || file.size === 0) {
        setMessage(t("tasks.attachmentCloudFallback"));
        setTone("error");
        return;
      }
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const attempted = "mime" in validation.error ? validation.error.mime : file.name;
        setMessage(t("uploads.unsupportedType").replace("{kind}", attempted ?? file.name));
        setTone("error");
        return;
      }
    }

    setBusy(true);
    setMessage(t("tasks.uploadingAttachment"));
    setTone("info");
    const supabase = createClient();
    const uploadedIds: string[] = [];
    try {
      for (const file of list) {
        const result = await uploadTaskAttachment(supabase, {
          orgId,
          projectId,
          uploadedBy,
          file,
        });
        if (!result.ok) {
          throw new Error(result.error);
        }
        uploadedIds.push(result.mediaId);
      }

      const response = await fetch(`/api/tasks/${taskId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentMediaIds: uploadedIds }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        task?: { id: string; metadata: Record<string, unknown> | null };
        attachments?: TaskAttachmentRef[];
      };
      if (!response.ok || !payload.task?.id) {
        throw new Error(payload.error ?? t("tasks.attachmentUploadFailed"));
      }

      setMessage(
        t("tasks.attachmentsAdded").replace("{count}", String(payload.attachments?.length ?? list.length)),
      );
      setTone("success");
      onAttached?.({
        taskId: payload.task.id,
        metadata: payload.task.metadata ?? null,
        attachments: payload.attachments ?? [],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("tasks.attachmentUploadFailed"));
      setTone("error");
    } finally {
      setBusy(false);
    }
  }

  const toneClass =
    tone === "success"
      ? "text-[var(--green)]"
      : tone === "error"
        ? "text-[var(--red)]"
        : "text-[var(--text-muted)]";

  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <UploadSourceButtons
        onFiles={(files) => void handleFiles(files)}
        disabled={disabled || busy}
        dataTestIdPrefix="task-attachment-upload"
        className="grid grid-cols-3 gap-2 sm:inline-grid"
      />
      <div className="mt-1 text-[10px] text-[var(--text-muted)]">
        {t("tasks.attachmentInlineLabel")}
      </div>
      {message ? (
        <div
          className={`mt-1 text-[11px] font-semibold ${toneClass}`}
          data-testid="task-attachment-upload-message"
          role={tone === "error" ? "alert" : "status"}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
