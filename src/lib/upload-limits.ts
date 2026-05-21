/**
 * Single source of truth for upload size + MIME validation. Used by
 * every upload control (worker journal, manager receipts, message
 * attachments) so a 600 MB MOV gets the same friendly error in every
 * place instead of a generic Supabase Storage 413.
 */

export type UploadKind = "photo" | "video" | "pdf" | "document";

export const STORAGE_LIMITS_MB: Record<UploadKind, number> = {
  photo: 20,
  video: 500,
  pdf: 50,
  document: 100,
};

export const MIMES: Record<UploadKind, readonly string[]> = {
  photo: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/gif",
  ],
  video: ["video/mp4", "video/quicktime", "video/webm"],
  pdf: ["application/pdf"],
  document: [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "text/tab-separated-values",
  ],
};

export const ACCEPT_IMAGE_UPLOADS = [
  ...MIMES.photo,
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".gif",
].join(",");

export const ACCEPT_VIDEO_UPLOADS = [
  ...MIMES.video,
  ".mp4",
  ".mov",
  ".webm",
].join(",");

export const ACCEPT_PDF_UPLOADS = [...MIMES.pdf, ".pdf"].join(",");

export const ACCEPT_DOCUMENT_UPLOADS = [
  ...MIMES.document,
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
  ".tsv",
].join(",");

/** All safe business attachment types for an `<input accept="…">` attribute. */
export const ACCEPT_ALL_UPLOADS = [
  ACCEPT_IMAGE_UPLOADS,
  ACCEPT_VIDEO_UPLOADS,
  ACCEPT_PDF_UPLOADS,
  ACCEPT_DOCUMENT_UPLOADS,
].join(",");

export function classifyMime(mime: string): UploadKind | null {
  const normalized = mime.toLowerCase();
  if (MIMES.photo.includes(normalized)) return "photo";
  if (MIMES.video.includes(normalized)) return "video";
  if (MIMES.pdf.includes(normalized)) return "pdf";
  if (MIMES.document.includes(normalized)) return "document";
  return null;
}

export type UploadValidationError =
  | { reason: "too_large"; kind: UploadKind; sizeMb: number; limitMb: number }
  | { reason: "unsupported_type"; mime: string };

export type UploadValidation =
  | { ok: true; kind: UploadKind }
  | { ok: false; error: UploadValidationError };

export function validateUploadFile(file: File): UploadValidation {
  // Heuristic for unknown MIMEs: fall back to file extension classification.
  const kind = classifyMime(file.type) ?? classifyByExtension(file.name);
  if (!kind) {
    return { ok: false, error: { reason: "unsupported_type", mime: file.type || file.name } };
  }
  const limitMb = STORAGE_LIMITS_MB[kind];
  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb > limitMb) {
    return {
      ok: false,
      error: { reason: "too_large", kind, sizeMb, limitMb },
    };
  }
  return { ok: true, kind };
}

function classifyByExtension(name: string): UploadKind | null {
  const lower = name.toLowerCase();
  if (/\.(jpe?g|png|webp|heic|heif|gif)$/.test(lower)) return "photo";
  if (/\.(mp4|mov|webm)$/.test(lower)) return "video";
  if (/\.pdf$/.test(lower)) return "pdf";
  if (/\.(docx?|xlsx?|csv|txt|tsv)$/.test(lower)) return "document";
  return null;
}

export function inferUploadContentType(file: File): string {
  if (file.type) return file.type;
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(jpe?g)$/.test(lower)) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".heif")) return "image/heif";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".tsv")) return "text/tab-separated-values";
  return "application/octet-stream";
}
