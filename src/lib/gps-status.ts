import { haversineMeters, parseGeoPoint } from "@/lib/worker-utils";

export type WorkerGpsStatus = "on_site" | "off_site" | "no_gps" | "no_fence";

export const GPS_STATUS_COLOR: Record<WorkerGpsStatus, string> = {
  on_site: "var(--green)",
  no_gps: "#f59e0b",
  off_site: "var(--red)",
  no_fence: "var(--text-muted)",
};

const FALLBACK_RADIUS_M = 75;

export function deriveWorkerGpsStatus(args: {
  clockInGpsPoint: unknown;
  projectSitePoint: unknown;
  projectRadiusM: number | null | undefined;
}): WorkerGpsStatus {
  const sitePoint = parseGeoPoint(args.projectSitePoint);
  if (!sitePoint) return "no_fence";

  const workerPoint = parseGeoPoint(args.clockInGpsPoint);
  if (!workerPoint) return "no_gps";

  const radius =
    typeof args.projectRadiusM === "number" &&
    Number.isFinite(args.projectRadiusM) &&
    args.projectRadiusM > 0
      ? args.projectRadiusM
      : FALLBACK_RADIUS_M;

  return haversineMeters(workerPoint, sitePoint) <= radius ? "on_site" : "off_site";
}
