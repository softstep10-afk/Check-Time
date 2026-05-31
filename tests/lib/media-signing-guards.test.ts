import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getSignableStoragePath } from "@/lib/task-attachments";

const projectsPageSource = readFileSync(
  resolve(process.cwd(), "src/components/manager/ProjectsPage.tsx"),
  "utf8",
);

describe("media signing guards", () => {
  it("does not sign empty or malformed storage paths", () => {
    expect(getSignableStoragePath(null)).toBeNull();
    expect(getSignableStoragePath(undefined)).toBeNull();
    expect(getSignableStoragePath("")).toBeNull();
    expect(getSignableStoragePath("   ")).toBeNull();
    expect(getSignableStoragePath("media/")).toBeNull();
    expect(getSignableStoragePath("/media/")).toBeNull();
    expect(getSignableStoragePath("https://example.com/photo.jpg")).toBeNull();
  });

  it("keeps valid private media paths signable", () => {
    expect(getSignableStoragePath("org-123/project-456/photo.jpg")).toBe(
      "org-123/project-456/photo.jpg",
    );
    expect(getSignableStoragePath("/org-123/project-456/photo.jpg")).toBe(
      "org-123/project-456/photo.jpg",
    );
    expect(getSignableStoragePath("media/org-123/project-456/photo.jpg")).toBe(
      "org-123/project-456/photo.jpg",
    );
  });

  it("guards project thumbnails before calling Supabase signed URL creation", () => {
    expect(projectsPageSource).toContain(
      "const normalizedPath = useMemo(() => getSignableStoragePath(storagePath), [storagePath]);",
    );
    expect(projectsPageSource).toContain("if (!normalizedPath) return;");
    expect(projectsPageSource).toContain("createSignedUrl(normalizedPath, 3600)");
    expect(projectsPageSource).toContain("useThumbnailUrl(isPhoto ? item.storage_path : null)");
    expect(projectsPageSource).not.toContain('useThumbnailUrl(isPhoto ? item.storage_path : "")');
  });
});
