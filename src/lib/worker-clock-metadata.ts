/**
 * Pure helpers for composing time_events.metadata around the worker
 * clock-in / clock-out flow. Lives outside the React shell so the
 * "what shape does a no-GPS shift get?" decision can be unit-tested
 * without spinning up Supabase or React state.
 *
 * Contract:
 *   • A shift WITH a real GPS fix has no marker fields — manager
 *     review sees a normal row.
 *   • A shift opened explicitly without GPS gets:
 *       - location_unverified: true   (legacy reader compat)
 *       - gps_status: "no_gps" | "gps_denied" | "gps_unavailable"
 *                   | "gps_unsupported"
 *       - gps_error_kind: only when the original error type is known
 *       - needs_review: true          (manager-side highlight)
 *   • An offline-queued event additionally gets gps_status =
 *     "offline_pending_sync" so a manager can tell "no fix yet" from
 *     "couldn't reach the network" — both still need review.
 */

export type WorkerGpsErrorKind = "denied" | "unavailable" | "unsupported";

export type WorkerGpsStatusMarker =
  | "no_gps"
  | "gps_denied"
  | "gps_unavailable"
  | "gps_unsupported"
  | "offline_pending_sync";

export interface NoGpsMetadataInput {
  /** True when the worker chose "Start without GPS" or the device had no fix. */
  skippedGps: boolean;
  /** Original GPS error kind, if known. */
  errorKind?: WorkerGpsErrorKind | null;
  /** True when the time_event was queued because the network is down. */
  offlineQueued?: boolean;
  /** True when no-GPS is expected for this project and should not demand review. */
  gpsReviewSuppressed?: boolean;
}

export interface NoGpsMetadataPatch {
  /** Always true — drives manager-side "this shift skipped GPS" highlights. */
  location_unverified?: boolean;
  /** Canonical marker. Manager review reads this as the source of truth. */
  gps_status?: WorkerGpsStatusMarker;
  /** Free-form copy of the original error kind, when present. */
  gps_error_kind?: WorkerGpsErrorKind;
  /** True when the manager should look at this shift before approving. */
  needs_review?: boolean;
}

/**
 * Returns the metadata patch to merge into a time_events row when the
 * worker is starting / closing a shift without a GPS fix. Returns an
 * empty object for a normal GPS-having shift so callers can spread
 * unconditionally.
 */
export function buildNoGpsMetadata(input: NoGpsMetadataInput): NoGpsMetadataPatch {
  if (!input.skippedGps && !input.offlineQueued) {
    return {};
  }
  if (input.offlineQueued) {
    return {
      location_unverified: true,
      gps_status: "offline_pending_sync",
      ...(input.errorKind ? { gps_error_kind: input.errorKind } : {}),
      ...(input.gpsReviewSuppressed ? {} : { needs_review: true }),
    };
  }
  let status: WorkerGpsStatusMarker = "no_gps";
  if (input.errorKind === "denied") status = "gps_denied";
  else if (input.errorKind === "unavailable") status = "gps_unavailable";
  else if (input.errorKind === "unsupported") status = "gps_unsupported";
  return {
    location_unverified: true,
    gps_status: status,
    ...(input.errorKind ? { gps_error_kind: input.errorKind } : {}),
    ...(input.gpsReviewSuppressed ? {} : { needs_review: true }),
  };
}
