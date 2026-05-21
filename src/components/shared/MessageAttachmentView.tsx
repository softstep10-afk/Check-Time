"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { FileText } from "lucide-react";
import { MediaViewerModal, type ViewerMediaItem } from "@/components/shared/MediaViewerModal";
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
  const [viewerItem, setViewerItem] = useState<ViewerMediaItem | null>(null);
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

  function attachmentToViewerItem(): ViewerMediaItem {
    const fallbackPath = attachment.storagePath || attachment.url || attachment.filename;
    const mediaType =
      attachment.type === "image"
        ? "photo"
        : attachment.type === "video"
          ? "video"
          : attachment.type === "pdf"
            ? "pdf"
            : "document";
    return {
      id: `message-attachment-${attachment.storagePath || attachment.url || attachment.filename}`,
      storage_path: fallbackPath,
      directUrl: attachment.storagePath ? null : resolvedUrl || attachment.url || null,
      filename: attachment.filename,
      mime_type:
        attachment.mimeType ??
        (attachment.type === "image"
          ? "image/*"
          : attachment.type === "video"
            ? "video/*"
            : attachment.type === "pdf"
              ? "application/pdf"
              : "application/octet-stream"),
      media_type: mediaType,
      metadata: resolvedUrl && !attachment.storagePath ? { direct_url: resolvedUrl } : null,
    };
  }

  function openViewer() {
    if (!resolvedUrl && !attachment.storagePath) return;
    setViewerItem(attachmentToViewerItem());
  }

  const viewer = (
    <MediaViewerModal
      item={viewerItem}
      onClose={() => setViewerItem(null)}
    />
  );

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
          onClick={openViewer}
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
        {viewer}
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
      <>
        <div
          role="button"
          tabIndex={0}
          onClick={openViewer}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openViewer();
            }
          }}
          className="mt-2 block w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)] text-left"
        >
          <video
            src={resolvedUrl}
            controls
            playsInline
            preload="metadata"
            className="max-h-[200px] w-full"
          />
        </div>
        {viewer}
      </>
    );
  }

  const fileTypeLabel = attachment.type === "pdf" ? "PDF" : "FILE";

  return (
    <>
      <button
        type="button"
        onClick={openViewer}
        className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2.5"
        style={{ background: "var(--bg-primary)" }}
      >
        <FileText
          size={18}
          className="shrink-0"
          style={{ color: attachment.type === "pdf" ? "var(--red)" : "var(--brand-yellow)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
            {attachment.filename}
          </div>
          <div className="text-[10px] text-[var(--text-muted)]">
            {fileTypeLabel} • {formatFileSize(attachment.size)}
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-[var(--brand-yellow)]">
          {t("messages.openFile")}
        </span>
      </button>
      {viewer}
    </>
  );
}
