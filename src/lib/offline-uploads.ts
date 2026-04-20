/**
 * Browser-side offline queue for worker uploads.
 *
 * When navigator.onLine is false, WorkerShell.uploadMedia hands each file
 * here. Items live in localStorage under OFFLINE_KEY so they survive a
 * page refresh; on the next 'online' event the WorkerShell drains the
 * queue and calls back into the real Supabase upload path.
 *
 * Files ≤ INLINE_MAX_BYTES (10 MB) are serialized as base64 data URLs and
 * uploaded transparently when the connection returns.
 *
 * Files > 10 MB are saved as a thumbnail + metadata only — full bytes are
 * dropped on the floor. The retry path surfaces a "re-pick this file"
 * prompt so the worker can re-attach the real file once back online.
 *
 * localStorage realistically caps around 5 MB per origin. We try the
 * write, and if it throws QuotaExceeded we degrade to thumb-only and
 * try again before giving up.
 */

export const OFFLINE_KEY = "cc_offline_uploads";

export const INLINE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const THUMB_MAX_DIMENSION = 320;            // px on the long edge
export const THUMB_MAX_BYTES = 64 * 1024;          // ~64 KB per thumb

export type OfflineUploadMode = "journal" | "before_leave" | "checkout";

export interface OfflineUploadFull {
  kind: "full";
  /** base64 data URL of the original file */
  dataUrl: string;
  filename: string;
  mime: string;
  sizeBytes: number;
}

export interface OfflineUploadThumb {
  kind: "thumb_only";
  /** Base64 thumbnail when we could generate one (images / video posters);
   *  may be null for PDFs or video where we couldn't decode. */
  thumbDataUrl: string | null;
  filename: string;
  mime: string;
  sizeBytes: number;
}

export interface OfflineUpload {
  id: string;
  mode: OfflineUploadMode;
  projectId: string;
  profileId: string;
  orgId: string;
  caption: string;
  createdAt: string;
  payload: OfflineUploadFull | OfflineUploadThumb;
}

// ── Persistence ────────────────────────────────────────────────────────────

export function loadOfflineQueue(): OfflineUpload[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(OFFLINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Filter to plausibly-shaped rows so a corrupt entry doesn't poison
    // the whole queue.
    return parsed.filter(
      (entry): entry is OfflineUpload =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as OfflineUpload).id === "string" &&
        typeof (entry as OfflineUpload).mode === "string",
    );
  } catch {
    return [];
  }
}

function persist(items: OfflineUpload[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(OFFLINE_KEY, JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}

export function clearOfflineQueue(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OFFLINE_KEY);
  } catch {
    // Ignore.
  }
}

export function removeOfflineUpload(id: string): OfflineUpload[] {
  const remaining = loadOfflineQueue().filter((item) => item.id !== id);
  persist(remaining);
  return remaining;
}

// ── Queue + serialize ──────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

async function makeThumbDataUrl(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (!file.type.startsWith("image/")) return null;

  return new Promise((resolve) => {
    const img = new window.Image();
    const objectUrl = window.URL.createObjectURL(file);
    img.onload = () => {
      const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const scale = Math.min(1, THUMB_MAX_DIMENSION / longEdge);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        window.URL.revokeObjectURL(objectUrl);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      try {
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        // Cap the thumb size — drop quality progressively if we're over.
        if (dataUrl.length > THUMB_MAX_BYTES * 1.4) {
          resolve(canvas.toDataURL("image/jpeg", 0.4));
        } else {
          resolve(dataUrl);
        }
      } catch {
        resolve(null);
      } finally {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      window.URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

export interface QueueArgs {
  file: File;
  mode: OfflineUploadMode;
  projectId: string;
  profileId: string;
  orgId: string;
  caption: string;
}

export type QueueResult =
  | { ok: true; upload: OfflineUpload; degraded: boolean; queue: OfflineUpload[] }
  | { ok: false; reason: "storage_full" | "encode_failed" };

export async function queueOfflineUpload(args: QueueArgs): Promise<QueueResult> {
  const big = args.file.size > INLINE_MAX_BYTES;

  let payload: OfflineUploadFull | OfflineUploadThumb;
  let degraded = false;

  if (big) {
    payload = {
      kind: "thumb_only",
      thumbDataUrl: await makeThumbDataUrl(args.file),
      filename: args.file.name,
      mime: args.file.type,
      sizeBytes: args.file.size,
    };
    degraded = true;
  } else {
    try {
      const dataUrl = await fileToDataUrl(args.file);
      payload = {
        kind: "full",
        dataUrl,
        filename: args.file.name,
        mime: args.file.type,
        sizeBytes: args.file.size,
      };
    } catch {
      return { ok: false, reason: "encode_failed" };
    }
  }

  const upload: OfflineUpload = {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: args.mode,
    projectId: args.projectId,
    profileId: args.profileId,
    orgId: args.orgId,
    caption: args.caption,
    createdAt: new Date().toISOString(),
    payload,
  };

  let next = [...loadOfflineQueue(), upload];
  if (!persist(next)) {
    // localStorage full — degrade the new entry to thumb-only and retry.
    if (payload.kind === "full") {
      const fallback: OfflineUploadThumb = {
        kind: "thumb_only",
        thumbDataUrl: await makeThumbDataUrl(args.file),
        filename: args.file.name,
        mime: args.file.type,
        sizeBytes: args.file.size,
      };
      const retry: OfflineUpload = { ...upload, payload: fallback };
      next = [...loadOfflineQueue(), retry];
      if (!persist(next)) return { ok: false, reason: "storage_full" };
      return { ok: true, upload: retry, degraded: true, queue: next };
    }
    return { ok: false, reason: "storage_full" };
  }

  return { ok: true, upload, degraded, queue: next };
}

// ── Decode ─────────────────────────────────────────────────────────────────

/**
 * Reconstruct a File from a stored full-payload entry. Returns null for
 * thumb-only entries — caller must prompt the user to re-pick the file.
 */
export function offlineUploadToFile(upload: OfflineUpload): File | null {
  if (upload.payload.kind !== "full") return null;
  const { dataUrl, filename, mime } = upload.payload;
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return null;
  const base64 = dataUrl.slice(commaIdx + 1);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  } catch {
    return null;
  }
}
