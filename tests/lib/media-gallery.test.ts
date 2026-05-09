import { describe, expect, it } from "vitest";
import {
  applyGalleryFilters,
  categorizeMedia,
  isMediaVisibleToWorker,
  matchesGalleryTypeFilter,
  neighboursForViewer,
  paginateGalleryItems,
  type GalleryMediaInput,
} from "@/lib/media-gallery";

function row(overrides: Partial<GalleryMediaInput> & { id: string }): GalleryMediaInput {
  return {
    project_id: "p1",
    uploaded_by: "w1",
    media_type: "photo",
    storage_path: `${overrides.id}/file.jpg`,
    filename: `${overrides.id}.jpg`,
    mime_type: "image/jpeg",
    caption: null,
    is_checkout: false,
    time_event_id: null,
    metadata: null,
    created_at: "2026-04-15T10:00:00Z",
    ...overrides,
  };
}

describe("categorizeMedia", () => {
  it("returns 'task' for task_attachment metadata", () => {
    expect(categorizeMedia(row({ id: "a", metadata: { kind: "task_attachment" } }))).toBe("task");
  });
  it("returns 'receipt' for both kind=receipt and the legacy category=receipt", () => {
    expect(categorizeMedia(row({ id: "a", metadata: { kind: "receipt" } }))).toBe("receipt");
    expect(categorizeMedia(row({ id: "b", metadata: { category: "receipt" } }))).toBe("receipt");
  });
  it("returns 'project' for project_media metadata", () => {
    expect(categorizeMedia(row({ id: "a", metadata: { kind: "project_media" } }))).toBe("project");
  });
  it("returns 'checkin' for before_work uploads", () => {
    expect(categorizeMedia(row({ id: "a", metadata: { kind: "before_work" } }))).toBe("checkin");
  });
  it("returns 'checkout' when is_checkout is true and no metadata kind takes precedence", () => {
    // Covers both the close-side checkout video and the before_leave
    // upload (WorkerShell stamps both with is_checkout=true).
    expect(categorizeMedia(row({ id: "a", is_checkout: true }))).toBe("checkout");
    expect(
      categorizeMedia(row({ id: "b", is_checkout: true, metadata: { kind: "before_leave" } })),
    ).toBe("checkout");
  });
  it("returns 'journal' as the default", () => {
    expect(categorizeMedia(row({ id: "a" }))).toBe("journal");
  });
});

describe("matchesGalleryTypeFilter", () => {
  it("passes everything for 'all'", () => {
    expect(matchesGalleryTypeFilter(row({ id: "a", media_type: "video" }), "all")).toBe(true);
  });
  it("buckets pdf and document together for 'pdf'", () => {
    expect(matchesGalleryTypeFilter(row({ id: "a", media_type: "pdf" }), "pdf")).toBe(true);
    expect(matchesGalleryTypeFilter(row({ id: "b", media_type: "document" }), "pdf")).toBe(true);
    expect(matchesGalleryTypeFilter(row({ id: "c", media_type: "photo" }), "pdf")).toBe(false);
  });
  it("matches receipts via category, not media_type", () => {
    expect(
      matchesGalleryTypeFilter(
        row({ id: "a", media_type: "photo", metadata: { category: "receipt" } }),
        "receipt",
      ),
    ).toBe(true);
    expect(
      matchesGalleryTypeFilter(
        row({ id: "b", media_type: "photo" }),
        "receipt",
      ),
    ).toBe(false);
  });
});

describe("applyGalleryFilters", () => {
  const items: GalleryMediaInput[] = [
    row({ id: "old-photo", project_id: "p1", uploaded_by: "w1", media_type: "photo", created_at: "2026-04-01T08:00:00Z" }),
    row({ id: "mid-video", project_id: "p1", uploaded_by: "w2", media_type: "video", created_at: "2026-04-15T08:00:00Z" }),
    row({ id: "recent-pdf", project_id: "p2", uploaded_by: "w1", media_type: "pdf", created_at: "2026-04-30T08:00:00Z" }),
    row({ id: "receipt", project_id: "p1", uploaded_by: "w1", media_type: "photo", metadata: { category: "receipt" }, created_at: "2026-04-20T08:00:00Z" }),
    row({ id: "checkout", project_id: "p1", uploaded_by: "w2", media_type: "video", is_checkout: true, created_at: "2026-04-25T08:00:00Z" }),
  ];

  it("returns everything when no filters are set", () => {
    expect(applyGalleryFilters(items, {}).map((i) => i.id)).toEqual([
      "old-photo",
      "mid-video",
      "recent-pdf",
      "receipt",
      "checkout",
    ]);
  });

  it("filters by media type bucket", () => {
    expect(applyGalleryFilters(items, { type: "video" }).map((i) => i.id)).toEqual([
      "mid-video",
      "checkout",
    ]);
  });

  it("filters by date range inclusive on both ends", () => {
    const out = applyGalleryFilters(items, {
      fromDate: "2026-04-15",
      toDate: "2026-04-25",
    }).map((i) => i.id);
    expect(out).toEqual(["mid-video", "receipt", "checkout"]);
  });

  it("filters by uploader", () => {
    expect(
      applyGalleryFilters(items, { uploaderId: "w1" }).map((i) => i.id),
    ).toEqual(["old-photo", "recent-pdf", "receipt"]);
  });

  it("filters by project ids", () => {
    expect(
      applyGalleryFilters(items, { projectIds: ["p2"] }).map((i) => i.id),
    ).toEqual(["recent-pdf"]);
  });

  it("filters by category set", () => {
    expect(
      applyGalleryFilters(items, { categories: ["receipt", "checkout"] })
        .map((i) => i.id)
        .sort(),
    ).toEqual(["checkout", "receipt"]);
  });

  it("composes filters together", () => {
    expect(
      applyGalleryFilters(items, {
        uploaderId: "w1",
        type: "photo",
        fromDate: "2026-04-10",
      }).map((i) => i.id),
    ).toEqual(["receipt"]);
  });
});

describe("paginateGalleryItems", () => {
  const items = [1, 2, 3, 4, 5].map((n) => row({ id: `r-${n}` }));

  it("returns all items when pageSize >= total", () => {
    const slice = paginateGalleryItems(items, 10);
    expect(slice.items).toHaveLength(5);
    expect(slice.total).toBe(5);
    expect(slice.hasMore).toBe(false);
  });

  it("returns the first pageSize items + hasMore=true when more remain", () => {
    const slice = paginateGalleryItems(items, 2);
    expect(slice.items.map((i) => i.id)).toEqual(["r-1", "r-2"]);
    expect(slice.total).toBe(5);
    expect(slice.hasMore).toBe(true);
  });

  it("clamps a zero pageSize to an empty slice but keeps the total", () => {
    const slice = paginateGalleryItems(items, 0);
    expect(slice.items).toEqual([]);
    expect(slice.total).toBe(5);
    expect(slice.hasMore).toBe(true);
  });
});

describe("neighboursForViewer", () => {
  const items = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];

  it("returns wrap-around neighbours for a middle item", () => {
    expect(neighboursForViewer(items, "b")).toEqual({ previousId: "a", nextId: "c" });
  });
  it("wraps from the first item backward to the last", () => {
    expect(neighboursForViewer(items, "a")).toEqual({ previousId: "c", nextId: "b" });
  });
  it("wraps from the last item forward to the first", () => {
    expect(neighboursForViewer(items, "c")).toEqual({ previousId: "b", nextId: "a" });
  });
  it("returns nulls for an empty list / unknown id / no current", () => {
    expect(neighboursForViewer([], "a")).toEqual({ previousId: null, nextId: null });
    expect(neighboursForViewer(items, null)).toEqual({ previousId: null, nextId: null });
    expect(neighboursForViewer(items, "missing")).toEqual({ previousId: null, nextId: null });
  });
  it("returns nulls when the list has a single item (no neighbours to wrap to)", () => {
    expect(neighboursForViewer([row({ id: "only" })], "only")).toEqual({
      previousId: null,
      nextId: null,
    });
  });
});

describe("isMediaVisibleToWorker", () => {
  const visibleProjectIds = new Set(["p1", "p2"]);

  it("hides media from projects the worker can't see", () => {
    expect(
      isMediaVisibleToWorker(row({ id: "a", project_id: "pX" }), {
        workerId: "w1",
        visibleProjectIds,
      }),
    ).toBe(false);
  });

  it("hides media with metadata.owner_only set to true", () => {
    expect(
      isMediaVisibleToWorker(
        row({ id: "a", metadata: { owner_only: true } }),
        { workerId: "w1", visibleProjectIds },
      ),
    ).toBe(false);
  });

  it("hides receipts uploaded by a different worker (project-cost leakage rule)", () => {
    expect(
      isMediaVisibleToWorker(
        row({ id: "a", uploaded_by: "w2", metadata: { category: "receipt" } }),
        { workerId: "w1", visibleProjectIds },
      ),
    ).toBe(false);
  });

  it("shows the worker's own receipts", () => {
    expect(
      isMediaVisibleToWorker(
        row({ id: "a", uploaded_by: "w1", metadata: { category: "receipt" } }),
        { workerId: "w1", visibleProjectIds },
      ),
    ).toBe(true);
  });

  it("shows project media on visible projects regardless of uploader", () => {
    expect(
      isMediaVisibleToWorker(
        row({ id: "a", uploaded_by: "w2", metadata: { kind: "project_media" } }),
        { workerId: "w1", visibleProjectIds },
      ),
    ).toBe(true);
  });
});
