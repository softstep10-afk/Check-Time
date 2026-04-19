import type { SupabaseClient } from "@supabase/supabase-js";

const FALLBACK_RADIUS_M = 75;
const CACHE_TTL_MS = 60_000;

let cached: { radius: number; at: number } | null = null;

/**
 * Org-wide geofence radius from public.app_settings.
 *
 * Cached for 60s in-memory. Falls back to FALLBACK_RADIUS_M when the table
 * is missing (migration 00005 not applied) or no row exists.
 *
 * Used by the worker check-in flow as the second fallback after the
 * per-project projects.gps_radius_m column.
 */
export async function getAppGeofenceRadiusM(
  supabase: SupabaseClient,
): Promise<number> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.radius;

  let radius = FALLBACK_RADIUS_M;
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("settings")
      .eq("id", 1)
      .maybeSingle();
    if (!error && data) {
      const settings = (data as { settings: Record<string, unknown> }).settings ?? {};
      const raw = Number(settings.geofence_radius_meters);
      if (Number.isFinite(raw) && raw >= 25 && raw <= 500) radius = raw;
    }
  } catch {
    // Swallow — fall back to default radius.
  }

  cached = { radius, at: now };
  return radius;
}

/**
 * Resolve the effective check-in radius for a project:
 *   per-project gps_radius_m → app_settings.geofence_radius_meters → 75m.
 */
export function resolveProjectRadiusM(
  project: { gps_radius_m?: number | null; radius_m?: number | null },
  appSettingsRadius: number,
): number {
  const perProject = project.gps_radius_m;
  if (typeof perProject === "number" && Number.isFinite(perProject) && perProject > 0) {
    return perProject;
  }
  if (Number.isFinite(appSettingsRadius) && appSettingsRadius > 0) {
    return appSettingsRadius;
  }
  const legacy = project.radius_m;
  if (typeof legacy === "number" && Number.isFinite(legacy) && legacy > 0) {
    return legacy;
  }
  return FALLBACK_RADIUS_M;
}
