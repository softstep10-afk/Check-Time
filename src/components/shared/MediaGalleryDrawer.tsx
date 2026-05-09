"use client";

/**
 * Filterable media drawer + inline viewer used by manager review
 * surfaces (Project Detail "Recent media" panel, Team Member "Journal
 * timeline" section). Keeps the rest of the page small by receiving
 * pre-loaded media rows from the server and doing all filtering /
 * pagination client-side.
 *
 * Owner / manager financial totals are NOT computed here — the gallery
 * is a per-row evidence surface, not a roll-up. Worker callers further
 * narrow the input list via isMediaVisibleToWorker so this component
 * stays role-agnostic.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Film,
  Image as ImageIcon,
  Paperclip,
  Receipt as ReceiptIcon,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { selectMediaPlayback } from "@/lib/media-playback";
import { normalizeStoragePath } from "@/lib/task-attachments";
import {
  applyGalleryFilters,
  categorizeMedia,
  neighboursForViewer,
  paginateGalleryItems,
  type GalleryFilters,
  type GalleryMediaInput,
  type GalleryMediaTypeFilter,
  type MediaCategory,
} from "@/lib/media-gallery";

export interface GalleryItem extends GalleryMediaInput {
  /** Friendly project name resolved by the caller. Optional. */
  projectName?: string | null;
  /** Friendly uploader name resolved by the caller. Optional. */
  uploaderName?: string | null;
  /**
   * Optional shift context for checkout / checkin evidence — caller
   * resolves this from time_event_id once and passes it through. Lets
   * the viewer render "Vasya · Дом · 8h 12m" without re-querying.
   */
  shiftContext?: {
    clockInTime: string;
    clockOutTime: string | null;
    durationMinutes: number;
    videoStatus: string | null;
  } | null;
}

export interface UploaderOption {
  id: string;
  name: string;
}

export interface ProjectOption {
  id: string;
  name: string;
}

const PAGE_SIZE = 24;
const TYPE_OPTIONS: GalleryMediaTypeFilter[] = ["all", "photo", "video", "pdf", "receipt"];

function categoryBadgeStyle(category: MediaCategory): {
  background: string;
  color: string;
} {
  switch (category) {
    case "checkout":
      return { background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" };
    case "checkin":
      return { background: "rgba(74, 127, 191, 0.16)", color: "var(--blue)" };
    case "task":
      return { background: "rgba(191, 162, 52, 0.16)", color: "var(--brand-yellow)" };
    case "receipt":
      return { background: "rgba(249, 115, 22, 0.16)", color: "#f97316" };
    case "project":
      return { background: "rgba(148, 163, 184, 0.18)", color: "var(--text-secondary)" };
    default:
      return { background: "rgba(148, 163, 184, 0.10)", color: "var(--text-muted)" };
  }
}

function MediaTypeIcon({
  mediaType,
  className,
}: {
  mediaType: string;
  className?: string;
}) {
  // Render the icon inline rather than aliasing the imported lucide
  // component to a local variable — the project lints react-hooks/
  // static-components, which flags the pattern even when the source is
  // a top-level switch.
  if (mediaType === "video") return <Film size={28} className={className} />;
  if (mediaType === "pdf" || mediaType === "document") {
    return <FileText size={28} className={className} />;
  }
  if (mediaType === "photo") return <ImageIcon size={28} className={className} />;
  return <Paperclip size={28} className={className} />;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

interface OpenContext {
  setError: (msg: string) => void;
}

type DrawerProps = {
  open: boolean;
  title: string;
  items: GalleryItem[];
  showUploaderFilter?: boolean;
  uploaderOptions?: UploaderOption[];
  projectOptions?: ProjectOption[];
  initialFilters?: GalleryFilters;
  onClose: () => void;
};

export function MediaGalleryDrawer(props: DrawerProps) {
  // The drawer's inner state (filters, pageSize, viewerId) should
  // reset whenever the drawer is reopened. We achieve that by only
  // mounting the body when `open` is true — closing unmounts it, so
  // the next open creates fresh state. Avoids a setState-in-effect
  // reset pattern that the project's lint rules forbid.
  if (!props.open) return null;
  return <MediaGalleryDrawerBody {...props} />;
}

function MediaGalleryDrawerBody({
  title,
  items,
  showUploaderFilter = false,
  uploaderOptions,
  projectOptions,
  initialFilters,
  onClose,
}: DrawerProps) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);

  const [typeFilter, setTypeFilter] = useState<GalleryMediaTypeFilter>(
    initialFilters?.type ?? "all",
  );
  const [fromDate, setFromDate] = useState<string>(initialFilters?.fromDate ?? "");
  const [toDate, setToDate] = useState<string>(initialFilters?.toDate ?? "");
  const [projectFilter, setProjectFilter] = useState<string>(
    initialFilters?.projectIds && initialFilters.projectIds.length === 1
      ? initialFilters.projectIds[0]
      : "",
  );
  const [uploaderFilter, setUploaderFilter] = useState<string>(initialFilters?.uploaderId ?? "");

  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string>("");

  const filteredItems = useMemo(() => {
    return applyGalleryFilters(items, {
      type: typeFilter,
      fromDate: fromDate || null,
      toDate: toDate || null,
      uploaderId: showUploaderFilter && uploaderFilter ? uploaderFilter : null,
      projectIds: projectFilter ? [projectFilter] : null,
    });
  }, [items, typeFilter, fromDate, toDate, projectFilter, showUploaderFilter, uploaderFilter]);

  const slice = useMemo(
    () => paginateGalleryItems(filteredItems, pageSize),
    [filteredItems, pageSize],
  );

  const viewerItem = viewerId
    ? filteredItems.find((it) => it.id === viewerId) ?? null
    : null;
  const viewerNeighbours = useMemo(
    () => neighboursForViewer(filteredItems, viewerId),
    [filteredItems, viewerId],
  );

  const ctx: OpenContext = { setError: setOpenError };

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="media-gallery-drawer"
      className="fixed inset-0 flex items-stretch justify-center"
      style={{ background: "rgba(0,0,0,0.55)", zIndex: 900 }}
      onClick={onClose}
    >
      <div
        className="m-0 flex h-full w-full max-w-[1100px] flex-col overflow-hidden bg-[var(--bg-card)] sm:m-3 sm:rounded-[var(--radius-lg)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("gallery.title")}
            </p>
            <h2 className="mt-0.5 truncate text-base font-bold text-[var(--text-primary)]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </header>

        <section className="flex flex-wrap items-end gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {TYPE_OPTIONS.map((opt) => {
              const selected = typeFilter === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => {
                    setTypeFilter(opt);
                    setPageSize(PAGE_SIZE);
                  }}
                  aria-pressed={selected}
                  className="rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-semibold"
                  style={{
                    borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                    background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                    color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
                  }}
                >
                  {t(
                    opt === "all"
                      ? "gallery.typeAll"
                      : opt === "photo"
                        ? "gallery.typePhotos"
                        : opt === "video"
                          ? "gallery.typeVideos"
                          : opt === "pdf"
                            ? "gallery.typePdfs"
                            : "gallery.typeReceipts",
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("gallery.fromLabel")}
              <input
                type="date"
                value={fromDate}
                onChange={(event) => {
                  setFromDate(event.target.value);
                  setPageSize(PAGE_SIZE);
                }}
                className="ml-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("gallery.toLabel")}
              <input
                type="date"
                value={toDate}
                onChange={(event) => {
                  setToDate(event.target.value);
                  setPageSize(PAGE_SIZE);
                }}
                className="ml-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
              />
            </label>
            {projectOptions && projectOptions.length > 1 ? (
              <select
                value={projectFilter}
                onChange={(event) => {
                  setProjectFilter(event.target.value);
                  setPageSize(PAGE_SIZE);
                }}
                aria-label={t("gallery.projectFilterLabel")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("gallery.projectFilterAll")}</option>
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {showUploaderFilter && uploaderOptions && uploaderOptions.length > 1 ? (
              <select
                value={uploaderFilter}
                onChange={(event) => {
                  setUploaderFilter(event.target.value);
                  setPageSize(PAGE_SIZE);
                }}
                aria-label={t("gallery.uploaderFilterLabel")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("gallery.uploaderFilterAll")}</option>
                {uploaderOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="ml-auto text-xs text-[var(--text-muted)]">
            {slice.total} {t("gallery.itemsLabel")}
          </div>
        </section>

        {openError ? (
          <div
            role="alert"
            className="mx-4 mt-3 rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
            style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
          >
            {openError}
          </div>
        ) : null}

        <section className="flex-1 overflow-y-auto px-4 py-3">
          {slice.items.length === 0 ? (
            <div className="surface-panel p-4 text-center text-sm text-[var(--text-secondary)]">
              {t("gallery.empty")}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {slice.items.map((item) => (
                <GalleryTile
                  key={item.id}
                  item={item}
                  supabase={supabase}
                  onSelect={() => setViewerId(item.id)}
                  onDownload={() => void downloadItem(item, supabase, ctx, t)}
                />
              ))}
            </div>
          )}
          {slice.hasMore ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setPageSize((current) => current + PAGE_SIZE)}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
              >
                {t("gallery.loadMore")}
              </button>
            </div>
          ) : null}
        </section>
      </div>

      {viewerItem ? (
        <MediaViewer
          item={viewerItem}
          previousId={viewerNeighbours.previousId}
          nextId={viewerNeighbours.nextId}
          onPrev={() => viewerNeighbours.previousId && setViewerId(viewerNeighbours.previousId)}
          onNext={() => viewerNeighbours.nextId && setViewerId(viewerNeighbours.nextId)}
          onClose={() => setViewerId(null)}
          onError={setOpenError}
        />
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Tile + viewer
// ─────────────────────────────────────────────────────────────────────

function GalleryTile({
  item,
  supabase,
  onSelect,
  onDownload,
}: {
  item: GalleryItem;
  supabase: ReturnType<typeof createClient>;
  onSelect: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const category = categorizeMedia(item);
  const badgeStyle = categoryBadgeStyle(category);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  // Best-effort thumbnail for photos. Videos / PDFs render an icon
  // tile — generating a poster frame would need a transcode the spec
  // explicitly does not require here.
  useEffect(() => {
    if (item.media_type !== "photo") return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrl(normalizeStoragePath(item.storage_path), 600);
      if (!cancelled && data?.signedUrl) {
        setThumbUrl(data.signedUrl);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, item.media_type, item.storage_path]);

  const tileBorder: CSSProperties = {
    borderColor: "var(--border-default)",
    background: "var(--bg-primary)",
  };

  return (
    <div
      data-testid="media-gallery-tile"
      data-category={category}
      className="relative overflow-hidden rounded-[var(--radius-md)] border"
      style={tileBorder}
    >
      <button
        type="button"
        onClick={onSelect}
        title={item.filename ?? item.media_type}
        className="block w-full text-left"
      >
        <div className="relative aspect-square">
          {item.media_type === "photo" && thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrl}
              alt={item.filename ?? ""}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
              {category === "receipt" ? (
                <ReceiptIcon size={28} className="text-[var(--brand-yellow)]" />
              ) : (
                <MediaTypeIcon
                  mediaType={item.media_type}
                  className="text-[var(--brand-yellow)]"
                />
              )}
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {item.media_type}
              </span>
            </div>
          )}
          <span
            className="absolute left-1 top-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
            style={badgeStyle}
          >
            {t(`gallery.category.${category}`)}
          </span>
        </div>
        <div className="border-t border-[var(--border-subtle)] px-2 py-1.5">
          <div className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
            {item.filename ?? item.media_type}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--text-muted)]">
            <span>{formatDate(item.created_at)}</span>
            {item.uploaderName ? <span>· {item.uploaderName}</span> : null}
            {item.projectName ? <span>· {item.projectName}</span> : null}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onDownload}
        aria-label={`Download ${item.filename ?? "file"}`}
        title="Download"
        className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border"
        style={{
          background: "rgba(0, 0, 0, 0.55)",
          borderColor: "rgba(255, 255, 255, 0.35)",
          color: "white",
        }}
      >
        <Download size={12} />
      </button>
    </div>
  );
}

type ViewerProps = {
  item: GalleryItem;
  previousId: string | null;
  nextId: string | null;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
};

function MediaViewer(props: ViewerProps) {
  // Re-key the body on item.id so navigating prev/next remounts the
  // body. Local state (signedUrl, loadFailed) initializes fresh on
  // mount — no synchronous setState reset effect needed, which keeps
  // us under the project's react-hooks/set-state-in-effect rule.
  return <MediaViewerBody key={props.item.id} {...props} />;
}

function MediaViewerBody({
  item,
  previousId,
  nextId,
  onPrev,
  onNext,
  onClose,
  onError,
}: ViewerProps) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const playback = selectMediaPlayback(item);
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
  }, [supabase, item]);

  const category = categorizeMedia(item);
  const badge = categoryBadgeStyle(category);

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="media-gallery-viewer"
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.85)" }}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                style={badge}
              >
                {t(`gallery.category.${category}`)}
              </span>
              <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                {item.filename ?? item.media_type}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--text-secondary)]">
              {item.projectName ? <span>{item.projectName}</span> : null}
              {item.uploaderName ? <span>· {item.uploaderName}</span> : null}
              <span>· {formatDate(item.created_at)}</span>
            </div>
            {item.shiftContext ? (
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                {t("gallery.shiftLabel")}{" "}
                {formatDate(item.shiftContext.clockInTime)}
                {item.shiftContext.clockOutTime
                  ? ` → ${formatDate(item.shiftContext.clockOutTime)}`
                  : ""}
                {" · "}
                {item.shiftContext.durationMinutes}m
                {item.shiftContext.videoStatus
                  ? ` · ${item.shiftContext.videoStatus}`
                  : ""}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </header>

        <div className="relative flex flex-1 items-center justify-center bg-black">
          {previousId ? (
            <button
              type="button"
              onClick={onPrev}
              aria-label={t("gallery.previous")}
              className="absolute left-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
            >
              <ChevronLeft size={18} />
            </button>
          ) : null}
          {nextId ? (
            <button
              type="button"
              onClick={onNext}
              aria-label={t("gallery.next")}
              className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full"
              style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
            >
              <ChevronRight size={18} />
            </button>
          ) : null}
          {loadFailed ? (
            <div className="m-6 max-w-sm rounded-[var(--radius-md)] bg-[var(--bg-card)] p-4 text-center text-sm text-[var(--text-secondary)]">
              {t("gallery.previewFailed")}
            </div>
          ) : !signedUrl ? (
            <div className="text-xs text-[var(--text-muted)]">{t("common.loading")}</div>
          ) : item.media_type === "video" ? (
            <video
              key={item.id}
              src={signedUrl}
              controls
              playsInline
              className="max-h-[70vh] w-full"
              onError={() => setLoadFailed(true)}
            />
          ) : item.media_type === "pdf" || item.media_type === "document" ? (
            <iframe
              key={item.id}
              src={signedUrl}
              title={item.filename ?? "PDF"}
              className="h-[70vh] w-full bg-white"
            />
          ) : (
            // Photos. Native <img> is plenty here — Next/Image needs an
            // explicit allowed-host config and the signed URL host varies.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
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
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
              style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
            >
              <ExternalLink size={12} />
              {t("messages.openFile")}
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => void downloadItem(item, supabase, { setError: onError }, t)}
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

async function downloadItem(
  item: GalleryItem,
  supabase: ReturnType<typeof createClient>,
  ctx: OpenContext,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (typeof window === "undefined") return;
  const path = normalizeStoragePath(item.storage_path);
  const fallbackName = path.split("/").pop() ?? "download";
  const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
  const { data, error } = await supabase.storage
    .from("media")
    .createSignedUrl(path, 3600, { download: downloadAs });
  if (error || !data?.signedUrl) {
    ctx.setError(t("projectDetail.mediaOpenFailed"));
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
