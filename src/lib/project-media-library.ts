import type { MediaType } from "@/types/database";

export type ProjectMediaCategory = "all" | "photo" | "video" | "documents";

export type ProjectMediaLike = {
  media_type: MediaType | string;
  mime_type?: string | null;
  filename?: string | null;
  created_at?: string | null;
};

const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|csv|txt|tsv)$/i;

export function classifyProjectMediaCategory(item: ProjectMediaLike): Exclude<ProjectMediaCategory, "all"> {
  const mediaType = item.media_type;
  const mime = (item.mime_type ?? "").toLowerCase();
  const filename = item.filename ?? "";

  if (mediaType === "photo" || mime.startsWith("image/")) return "photo";
  if (mediaType === "video" || mime.startsWith("video/")) return "video";
  if (
    mediaType === "pdf" ||
    mediaType === "document" ||
    mime === "application/pdf" ||
    mime.includes("wordprocessingml") ||
    mime.includes("spreadsheetml") ||
    mime.includes("msword") ||
    mime.includes("ms-excel") ||
    mime === "text/csv" ||
    mime === "application/csv" ||
    DOCUMENT_EXTENSIONS.test(filename)
  ) {
    return "documents";
  }

  return "documents";
}

export function countProjectMediaCategories(items: readonly ProjectMediaLike[]) {
  let photo = 0;
  let video = 0;
  let documents = 0;

  for (const item of items) {
    const category = classifyProjectMediaCategory(item);
    if (category === "photo") photo += 1;
    else if (category === "video") video += 1;
    else documents += 1;
  }

  return { all: items.length, photo, video, documents };
}

export function filterProjectMediaByCategory<T extends ProjectMediaLike>(
  items: readonly T[],
  category: ProjectMediaCategory,
): T[] {
  const sorted = [...items].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });

  if (category === "all") return sorted;

  return sorted.filter((item) => classifyProjectMediaCategory(item) === category);
}
