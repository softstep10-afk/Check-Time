"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { FileText, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { normalizeStoragePath } from "@/lib/task-attachments";
import type { MessageAttachment } from "@/lib/message-types";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachmentView({
  attachment,
}: {
  attachment: MessageAttachment;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [lightbox, setLightbox] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(attachment.url);

  useEffect(() => {
    let cancelled = false;
    async function resolveUrl() {
      if (!attachment.storagePath) {
        setResolvedUrl(attachment.url);
        return;
      }
      const normalized = normalizeStoragePath(attachment.storagePath);
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(normalized, 3600);
      if (!cancelled) {
        setResolvedUrl(error || !data?.signedUrl ? attachment.url : data.signedUrl);
      }
    }
    void resolveUrl();
    return () => {
      cancelled = true;
    };
  }, [attachment.storagePath, attachment.url, supabase]);

  if (attachment.type === "image") {
    if (!resolvedUrl) {
      return (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2 text-xs text-[var(--text-secondary)]">
          {attachment.filename}
        </div>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={() => setLightbox(true)}
          className="mt-2 block overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)]"
        >
          <Image
            src={resolvedUrl}
            alt={attachment.filename}
            width={240}
            height={160}
            unoptimized
            className="h-auto max-h-[160px] w-full object-cover"
          />
        </button>
        {lightbox ? (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setLightbox(false)}
          >
            <button
              type="button"
              onClick={() => setLightbox(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <X size={18} />
            </button>
            <Image
              src={resolvedUrl}
              alt={attachment.filename}
              width={1200}
              height={800}
              unoptimized
              className="max-h-[85vh] max-w-[90vw] rounded-[var(--radius-lg)] object-contain"
            />
          </div>
        ) : null}
      </>
    );
  }

  if (attachment.type === "video") {
    if (!resolvedUrl) {
      return (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2 text-xs text-[var(--text-secondary)]">
          {attachment.filename}
        </div>
      );
    }
    return (
      <video
        src={resolvedUrl}
        controls
        playsInline
        preload="metadata"
        className="mt-2 max-h-[200px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)]"
      />
    );
  }

  // PDF
  return (
    <a
      href={resolvedUrl || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2.5"
      style={{ background: "var(--bg-primary)" }}
    >
      <FileText size={18} className="shrink-0 text-[var(--red)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
          {attachment.filename}
        </div>
        <div className="text-[10px] text-[var(--text-muted)]">
          PDF • {formatFileSize(attachment.size)}
        </div>
      </div>
      <span className="shrink-0 text-[10px] font-semibold text-[var(--brand-yellow)]">
        {t("messages.openFile")}
      </span>
    </a>
  );
}
