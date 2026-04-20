/**
 * Single source of truth for upload size + MIME validation. Used by
 * every upload control (worker journal, manager receipts, message
 * attachments) so a 600 MB MOV gets the same friendly error in every
 * place instead of a generic Supabase Storage 413.
 */

export type UploadKind = "photo" | "video" | "pdf";

export const STORAGE_LIMITS_MB: Record<UploadKind, number> = {
  photo: 20,
  video: 500,
  pdf: 50,
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
};

/** All MIMEs joined for an `<input accept="…">` attribute. */
export const ACCEPT_ALL_UPLOADS = [
  ...MIMES.photo,
  ...MIMES.video,
  ...MIMES.pdf,
].join(",");

export function classifyMime(mime: string): UploadKind | null {
  if (MIMES.photo.includes(mime)) return "photo";
  if (MIMES.video.includes(mime)) return "video";
  if (MIMES.pdf.includes(mime)) return "pdf";
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
  return null;
}
