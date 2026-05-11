"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Film, Image as ImageIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeStoragePath, type TaskAttachmentRef } from "@/lib/task-attachments";
import { MediaViewerModal, useMediaViewerOpenGuard } from "@/components/shared/MediaViewerModal";

function FileIcon({
  mediaType,
  className,
}: {
  mediaType: string;
  className?: string;
}) {
  if (mediaType === "photo") return <ImageIcon size={28} className={className} />;
  if (mediaType === "video") return <Film size={28} className={className} />;
  if (mediaType === "pdf" || mediaType === "document") {
    return <FileText size={28} className={className} />;
  }
  return <Paperclip size={28} className={className} />;
}

function typeLabel(mediaType: string): string {
  if (mediaType === "photo") return "Image";
  if (mediaType === "video") return "Video";
  if (mediaType === "pdf") return "PDF";
  if (mediaType === "document") return "Doc";
  return "File";
}

export function TaskAttachmentList({
  items,
}: {
  items: TaskAttachmentRef[];
}) {
  const [openError, setOpenError] = useState<string | null>(null);
  // Selected tile drives the in-app modal viewer. Primary tile click no
  // longer opens a new browser tab — the spec calls that behaviour out
  // explicitly. Download remains as the fallback corner button.
  const [viewerItem, setViewerItem] = useState<TaskAttachmentRef | null>(null);
  const { canOpenViewerItem, suppressViewerItem } = useMediaViewerOpenGuard();
  const supabase = useMemo(() => createClient(), []);
  // Eagerly batch-sign image paths so the worker/manager sees real
  // thumbnails instead of an icon placeholder. Videos and PDFs would
  // need a separate poster-frame pipeline; for them we keep an icon
  // tile. One batch call per attachment list mount, regardless of how
  // many photos.
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;
    const photos = items.filter((item) => item.media_type === "photo");
    if (photos.length === 0) return;
    let cancelled = false;
    void (async () => {
      const paths = photos.map((item) => normalizeStoragePath(item.storage_path));
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next = new Map<string, string>();
      for (let i = 0; i < photos.length; i++) {
        const url = data[i]?.signedUrl;
        if (url) next.set(photos[i].id, url);
      }
      setThumbUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items, supabase]);

  if (items.length === 0) return null;

  // Primary tile click — opens the in-app modal viewer. The viewer
  // signs its own URL and renders the file inline (img / video / iframe)
  // with a Download fallback for HEVC / .mov / browser-unsupported
  // encodings. Replaces the prior "open about:blank then redirect"
  // pattern that the spec asked us to drop.
  function open(item: TaskAttachmentRef) {
    if (!canOpenViewerItem(item.id)) return;
    setOpenError(null);
    setViewerItem(item);
  }

  function closeViewer() {
    const itemId = viewerItem?.id;
    setViewerItem(null);
    suppressViewerItem(itemId);
  }

  async function download(item: TaskAttachmentRef) {
    if (typeof window === "undefined") return;
    const normalized = normalizeStoragePath(item.storage_path);
    const fallbackName = normalized.split("/").pop() ?? "download";
    const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600, { download: downloadAs });
    if (error || !data?.signedUrl) {
      console.error("[task-attach] failed to sign URL for download", error);
      setOpenError(
        item.filename
          ? `Could not download ${item.filename}.`
          : "Could not download file.",
      );
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = downloadAs;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <div className="mt-2 space-y-2">
      {openError ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[11px] font-semibold"
          style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
        >
          {openError}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const thumbUrl = thumbUrls.get(item.id);
          const label = item.filename ?? item.id.slice(0, 8);
          return (
            // Outer wrapper is a positioning <div>, not a button, so the
            // tile-open and tile-download actions can be sibling
            // <button>s. Nesting one button inside another would be
            // invalid HTML and lose the corner-icon click on Safari.
            <div
              key={item.id}
              className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-primary)",
              }}
            >
              <button
                type="button"
                onClick={() => open(item)}
                title={label}
                aria-label={`Open ${label}`}
                data-testid="task-attachment-tile"
                className="absolute inset-0 block w-full text-left"
              >
                {item.media_type === "photo" && thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt={label}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                    <FileIcon
                      mediaType={item.media_type}
                      className="text-[var(--brand-yellow)]"
                    />
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                      {typeLabel(item.media_type)}
                    </span>
                  </div>
                )}
                <div
                  className="absolute inset-x-0 bottom-0 px-1.5 py-1 pr-7"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)",
                  }}
                >
                  <div className="truncate text-[10px] font-medium text-white">
                    {label}
                  </div>
                </div>
              </button>
              {/* Download corner button — explicit fallback when the
                  browser cannot decode the original (HEIC, HEVC .mov,
                  etc) or the popup-tab open is blocked. Sits on top of
                  the open button via z-index, not inside it. */}
              <button
                type="button"
                onClick={() => void download(item)}
                title={`Download ${label}`}
                aria-label={`Download ${label}`}
                className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{
                  borderColor: "rgba(255, 255, 255, 0.35)",
                  background: "rgba(0, 0, 0, 0.55)",
                  color: "white",
                  zIndex: 1,
                }}
              >
                <Download size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <MediaViewerModal
        item={
          viewerItem
            ? {
                id: viewerItem.id,
                storage_path: viewerItem.storage_path,
                filename: viewerItem.filename,
                mime_type: viewerItem.mime_type,
                media_type: viewerItem.media_type,
              }
            : null
        }
        onClose={closeViewer}
      />
    </div>
  );
}
