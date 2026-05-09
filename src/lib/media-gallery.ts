/**
 * Media gallery / journal-timeline helpers — pure logic so a long list
 * of `media` rows can be turned into a paginated, categorized,
 * filterable view without spinning up React or Supabase.
 *
 * The gallery surfaces it powers:
 *   • Manager Project Detail "Recent media" panel → first N tiles + drawer.
 *   • Manager Team Member "Journal timeline" → date/project/type filters.
 *   • Worker project page project-media strip → panel mode, worker-scoped.
 *
 * Categorization mirrors the WorkerShell upload paths:
 *   metadata.kind === "task_attachment"         → "task"
 *   metadata.kind === "receipt"                 → "receipt"
 *   metadata.category === "receipt" (legacy)    → "receipt"
 *   metadata.kind === "project_media"           → "project"
 *   metadata.kind === "before_work"             → "checkin"
 *   is_checkout === true (covers before_leave + close-side proof) → "checkout"
 *   otherwise                                   → "journal"
 */

export type MediaCategory =
  | "checkout"
  | "checkin"
  | "journal"
  | "project"
  | "task"
  | "receipt";

export interface GalleryMediaInput {
  id: string;
  project_id: string | null;
  uploaded_by: string | null;
  media_type: string;
  storage_path: string;
  filename: string | null;
  mime_type: string | null;
  caption: string | null;
  is_checkout: boolean;
  time_event_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function categorizeMedia(item: GalleryMediaInput): MediaCategory {
  const meta = item.metadata ?? null;
  if (meta) {
    const kind = meta.kind;
    const category = meta.category;
    if (kind === "task_attachment") return "task";
    if (kind === "receipt" || category === "receipt") return "receipt";
    if (kind === "project_media") return "project";
    if (kind === "before_work") return "checkin";
  }
  if (item.is_checkout) return "checkout";
  return "journal";
}

export type GalleryMediaTypeFilter =
  | "all"
  | "photo"
  | "video"
  | "pdf"
  | "receipt";

/**
 * Map the on-disk `media_type` (photo / video / pdf / document) plus
 * the row's category onto the high-level filter buckets the gallery
 * UI exposes. `pdf` and `document` both fall under "pdf" so the legacy
 * value doesn't disappear from the UI.
 */
export function matchesGalleryTypeFilter(
  item: GalleryMediaInput,
  filter: GalleryMediaTypeFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "receipt") return categorizeMedia(item) === "receipt";
  if (filter === "pdf") return item.media_type === "pdf" || item.media_type === "document";
  return item.media_type === filter;
}

export interface GalleryFilters {
  /** "all" / "photo" / "video" / "pdf" / "receipt". */
  type?: GalleryMediaTypeFilter;
  /** Inclusive ISO start (YYYY-MM-DD). Items strictly before are dropped. */
  fromDate?: string | null;
  /** Inclusive ISO end (YYYY-MM-DD). Items strictly after are dropped. */
  toDate?: string | null;
  /** When set, only items uploaded by this profileId pass. */
  uploaderId?: string | null;
  /** When set, only items in these project ids pass. */
  projectIds?: string[] | null;
  /** When set, only items in these categories pass (post-categorize). */
  categories?: MediaCategory[] | null;
}

function isoDayBound(value: string, end: boolean): number {
  // Treat date inputs as local-day boundaries so "today" filters
  // include everything captured today regardless of TZ wobble. The
  // value is YYYY-MM-DD; appending T00:00 / T23:59:59.999 lets the
  // Date constructor interpret it locally.
  const d = end ? new Date(`${value}T23:59:59.999`) : new Date(`${value}T00:00:00`);
  return d.getTime();
}

export function applyGalleryFilters<T extends GalleryMediaInput>(
  items: T[],
  filters: GalleryFilters,
): T[] {
  const fromMs = filters.fromDate ? isoDayBound(filters.fromDate, false) : null;
  const toMs = filters.toDate ? isoDayBound(filters.toDate, true) : null;
  const projectSet =
    filters.projectIds && filters.projectIds.length > 0
      ? new Set(filters.projectIds)
      : null;
  const categorySet =
    filters.categories && filters.categories.length > 0
      ? new Set(filters.categories)
      : null;
  const typeFilter = filters.type ?? "all";
  const uploaderId = filters.uploaderId ?? null;

  return items.filter((item) => {
    if (typeFilter !== "all" && !matchesGalleryTypeFilter(item, typeFilter)) {
      return false;
    }
    if (uploaderId !== null && item.uploaded_by !== uploaderId) return false;
    if (projectSet && (!item.project_id || !projectSet.has(item.project_id))) {
      return false;
    }
    if (categorySet && !categorySet.has(categorizeMedia(item))) return false;
    const ts = new Date(item.created_at).getTime();
    if (fromMs !== null && ts < fromMs) return false;
    if (toMs !== null && ts > toMs) return false;
    return true;
  });
}

export interface PaginatedSlice<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/**
 * Take the first `pageSize` items off a (possibly large) sorted list.
 * The gallery uses "load more" / cumulative paging — caller bumps
 * `pageSize` to reveal more rows without re-rendering everything.
 */
export function paginateGalleryItems<T>(
  items: T[],
  pageSize: number,
): PaginatedSlice<T> {
  const safeSize = pageSize > 0 ? Math.floor(pageSize) : 0;
  if (safeSize === 0) {
    return { items: [], total: items.length, hasMore: items.length > 0 };
  }
  if (items.length <= safeSize) {
    return { items, total: items.length, hasMore: false };
  }
  return {
    items: items.slice(0, safeSize),
    total: items.length,
    hasMore: items.length > safeSize,
  };
}

/**
 * Build a "go to neighbour" map for the modal viewer. Returns the
 * previous and next item id (with wrap-around) so the viewer can
 * render Prev / Next without re-walking the array on every render.
 *
 * Wraps deliberately: the gallery is a finite, sorted list; once the
 * worker reaches the end, looping back to the top is gentler than
 * disabling the buttons mid-scroll.
 */
export function neighboursForViewer<T extends { id: string }>(
  items: T[],
  currentId: string | null,
): { previousId: string | null; nextId: string | null } {
  if (!currentId || items.length === 0) {
    return { previousId: null, nextId: null };
  }
  const index = items.findIndex((item) => item.id === currentId);
  if (index < 0) return { previousId: null, nextId: null };
  if (items.length === 1) return { previousId: null, nextId: null };
  const previousIndex = (index - 1 + items.length) % items.length;
  const nextIndex = (index + 1) % items.length;
  return {
    previousId: items[previousIndex].id,
    nextId: items[nextIndex].id,
  };
}

/**
 * Worker-side visibility gate. The server-side data already filters
 * via RLS; this helper is the client-side defence-in-depth so a
 * browser-cached row from a different project (e.g. a stale shell) is
 * not surfaced.
 *
 * Visible to the worker when:
 *   • the row is on a project the worker can see, AND
 *   • the row is NOT another worker's receipt (matches
 *     `worker-receipt-visibility` semantics — receipts are scoped to
 *     uploader to prevent project-cost leakage), AND
 *   • the metadata does not carry `owner_only: true`.
 */
export function isMediaVisibleToWorker(
  item: GalleryMediaInput,
  args: {
    workerId: string;
    visibleProjectIds: Set<string>;
  },
): boolean {
  if (!item.project_id) return false;
  if (!args.visibleProjectIds.has(item.project_id)) return false;
  const meta = item.metadata ?? null;
  if (meta && meta.owner_only === true) return false;
  // Receipts: only the worker's own. Mirrors
  // worker-receipt-visibility.isReceiptVisibleToWorker so the gallery
  // stays consistent with the project-page list.
  if (categorizeMedia(item) === "receipt") {
    return item.uploaded_by === args.workerId;
  }
  return true;
}
