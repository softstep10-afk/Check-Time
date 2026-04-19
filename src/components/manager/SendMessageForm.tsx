"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import { FileText, Paperclip, Send, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import type { MessageAttachment, MessageColor } from "@/lib/message-types";

const COLOR_OPTIONS: MessageColor[] = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
];

const ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,application/pdf";
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

function classifyFile(file: File): "image" | "video" | "pdf" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "pdf";
}

export function SendMessageForm({
  orgId,
  senderId,
  recipientId,
  recipientName,
  onSent,
}: {
  orgId?: string;
  senderId?: string;
  recipientId: string;
  recipientName: string;
  onSent?: () => void;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [text, setText] = useState("");
  const [color, setColor] = useState<MessageColor>("#3b82f6");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  // Attachment state
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function handleFileSelect(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE) {
      setError(`File too large (max 50 MB)`);
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

    const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);

    return {
      url: urlData.publicUrl,
      filename: file.name,
      type: classifyFile(file),
      size: file.size,
    };
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

    if (AUTH_BYPASS_ENABLED || !orgId || !senderId) {
      // Preview mode — simulate send
      void attachment;
      await new Promise((resolve) => setTimeout(resolve, 300));
    } else {
      const { error: insertErr } = await supabase.from("messages").insert({
        org_id: orgId,
        sender_id: senderId,
        recipient_id: recipientId,
        text: text.trim(),
        color,
        attachment: attachment ? JSON.parse(JSON.stringify(attachment)) : null,
        metadata: {},
      });
      if (insertErr) {
        setError(insertErr.message);
        setSending(false);
        return;
      }
    }

    setSending(false);
    setSent(true);
    setText("");
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

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">{t("messages.color")}</span>
        {COLOR_OPTIONS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="h-5 w-5 rounded-full transition-transform"
            style={{
              background: c,
              transform: color === c ? "scale(1.3)" : "scale(1)",
              boxShadow: color === c ? `0 0 0 2px var(--bg-card), 0 0 0 3px ${c}` : "none",
            }}
            aria-label={c}
          />
        ))}
      </div>

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
          accept={ACCEPT}
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
