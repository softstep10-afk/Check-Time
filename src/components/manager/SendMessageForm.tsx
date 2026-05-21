"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import {
  PRIORITY_COLOR,
  PRIORITY_EMOJI,
  type MessageAttachment,
  type MessagePriority,
} from "@/lib/message-types";
import { ACCEPT_ALL_UPLOADS, validateUploadFile } from "@/lib/upload-limits";

const PRIORITY_OPTIONS: MessagePriority[] = ["urgent", "info", "good", "task"];
type ProjectOption = { id: string; name: string; status?: string | null };

function classifyFile(file: File): "image" | "video" | "pdf" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "pdf";
}

export function SendMessageForm({
  orgId,
  senderId,
  senderName = "Manager",
  senderRole = "manager",
  recipientId,
  recipientName,
  projects = [],
  onSent,
}: {
  orgId?: string;
  senderId?: string;
  senderName?: string;
  senderRole?: string;
  recipientId: string;
  recipientName: string;
  projects?: ProjectOption[];
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("info");
  const color = PRIORITY_COLOR[priority];
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");

  // Attachment state
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function handleFileSelect(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    const validation = validateUploadFile(file);
    if (!validation.ok) {
      const error = validation.error;
      if (error.reason === "too_large") {
        const key =
          error.kind === "photo"
            ? "uploads.tooLargePhoto"
            : error.kind === "video"
              ? "uploads.tooLargeVideo"
              : "uploads.tooLargePdf";
        setError(t(key));
      } else {
        setError(t("uploads.unsupportedType").replace("{kind}", error.mime));
      }
      return;
    }

    setError("");
    setPendingFile(file);

    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  }

  function clearAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingFile(null);
    setPreviewUrl(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadFile(file: File): Promise<MessageAttachment | null> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `messages/${recipientId}/${Date.now()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from("media")
      .upload(path, file, { upsert: false, cacheControl: "3600" });

    if (uploadErr) {
      setError(t("messages.uploadFailed"));
      return null;
    }

    return {
      url: "",
      storagePath: path,
      filename: file.name,
      type: classifyFile(file),
      size: file.size,
    };
  }

  function buildTaskTitle(body: string, attachmentName?: string): string {
    const source = body || attachmentName || t("messages.priorityTask");
    return source.length > 140 ? `${source.slice(0, 137)}...` : source;
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() && !pendingFile) return;

    setSending(true);
    setError("");

    let attachment: MessageAttachment | null = null;

    if (pendingFile) {
      setUploading(true);
      attachment = await uploadFile(pendingFile);
      setUploading(false);

      if (!attachment) {
        setSending(false);
        return;
      }
    }

    if (!orgId || !senderId) {
      setError(t("messages.sendFailed"));
      setSending(false);
      return;
    }

    const basePayload = {
      org_id: orgId,
      sender_id: senderId,
      recipient_id: recipientId,
      text: text.trim(),
      color,
      attachment: attachment ? JSON.parse(JSON.stringify(attachment)) : null,
      metadata: { priority },
    };
    // priority column was added in migration 00014. Retry without it on the
    // off chance an older DB hasn't run the migration yet — cheap insurance.
    let messageId: string | null = null;
    let insertResult = await supabase
      .from("messages")
      .insert({ ...basePayload, priority })
      .select("id")
      .single<{ id: string }>();
    let insertErr = insertResult.error;
    if (insertErr && /column .* priority/i.test(insertErr.message)) {
      insertResult = await supabase
        .from("messages")
        .insert(basePayload)
        .select("id")
        .single<{ id: string }>();
      insertErr = insertResult.error;
    }
    if (!insertErr && insertResult.data?.id) {
      messageId = insertResult.data.id;
    }
    if (insertErr) {
      setError(insertErr.message);
      setSending(false);
      return;
    }

    if (priority === "task") {
      const body = text.trim();
      const taskTitle = buildTaskTitle(body, attachment?.filename);
      const { data: insertedTask, error: taskErr } = await supabase
        .from("tasks")
        .insert({
          org_id: orgId,
          project_id: taskProjectId || null,
          assigned_to: recipientId,
          assigned_by: senderId,
          title: taskTitle,
          description: body || null,
          priority: "medium",
          status: "pending",
          due_date: null,
          metadata: {
            source: "message_task",
            message_id: messageId,
            recipient_id: recipientId,
            attachment_filename: attachment?.filename ?? null,
          },
        })
        .select("id")
        .single<{ id: string }>();

      if (taskErr || !insertedTask) {
        setError(
          t("messages.taskCreateFailed").replace(
            "{error}",
            taskErr?.message ?? t("common.errorTryAgain"),
          ),
        );
        setSending(false);
        return;
      }

      void logAudit({
        orgId,
        actorId: senderId,
        actorName: senderName,
        actorRole: senderRole,
        action: "task_created_from_message",
        targetType: "task",
        targetId: insertedTask.id,
        beforeData: null,
        afterData: {
          title: taskTitle,
          project_id: taskProjectId || null,
          assigned_to: recipientId,
          message_id: messageId,
        },
      });
    }

    setSending(false);
    setSent(true);
    setText("");
    setTaskProjectId("");
    clearAttachment();
    onSent?.();
    setTimeout(() => setSent(false), 2000);
  }

  const fileType = pendingFile ? classifyFile(pendingFile) : null;

  return (
    <div className="space-y-3">
      <div className="text-sm text-[var(--text-secondary)]">
        {t("messages.send")} → <span className="font-semibold text-[var(--text-primary)]">{recipientName}</span>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
          {t("messages.priority")}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PRIORITY_OPTIONS.map((p) => {
            const accent = PRIORITY_COLOR[p];
            const selected = priority === p;
            const labelKey = (
              p === "urgent"
                ? "messages.priorityUrgent"
                : p === "info"
                  ? "messages.priorityInfo"
                  : p === "good"
                    ? "messages.priorityGood"
                    : "messages.priorityTask"
            ) as Parameters<typeof t>[0];
            return (
              <label
                key={p}
                className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-xs font-semibold"
                style={{
                  borderColor: selected ? accent : "var(--border-default)",
                  background: selected ? `${accent}1f` : "transparent",
                  color: selected ? accent : "var(--text-secondary)",
                }}
              >
                <input
                  type="radio"
                  name="priority"
                  value={p}
                  checked={selected}
                  onChange={() => setPriority(p)}
                  className="sr-only"
                />
                <span aria-hidden>{PRIORITY_EMOJI[p]}</span>
                <span>{t(labelKey)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {priority === "task" && projects.length > 0 ? (
        <label className="block space-y-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
            {t("messages.taskProject")}
          </span>
          <select
            value={taskProjectId}
            onChange={(event) => setTaskProjectId(event.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("messages.taskProjectNone")}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Attachment preview */}
      {pendingFile ? (
        <div
          className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)]"
          style={{ background: "var(--bg-primary)" }}
        >
          {fileType === "image" && previewUrl ? (
            <Image
              src={previewUrl}
              alt={pendingFile.name}
              width={320}
              height={180}
              unoptimized
              className="h-auto max-h-[180px] w-full object-cover"
            />
          ) : fileType === "video" && previewUrl ? (
            <video
              src={previewUrl}
              muted
              playsInline
              className="max-h-[180px] w-full"
            />
          ) : (
            <div className="flex items-center gap-2 p-3">
              <FileText size={20} className="shrink-0 text-[var(--red)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {pendingFile.name}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {(pendingFile.size / 1024).toFixed(0)} KB
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={clearAttachment}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full"
            style={{ background: "rgba(0,0,0,0.6)", color: "white" }}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ALL_UPLOADS}
          onChange={(e) => handleFileSelect(e.target.files)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)]"
          style={{ color: pendingFile ? "var(--brand-yellow)" : "var(--text-muted)" }}
          title={t("messages.attach")}
        >
          <Paperclip size={16} />
        </button>
        <TextInputWithVoice
          name="msg-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("messages.placeholder")}
          className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        />
        <button
          type="submit"
          disabled={sending || (!text.trim() && !pendingFile)}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[var(--radius-md)]"
          style={{
            background: sending ? "var(--border-default)" : color,
            color: "white",
          }}
        >
          <Send size={16} />
        </button>
      </form>

      {uploading ? (
        <div className="text-xs font-semibold text-[var(--brand-yellow)]">
          {t("messages.uploading")}
        </div>
      ) : null}

      {error ? (
        <div className="text-xs font-semibold" style={{ color: "var(--red)" }}>
          {error}
        </div>
      ) : null}

      {sent ? (
        <div className="text-xs font-semibold" style={{ color: "var(--green)" }}>
          {t("messages.sent")}
        </div>
      ) : null}
    </div>
  );
}
