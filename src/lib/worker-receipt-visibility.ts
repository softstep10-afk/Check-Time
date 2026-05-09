/**
 * Worker-side receipt / material visibility helper.
 *
 * The construction-clock app is project-centered. A worker can submit
 * receipts on a project they are assigned to, but they must NOT see
 * other workers' receipts on the same project — the per-line amount
 * is effectively the project's material cost broken down per receipt,
 * and rolling that up gives the worker visibility into project-level
 * spending the spec explicitly forbids.
 *
 * The manager / owner surfaces continue to see everything via their
 * own queries; this helper only narrows the worker view.
 */

export interface ReceiptMediaLike {
  uploaded_by: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * True when the row is a receipt by either the legacy
 * `metadata.category === "receipt"` shape (worker-side
 * WorkerReceiptUpload) or the manager-side `metadata.kind === "receipt"`
 * shape (ProjectDetailPage ReceiptsSection). Accepting both keeps a
 * mixed-history org's UI consistent.
 */
export function isReceiptMedia(media: ReceiptMediaLike): boolean {
  const meta = media.metadata ?? null;
  if (!meta) return false;
  return meta.kind === "receipt" || meta.category === "receipt";
}

/**
 * Should this receipt row be shown to the worker viewing the project
 * page? Returns true only when:
 *   • it IS a receipt, AND
 *   • it was uploaded by the current worker.
 *
 * Manager / owner views never call this — they see everything.
 */
export function isReceiptVisibleToWorker(
  media: ReceiptMediaLike,
  workerProfileId: string,
): boolean {
  if (!isReceiptMedia(media)) return false;
  return media.uploaded_by === workerProfileId;
}
