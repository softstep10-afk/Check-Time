/**
 * Map the most common camera / file-picker MIME types to a playable
 * filename extension. Used at upload time so a fresh storage path always
 * carries a clean extension — iOS captures sometimes ship with empty
 * `file.name`, which previously left the storage path extension-less and
 * the manager's download/open flow with no hint of the real file type.
 *
 * Returns "" for unknown MIMEs; callers should fall back to the file's
 * original extension or `.bin` as a last resort.
 */
export function extensionFromMime(mime: string | null | undefined): string {
  if (!mime) return "";
  switch (mime.toLowerCase()) {
    // video
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    case "video/webm":
      return ".webm";
    case "video/x-matroska":
      return ".mkv";
    case "video/3gpp":
      return ".3gp";
    // image
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/heic":
      return ".heic";
    case "image/heif":
      return ".heif";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    // doc
    case "application/pdf":
      return ".pdf";
    case "application/msword":
      return ".doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return ".docx";
    case "application/vnd.ms-excel":
      return ".xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return ".xlsx";
    case "application/csv":
      return ".csv";
    case "text/csv":
      return ".csv";
    case "text/plain":
      return ".txt";
    case "text/tab-separated-values":
      return ".tsv";
    default:
      return "";
  }
}

/**
 * Returns true when `name` already ends with a `.ext` of 1-5 alnum chars.
 */
export function hasFilenameExtension(name: string): boolean {
  return /\.[a-z0-9]{1,5}$/i.test(name);
}

/**
 * Build a storage-safe filename that always has a playable extension
 * derived from the file's MIME when possible. `mode` is used as a
 * descriptive prefix when the picker returned an empty `file.name`.
 *
 *   buildSafeUploadName({ name: "IMG_1234.MOV", type: "video/quicktime" } as File)
 *     → "img_1234.mov"
 *
 *   buildSafeUploadName({ name: "", type: "video/mp4" } as File, "checkout")
 *     → "checkout-1727...mp4"
 *
 *   buildSafeUploadName({ name: "screenshot.png", type: "" } as File)
 *     → "screenshot.png"
 */
export function buildSafeUploadName(
  file: { name: string; type: string },
  fallbackPrefix = "upload",
): string {
  const slug = (raw: string): string =>
    raw
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "");

  if (file.name) {
    const slugged = slug(file.name);
    if (hasFilenameExtension(slugged)) return slugged;
    const ext = extensionFromMime(file.type);
    return ext ? `${slugged}${ext}` : slugged;
  }
  const ext = extensionFromMime(file.type);
  return `${fallbackPrefix}-${Date.now()}${ext}`;
}
