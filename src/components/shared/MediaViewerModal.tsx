"use client";

/**
 * Single-item in-app media viewer.
 *
 * Used as the *primary* click target for any photo / video / PDF tile
 * in the app — replaces the legacy "open a new browser tab + sign URL"
 * pattern. The Download button is preserved as the fallback for HEVC /
 * .mov / browser-unsupported encodings.
 *
 * The multi-item variant lives inside MediaGalleryDrawer (with
 * prev/next neighbour navigation). This component is the simpler
 * sibling: one item in, one modal out, no list traversal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import {
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Paperclip,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { selectMediaPlayback } from "@/lib/media-playback";
import { normalizeStoragePath } from "@/lib/task-attachments";

export interface ViewerMediaItem {
  id: string;
  storage_path: string;
  directUrl?: string | null;
  filename: string | null;
  mime_type: string | null;
  media_type: string;
  caption?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Pre-resolved project name for the header strip. */
  projectName?: string | null;
  /** Pre-resolved uploader name for the header strip. */
  uploaderName?: string | null;
}

const DEFAULT_VIEWER_REOPEN_SUPPRESSION_MS = 350;

export function useMediaViewerOpenGuard({
  suppressionMs = DEFAULT_VIEWER_REOPEN_SUPPRESSION_MS,
}: {
  suppressionMs?: number;
} = {}) {
  const recentlyClosedRef = useRef<{
    id: string;
    until: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const clearSuppression = useCallback(() => {
    const current = recentlyClosedRef.current;
    if (current) {
      clearTimeout(current.timer);
      recentlyClosedRef.current = null;
    }
  }, []);

  const suppressViewerItem = useCallback((itemId: string | null | undefined) => {
    if (!itemId) return;

    clearSuppression();
    const until = Date.now() + suppressionMs;
    const timer = setTimeout(() => {
      const current = recentlyClosedRef.current;
      if (current?.id === itemId && current.until <= Date.now()) {
        recentlyClosedRef.current = null;
      }
    }, suppressionMs);

    recentlyClosedRef.current = { id: itemId, until, timer };
  }, [clearSuppression, suppressionMs]);

  const canOpenViewerItem = useCallback((itemId: string | null | undefined) => {
    if (!itemId) return true;

    const current = recentlyClosedRef.current;
    if (!current || current.id !== itemId) return true;

    if (current.until <= Date.now()) {
      clearSuppression();
      return true;
    }

    return false;
  }, [clearSuppression]);

  useEffect(() => clearSuppression, [clearSuppression]);

  return { canOpenViewerItem, suppressViewerItem };
}

function MediaTypeIcon({
  mediaType,
  className,
}: {
  mediaType: string;
  className?: string;
}) {
  if (mediaType === "video") return <Film size={20} className={className} />;
  if (mediaType === "pdf" || mediaType === "document") {
    return <FileText size={20} className={className} />;
  }
  if (mediaType === "photo") return <ImageIcon size={20} className={className} />;
  return <Paperclip size={20} className={className} />;
}

function formatViewerDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function MediaViewerModal({
  item,
  onClose,
}: {
  /** The item to render. Pass null to keep the modal closed. */
  item: ViewerMediaItem | null;
  onClose: () => void;
}) {
  if (!item) return null;
  // Re-key on item.id so navigating from one tile to another (parent
  // swaps the prop without an unmount) resets the inner fetch state.
  return <MediaViewerModalBody key={item.id} item={item} onClose={onClose} />;
}

function MediaViewerModalBody({
  item,
  onClose,
}: {
  item: ViewerMediaItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [signedUrl, setSignedUrl] = useState<string | null>(() => item.directUrl ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const pushedHistoryRef = useRef(false);
  const closingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    pushedHistoryRef.current = true;
    window.history.pushState(
      {
        ...(window.history.state && typeof window.history.state === "object"
          ? window.history.state
          : {}),
        mediaViewerItemId: item.id,
      },
      "",
      window.location.href,
    );

    function handlePopState() {
      if (!pushedHistoryRef.current) return;
      pushedHistoryRef.current = false;
      onClose();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [item.id, onClose]);

  useEffect(() => {
    let cancelled = false;
    if (item.directUrl) {
      return () => {
        cancelled = true;
      };
    }
    const playback = selectMediaPlayback({
      storage_path: item.storage_path,
      mime_type: item.mime_type,
      metadata: item.metadata ?? null,
    });
    const path = normalizeStoragePath(playback.path);
    void (async () => {
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(path, 3600);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        setLoadFailed(true);
        return;
      }
      setSignedUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, item.storage_path, item.mime_type, item.metadata, item.directUrl]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (typeof window !== "undefined" && pushedHistoryRef.current) {
      window.history.back();
      return;
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") requestClose();
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [requestClose]);

  async function handleDownload() {
    if (typeof window === "undefined") return;
    if (item.directUrl) {
      const anchor = document.createElement("a");
      anchor.href = item.directUrl;
      anchor.download = item.filename?.trim() || "download";
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    const path = normalizeStoragePath(item.storage_path);
    const fallbackName = path.split("/").pop() ?? "download";
    const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(path, 3600, { download: downloadAs });
    if (error || !data?.signedUrl) {
      // Surface to console — the modal's primary inline message
      // already covers the "preview failed" case for the worker.
      console.warn("[media-viewer] download sign failed:", error);
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = downloadAs;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function handleCloseEvent(
    event: ReactMouseEvent<HTMLElement> | ReactTouchEvent<HTMLElement>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    requestClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="media-viewer-modal"
      className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.85)" }}
      onClick={handleCloseEvent}
      onTouchEnd={handleCloseEvent}
    >
      <div
        className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)]"
        onClick={(event) => event.stopPropagation()}
        onTouchEnd={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MediaTypeIcon
                mediaType={item.media_type}
                className="text-[var(--brand-yellow)]"
              />
              <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                {item.filename ?? item.media_type}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--text-secondary)]">
              {item.projectName ? <span>{item.projectName}</span> : null}
              {item.uploaderName ? <span>· {item.uploaderName}</span> : null}
              {item.created_at ? <span>· {formatViewerDate(item.created_at)}</span> : null}
            </div>
            {item.caption ? (
              <p className="mt-1 line-clamp-2 text-xs text-[var(--text-muted)]">{item.caption}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleCloseEvent}
            onTouchEnd={handleCloseEvent}
            aria-label={t("common.cancel")}
            data-testid="media-viewer-close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </header>

        <div className="relative flex flex-1 items-center justify-center bg-black">
          {loadFailed ? (
            <div className="m-6 max-w-sm rounded-[var(--radius-md)] bg-[var(--bg-card)] p-4 text-center text-sm text-[var(--text-secondary)]">
              {t("gallery.previewFailed")}
            </div>
          ) : !signedUrl ? (
            <div className="text-xs text-[var(--text-muted)]">{t("common.loading")}</div>
          ) : item.media_type === "video" ? (
            <video
              src={signedUrl}
              controls
              playsInline
              className="max-h-[70vh] w-full"
              onError={() => setLoadFailed(true)}
            />
          ) : item.media_type === "pdf" || item.media_type === "document" ? (
            <iframe
              src={signedUrl}
              title={item.filename ?? "PDF"}
              className="h-[70vh] w-full bg-white"
            />
          ) : (
            // Photos. Native <img> — the signed URL host varies and
            // Next/Image needs an allowlist that we don't maintain.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signedUrl}
              alt={item.filename ?? ""}
              className="max-h-[70vh] w-auto object-contain"
              onError={() => setLoadFailed(true)}
            />
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="media-viewer-open-tab"
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
            >
              <ExternalLink size={12} />
              {t("messages.openFile")}
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void handleDownload()}
            data-testid="media-viewer-download"
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
          >
            <Download size={12} />
            {t("messages.downloadFile")}
          </button>
        </footer>
      </div>
    </div>
  );
}
