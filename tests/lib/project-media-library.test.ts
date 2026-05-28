import { describe, expect, it } from "vitest";
import {
  classifyProjectMediaCategory,
  countProjectMediaCategories,
  filterProjectMediaByCategory,
} from "@/lib/project-media-library";

const item = (overrides: {
  id: string;
  media_type: string;
  mime_type?: string | null;
  filename?: string | null;
  created_at?: string | null;
}) => ({
  id: overrides.id,
  media_type: overrides.media_type,
  mime_type: overrides.mime_type ?? null,
  filename: overrides.filename ?? null,
  created_at: overrides.created_at ?? null,
});

describe("project media library categories", () => {
  it("classifies images, videos, PDFs, and business documents", () => {
    expect(classifyProjectMediaCategory(item({ id: "photo", media_type: "photo" }))).toBe("photo");
    expect(classifyProjectMediaCategory(item({ id: "video", media_type: "video" }))).toBe("video");
    expect(classifyProjectMediaCategory(item({ id: "pdf", media_type: "pdf" }))).toBe("documents");
    expect(classifyProjectMediaCategory(item({ id: "doc", media_type: "document", filename: "scope.docx" }))).toBe("documents");
    expect(classifyProjectMediaCategory(item({ id: "csv", media_type: "file", filename: "materials.csv" }))).toBe("documents");
  });

  it("counts project media tabs and buckets Word/Excel/CSV with documents", () => {
    const counts = countProjectMediaCategories([
      item({ id: "a", media_type: "photo" }),
      item({ id: "b", media_type: "video" }),
      item({ id: "c", media_type: "pdf" }),
      item({ id: "d", media_type: "document", filename: "estimate.xlsx" }),
    ]);

    expect(counts).toEqual({ all: 4, photo: 1, video: 1, documents: 2 });
  });

  it("filters newest first without changing open/download/delete semantics", () => {
    const rows = [
      item({ id: "old-pdf", media_type: "pdf", created_at: "2026-05-01T10:00:00.000Z" }),
      item({ id: "new-doc", media_type: "document", created_at: "2026-05-02T10:00:00.000Z" }),
      item({ id: "photo", media_type: "photo", created_at: "2026-05-03T10:00:00.000Z" }),
    ];

    expect(filterProjectMediaByCategory(rows, "documents").map((row) => row.id)).toEqual([
      "new-doc",
      "old-pdf",
    ]);
    expect(filterProjectMediaByCategory(rows, "all").map((row) => row.id)).toEqual([
      "photo",
      "new-doc",
      "old-pdf",
    ]);
  });
});
