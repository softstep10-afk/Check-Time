"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import {
  PRIORITY_COLOR,
  PRIORITY_EMOJI,
  type MessageAttachment,
  type MessagePriority,
} from "@/lib/message-types";
import { isTaskMessagePriority } from "@/lib/message-state";
import { buildSafeUploadName } from "@/lib/media-extension";
import {
  ACCEPT_ALL_UPLOADS,
  inferUploadContentType,
  validateUploadFile,
} from "@/lib/upload-limits";
import {
  OFFLINE_FIELD_ACTIONS_CHANGED_EVENT,
  createOfflineFieldActionId,
  isNetworkLikeFieldError,
  loadOfflineFieldActionQueue,
  markOfflineFieldActionStatus,
  queueOfflineFieldAction,
  removeOfflineFieldAction,
} from "@/lib/offline-field-actions";

const PRIORITY_OPTIONS: MessagePriority[] = ["urgent", "info", "good", "task"];
type ProjectOption = { id: string; name: string; status?: string | null };

function classifyFile(file: File): MessageAttachment["type"] {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const lower = file.name.toLowerCase();
  if (file.type === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  return "document";
}

export function SendMessageForm({
  orgId,
  senderId,
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
  const [queued, setQueued] = useState(false);
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
              : error.kind === "pdf"
                ? "uploads.tooLargePdf"
                : "uploads.tooLargeDocument";
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
    const safeName = buildSafeUploadName(file, "message");
    const displayName = file.name || safeName;
    const path = `messages/${recipientId}/${Date.now()}-${safeName}`;

    const { error: uploadErr } = await supabase.storage
      .from("media")
      .upload(path, file, {
        upsert: false,
        cacheControl: "3600",
        contentType: inferUploadContentType(file),
      });

    if (uploadErr) {
      setError(t("messages.uploadFailed"));
      return null;
    }

    return {
      url: "",
      storagePath: path,
      filename: displayName,
      type: classifyFile(file),
      mimeType: inferUploadContentType(file),
      size: file.size,
    };
  }

  const buildTaskTitle = useCallback((body: string, attachmentName?: string): string => {
    const source = body || attachmentName || t("messages.priorityTask");
    return source.length > 140 ? `${source.slice(0, 137)}...` : source;
  }, [t]);

  const syncQueuedMessages = useCallback(async () => {
    if (!senderId) return;
    const items = loadOfflineFieldActionQueue().filter(
      (item) => item.kind === "message_send" && item.actorId === senderId && item.status !== "failed",
    );
    if (items.length === 0) return;
    setQueued(true);

    for (const item of items) {
      if (item.kind !== "message_send") continue;
      markOfflineFieldActionStatus(item.id, {
        status: "syncing",
        lastAttemptAt: new Date().toISOString(),
      });
      try {
        const { data: existingMessages } = await supabase
          .from("messages")
          .select("id, recipient_id")
          .eq("sender_id", senderId)
          .filter("metadata->>client_action_id", "eq", item.clientActionId);
        let syncedMessages = (existingMessages ?? []) as Array<{ id: string; recipient_id: string }>;
        if (syncedMessages.length < item.payload.rows.length) {
          let result = await supabase
            .from("messages")
            .insert(item.payload.rows)
            .select("id, recipient_id");
          let insertErr = result.error;
          if (insertErr && /column .* priority/i.test(insertErr.message)) {
            const fallbackRows = item.payload.rows.map((row) => ({
              org_id: row.org_id,
              sender_id: row.sender_id,
              recipient_id: row.recipient_id,
              text: row.text,
              color: row.color,
              attachment: row.attachment,
              metadata: row.metadata,
            }));
            result = await supabase
              .from("messages")
              .insert(fallbackRows)
              .select("id, recipient_id");
            insertErr = result.error;
          }
          if (insertErr) throw new Error(insertErr.message);
          syncedMessages = (result.data ?? []) as Array<{ id: string; recipient_id: string }>;
        }

        if (item.payload.taskSource === "direct_task" && syncedMessages[0]) {
          const row = item.payload.rows[0];
          const taskTitle = buildTaskTitle(row?.text ?? "");
          const response = await fetch("/api/manager/message-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              priority: item.payload.priority,
              items: [
                {
                  messageId: syncedMessages[0].id,
                  recipientId,
                  title: taskTitle,
                  description: row?.text || null,
                  projectId: item.payload.taskProjectId || null,
                  attachmentFilename: null,
                  source: "message_task",
                },
              ],
            }),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? t("messages.taskCreateFailed"));
          }
        }

        if (item.payload.taskSource === "broadcast_task" && syncedMessages.length > 0) {
          const row = item.payload.rows[0];
          const taskTitle = buildTaskTitle(row?.text ?? "");
          const response = await fetch("/api/manager/message-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              priority: item.payload.priority,
              items: syncedMessages.map((message) => ({
                messageId: message.id,
                recipientId: message.recipient_id,
                title: taskTitle,
                description: row?.text || null,
                projectId: item.payload.taskProjectId || null,
                source: "broadcast_task",
              })),
            }),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? t("messages.taskCreateFailed"));
          }
        }

        removeOfflineFieldAction(item.id);
        setQueued(false);
        setSent(true);
        onSent?.();
        setTimeout(() => setSent(false), 2000);
      } catch (error) {
        const message = error instanceof Error ? error.message : t("messages.sendFailed");
        markOfflineFieldActionStatus(item.id, {
          status: isNetworkLikeFieldError(error) ? "pending" : "failed",
          retryCount: item.retryCount + 1,
          lastErrorMessage: message,
        });
        if (!isNetworkLikeFieldError(error)) {
          setError(message);
          setQueued(false);
        }
      }
    }
  }, [buildTaskTitle, onSent, recipientId, senderId, supabase, t]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function drainIfOnline() {
      if (window.navigator.onLine) void syncQueuedMessages();
    }
    drainIfOnline();
    window.addEventListener("online", drainIfOnline);
    window.addEventListener(OFFLINE_FIELD_ACTIONS_CHANGED_EVENT, drainIfOnline);
    return () => {
      window.removeEventListener("online", drainIfOnline);
      window.removeEventListener(OFFLINE_FIELD_ACTIONS_CHANGED_EVENT, drainIfOnline);
    };
  }, [syncQueuedMessages]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim() && !pendingFile) return;

    setSending(true);
    setError("");
    setQueued(false);

    let attachment: MessageAttachment | null = null;

    if (typeof window !== "undefined" && !window.navigator.onLine) {
      if (pendingFile) {
        setError(t("messages.attachmentNeedsConnection"));
        setSending(false);
        return;
      }
      if (!orgId || !senderId) {
        setError(t("messages.sendFailed"));
        setSending(false);
        return;
      }
      const clientActionId = createOfflineFieldActionId("message-send");
      const basePayload = {
        org_id: orgId,
        sender_id: senderId,
        recipient_id: recipientId,
        text: text.trim(),
        color,
        priority,
        attachment: null,
        metadata: { priority, client_action_id: clientActionId, queued_offline: true },
      };
      queueOfflineFieldAction({
        clientActionId,
        dedupeKey: `message_send:${senderId}:${recipientId}:${clientActionId}`,
        kind: "message_send",
        actorId: senderId,
        orgId,
        payload: {
          rows: [basePayload],
          priority,
          taskProjectId: taskProjectId || null,
          taskSource: isTaskMessagePriority(priority) ? "direct_task" : null,
        },
      });
      setSending(false);
      setQueued(true);
      setText("");
      setTaskProjectId("");
      clearAttachment();
      return;
    }

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
      if (isNetworkLikeFieldError(insertErr) && !pendingFile && orgId && senderId) {
        const clientActionId = createOfflineFieldActionId("message-send");
        queueOfflineFieldAction({
          clientActionId,
          dedupeKey: `message_send:${senderId}:${recipientId}:${clientActionId}`,
          kind: "message_send",
          actorId: senderId,
          orgId,
          payload: {
            rows: [
              {
                ...basePayload,
                priority,
                metadata: {
                  ...basePayload.metadata,
                  client_action_id: clientActionId,
                  queued_offline: true,
                },
              },
            ],
            priority,
            taskProjectId: taskProjectId || null,
            taskSource: isTaskMessagePriority(priority) ? "direct_task" : null,
          },
        });
        setQueued(true);
        setText("");
        setTaskProjectId("");
        clearAttachment();
        setSending(false);
        return;
      }
      setError(insertErr.message);
      setSending(false);
      return;
    }

    if (isTaskMessagePriority(priority)) {
      const body = text.trim();
      const taskTitle = buildTaskTitle(body, attachment?.filename);
      const taskResponse = await fetch("/api/manager/message-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority,
          items: [
            {
              messageId,
              recipientId,
              title: taskTitle,
              description: body || null,
              projectId: taskProjectId || null,
              attachmentFilename: attachment?.filename ?? null,
              source: "message_task",
            },
          ],
        }),
      });
      const taskResult = (await taskResponse.json().catch(() => ({}))) as {
        error?: string;
        tasks?: Array<{ id: string }>;
      };

      if (!taskResponse.ok || !taskResult.tasks?.[0]?.id) {
        setError(
          t("messages.taskCreateFailed").replace(
            "{error}",
            taskResult.error ?? t("common.errorTryAgain"),
          ),
        );
        setSending(false);
        return;
      }
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

      {queued ? (
        <div className="text-xs font-semibold" style={{ color: "#f59e0b" }}>
          {t("messages.queued")}
        </div>
      ) : null}
    </div>
  );
}
