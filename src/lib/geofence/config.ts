// Geofencing G1 — operational thresholds.
//
// CONFIG LOCATION DECISION (flagged for chat): these are CONSTANTS for now.
// There is no owner-facing config UI for them yet — that arrives with the
// later geofence-config / G2 phase. The repo's org-level settings pattern is
// `app_settings.settings` (jsonb), read via getAppGeofenceRadiusM() in
// src/lib/geofence.ts; when the config UI lands, these keys should move there
// with the same read-with-fallback shape. Until then, editing this file is the
// only way to change them.
//
// NOTE: the fence *radius* is deliberately NOT here. It already flows from the
// existing per-project / app_settings pattern via resolveProjectRadiusM(), and
// is reused verbatim so G1 evaluation matches clock-in geofence enforcement.

/** Age at/after which the latest live point counts as "no signal". */
export const GEOFENCE_NO_SIGNAL_AFTER_MS = 15 * 60 * 1000;

/**
 * Evaluation cadence. Informational only — the authoritative schedule is the
 * cron entry in vercel.json. Kept here so the intended 5-minute cadence is
 * documented next to the other thresholds.
 */
export const GEOFENCE_SCAN_CADENCE_MS = 5 * 60 * 1000;

/**
 * Minimum accuracy buffer added to the fence radius before deciding
 * in_zone vs out_of_zone. Mirrors clock-in enforcement's
 * `max(accuracy, 25)` so a worker who could legitimately clock in does not
 * immediately read as out_of_zone due to normal GPS jitter.
 */
export const GEOFENCE_ACCURACY_BUFFER_M = 25;

export type GeofenceThresholds = {
  noSignalAfterMs: number;
  accuracyBufferM: number;
};

export const DEFAULT_GEOFENCE_THRESHOLDS: GeofenceThresholds = {
  noSignalAfterMs: GEOFENCE_NO_SIGNAL_AFTER_MS,
  accuracyBufferM: GEOFENCE_ACCURACY_BUFFER_M,
};
