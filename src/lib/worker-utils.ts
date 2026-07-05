import type { Media, Project, TimeEvent } from "@/types/database";
import type {
  WorkerClockState,
  WorkerGeoPoint,
  WorkerMediaItem,
  WorkerProject,
  WorkerSession,
  WorkerSummary,
} from "@/lib/worker-types";

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidGeoPoint(
  point: Partial<WorkerGeoPoint> | null | undefined,
): point is WorkerGeoPoint {
  if (!point) {
    return false;
  }

  return isValidLatitude(point.lat ?? Number.NaN) && isValidLongitude(point.lng ?? Number.NaN);
}

export const DEVICE_LOCATION_WARNING_THRESHOLD_METERS = 100;

export interface DeviceLocationAssessment {
  accuracyMeters: number | null;
  shouldWarn: boolean;
}

export function assessDeviceLocationAccuracy(
  value: unknown,
  warningThresholdMeters = DEVICE_LOCATION_WARNING_THRESHOLD_METERS,
): DeviceLocationAssessment {
  const accuracyMeters =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.round(value)
      : null;

  if (accuracyMeters === null) {
    return {
      accuracyMeters: null,
      shouldWarn: true,
    };
  }

  return {
    accuracyMeters,
    shouldWarn: accuracyMeters > warningThresholdMeters,
  };
}

export function parseCoordinateInputPair(
  latValue: unknown,
  lngValue: unknown,
  options: { allowBlank?: boolean } = {},
): { point: WorkerGeoPoint | null; error: "missing" | "invalid" | null } {
  const allowBlank = options.allowBlank ?? false;
  const latText = latValue?.toString().trim() ?? "";
  const lngText = lngValue?.toString().trim() ?? "";
  const hasLat = latText.length > 0;
  const hasLng = lngText.length > 0;

  if (!hasLat && !hasLng) {
    return {
      point: null,
      error: allowBlank ? null : "missing",
    };
  }

  if (hasLat !== hasLng) {
    return { point: null, error: "missing" };
  }

  const point = {
    lat: Number(latText),
    lng: Number(lngText),
  };

  if (!isValidGeoPoint(point)) {
    return { point: null, error: "invalid" };
  }

  return { point, error: null };
}

export function parseGeoPoint(value: unknown): WorkerGeoPoint | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const match = value.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (match) {
      const lng = Number.parseFloat(match[1]);
      const lat = Number.parseFloat(match[2]);
      if (isValidGeoPoint({ lat, lng })) {
        return { lat, lng };
      }
    }

    // PostGIS hex-encoded WKB (EWKB) — what supabase-js returns for
    // a `geography(POINT, 4326)` column by default. 50 hex chars
    // (25 bytes): 1 byte endian, 4 bytes type, 4 bytes SRID, 8 bytes
    // X (lng), 8 bytes Y (lat), all little-endian.
    if (/^[0-9a-fA-F]+$/.test(value) && value.length >= 50) {
      const hex = value;
      try {
        const bytes = new Uint8Array(25);
        for (let i = 0; i < 25; i += 1) {
          bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        const view = new DataView(bytes.buffer);
        const littleEndian = bytes[0] === 1;
        const lng = view.getFloat64(9, littleEndian);
        const lat = view.getFloat64(17, littleEndian);
        if (isValidGeoPoint({ lat, lng })) {
          return { lat, lng };
        }
      } catch {
        // fall through
      }
    }

    return null;
  }

  if (typeof value === "object") {
    const maybePoint = value as {
      coordinates?: unknown;
      lat?: unknown;
      lng?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      x?: unknown;
      y?: unknown;
    };

    if (Array.isArray(maybePoint.coordinates) && maybePoint.coordinates.length >= 2) {
      const [lng, lat] = maybePoint.coordinates;
      if (typeof lat === "number" && typeof lng === "number" && isValidGeoPoint({ lat, lng })) {
        return { lat, lng };
      }
    }

    if (
      typeof maybePoint.lat === "number" &&
      typeof maybePoint.lng === "number" &&
      isValidGeoPoint({ lat: maybePoint.lat, lng: maybePoint.lng })
    ) {
      return { lat: maybePoint.lat, lng: maybePoint.lng };
    }

    if (
      typeof maybePoint.latitude === "number" &&
      typeof maybePoint.longitude === "number" &&
      isValidGeoPoint({
        lat: maybePoint.latitude,
        lng: maybePoint.longitude,
      })
    ) {
      return {
        lat: maybePoint.latitude,
        lng: maybePoint.longitude,
      };
    }

    if (
      typeof maybePoint.y === "number" &&
      typeof maybePoint.x === "number" &&
      isValidGeoPoint({ lat: maybePoint.y, lng: maybePoint.x })
    ) {
      return { lat: maybePoint.y, lng: maybePoint.x };
    }
  }

  return null;
}

export function toSupabasePoint(point: WorkerGeoPoint): string {
  return `SRID=4326;POINT(${point.lng} ${point.lat})`;
}

export function haversineMeters(a: WorkerGeoPoint, b: WorkerGeoPoint): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function getProjectName(projectsById: Map<string, WorkerProject>, projectId: string): string {
  return projectsById.get(projectId)?.name ?? "Unknown project";
}

const CHECKOUT_ORPHAN_BEFORE_CLOCK_IN_GRACE_MS = 15 * 60 * 1000;
const CHECKOUT_ORPHAN_AFTER_CLOCK_OUT_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

function mediaTimeMs(item: WorkerMediaItem): number | null {
  const value = new Date(item.created_at).getTime();
  return Number.isFinite(value) ? value : null;
}

function findOrphanCheckoutMedia(
  clockInEvent: TimeEvent,
  clockOutEvent: TimeEvent,
  orphanCheckoutMedia: WorkerMediaItem[],
  usedOrphanMediaIds: Set<string>,
): WorkerMediaItem | null {
  const clockInMs = new Date(clockInEvent.event_time).getTime();
  const clockOutMs = new Date(clockOutEvent.event_time).getTime();

  if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs)) {
    return null;
  }

  const windowStart = clockInMs - CHECKOUT_ORPHAN_BEFORE_CLOCK_IN_GRACE_MS;
  const windowEnd = clockOutMs + CHECKOUT_ORPHAN_AFTER_CLOCK_OUT_GRACE_MS;

  return (
    orphanCheckoutMedia.find((item) => {
      if (usedOrphanMediaIds.has(item.id)) return false;
      if (item.project_id !== clockOutEvent.project_id) return false;
      const createdMs = mediaTimeMs(item);
      if (createdMs === null) return false;
      return createdMs >= windowStart && createdMs <= windowEnd;
    }) ?? null
  );
}

function getCheckoutStatus(
  clockOutEvent: TimeEvent | null,
  checkoutMediaByEventId: Map<string, WorkerMediaItem>,
  orphanCheckoutMedia?: WorkerMediaItem | null,
): WorkerSession["checkoutStatus"] {
  if (!clockOutEvent) {
    return "not_required";
  }

  if (clockOutEvent.video_status === "not_required") {
    return "not_required";
  }

  const checkoutMedia = checkoutMediaByEventId.get(clockOutEvent.id);
  if (checkoutMedia) {
    return "uploaded";
  }

  if (orphanCheckoutMedia) {
    return "uploaded";
  }

  return clockOutEvent.video_status;
}

/**
 * Mirror of getCheckoutStatus for the start-of-shift video. Sources
 * the truth from `clock_in.video_status`. Falls back to "uploaded"
 * when a matching `before_work` media row already exists locally so
 * the warning clears optimistically while the linker route flips
 * the event row server-side.
 */
function getStartVideoStatus(
  clockInEvent: TimeEvent,
  startMediaByEventId: Map<string, WorkerMediaItem>,
): WorkerSession["startVideoStatus"] {
  if (clockInEvent.video_status === "not_required") {
    return "not_required";
  }

  const startMedia = startMediaByEventId.get(clockInEvent.id);
  if (startMedia) {
    return "uploaded";
  }

  return clockInEvent.video_status;
}

export function buildWorkerSessions(
  events: TimeEvent[],
  projects: WorkerProject[],
  media: WorkerMediaItem[],
): WorkerSession[] {
  const orderedEvents = [...events].sort((left, right) => {
    return new Date(left.event_time).getTime() - new Date(right.event_time).getTime();
  });
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const checkoutMediaByEventId = new Map(
    media
      .filter((item) => item.is_checkout && item.time_event_id)
      .map((item) => [item.time_event_id as string, item]),
  );
  const orphanCheckoutMedia = media
    .filter(
      (item) =>
        item.is_checkout &&
        item.media_type === "video" &&
        item.time_event_id === null,
    )
    .sort((left, right) => {
      return (mediaTimeMs(left) ?? 0) - (mediaTimeMs(right) ?? 0);
    });
  const usedOrphanMediaIds = new Set<string>();
  // Start-video proof: media tagged metadata.kind="before_work" and
  // linked back to the clock_in event. Same shape as the checkout map,
  // different filter so the two evidence streams never collide.
  const startMediaByEventId = new Map(
    media
      .filter((item) => {
        const meta = item.metadata as Record<string, unknown> | null;
        return (
          item.is_checkout === false &&
          item.time_event_id !== null &&
          meta?.kind === "before_work"
        );
      })
      .map((item) => [item.time_event_id as string, item]),
  );
  const sessions: WorkerSession[] = [];
  let openClockIn: TimeEvent | null = null;

  for (const event of orderedEvents) {
    if (event.event_type === "clock_in") {
      openClockIn = event;
      continue;
    }

    if (event.event_type !== "clock_out" && event.event_type !== "auto_out") {
      continue;
    }

    if (!openClockIn) {
      continue;
    }

    const durationMinutes = Math.max(
      0,
      Math.round(
        (new Date(event.event_time).getTime() -
          new Date(openClockIn.event_time).getTime()) /
          60_000,
      ),
    );

    const orphanProof = findOrphanCheckoutMedia(
      openClockIn,
      event,
      orphanCheckoutMedia,
      usedOrphanMediaIds,
    );
    if (orphanProof) {
      usedOrphanMediaIds.add(orphanProof.id);
    }

    sessions.push({
      id: openClockIn.id,
      projectId: openClockIn.project_id,
      projectName: getProjectName(projectsById, openClockIn.project_id),
      clockInEventId: openClockIn.id,
      clockOutEventId: event.id,
      clockInTime: openClockIn.event_time,
      clockOutTime: event.event_time,
      durationMinutes,
      checkoutStatus: getCheckoutStatus(event, checkoutMediaByEventId, orphanProof),
      startVideoStatus: getStartVideoStatus(openClockIn, startMediaByEventId),
    });

    openClockIn = null;
  }

  if (openClockIn) {
    const durationMinutes = Math.max(
      0,
      Math.round((Date.now() - new Date(openClockIn.event_time).getTime()) / 60_000),
    );

    sessions.push({
      id: openClockIn.id,
      projectId: openClockIn.project_id,
      projectName: getProjectName(projectsById, openClockIn.project_id),
      clockInEventId: openClockIn.id,
      clockOutEventId: null,
      clockInTime: openClockIn.event_time,
      clockOutTime: null,
      durationMinutes,
      checkoutStatus: "not_required",
      startVideoStatus: getStartVideoStatus(openClockIn, startMediaByEventId),
    });
  }

  return sessions.sort((left, right) => {
    return new Date(right.clockInTime).getTime() - new Date(left.clockInTime).getTime();
  });
}

export function deriveClockState(sessions: WorkerSession[]): WorkerClockState {
  const openSession = sessions.find((session) => session.clockOutTime === null) ?? null;
  const pendingCheckout = sessions.find(
    (session) => session.clockOutTime && session.checkoutStatus === "pending",
  ) ?? null;
  // Start-video gate is anchored to the open shift only — once a worker
  // clocks out, the close-side flow takes over and a stale "start
  // required" warning would just confuse them.
  const pendingStartVideo =
    openSession && openSession.startVideoStatus === "pending" ? openSession : null;

  return {
    isClockedIn: Boolean(openSession),
    clockInTime: openSession?.clockInTime ?? null,
    currentProjectId: openSession?.projectId ?? null,
    currentProjectName: openSession?.projectName ?? null,
    openEventId: openSession?.clockInEventId ?? null,
    pendingCheckoutEventId: pendingCheckout?.clockOutEventId ?? null,
    pendingCheckoutProjectId: pendingCheckout?.projectId ?? null,
    pendingCheckoutProjectName: pendingCheckout?.projectName ?? null,
    pendingStartVideoEventId: pendingStartVideo?.clockInEventId ?? null,
    pendingStartVideoProjectId: pendingStartVideo?.projectId ?? null,
    pendingStartVideoProjectName: pendingStartVideo?.projectName ?? null,
  };
}

function isInCurrentWeek(date: Date): boolean {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(today.getDate() + mondayOffset);

  return date >= weekStart;
}

export function deriveWorkerSummary(sessions: WorkerSession[]): WorkerSummary {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let todayMinutes = 0;
  let weekMinutes = 0;

  for (const session of sessions) {
    const clockInDate = new Date(session.clockInTime);

    if (clockInDate >= today) {
      todayMinutes += session.durationMinutes;
    }

    if (isInCurrentWeek(clockInDate)) {
      weekMinutes += session.durationMinutes;
    }
  }

  return {
    todayMinutes,
    weekMinutes,
    totalSessions: sessions.length,
  };
}

export function formatDurationCompact(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}

export function formatElapsedSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hourCycle: "h23",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatEventDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hourCycle: "h23",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function slugifyFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function guessMediaType(file: File): Media["media_type"] {
  const mime = file.type.toLowerCase();
  const lowerName = file.name.toLowerCase();

  if (mime.startsWith("image/")) {
    return "photo";
  }

  if (mime.startsWith("video/")) {
    return "video";
  }

  if (mime === "application/pdf") {
    return "pdf";
  }

  // Cloud pickers (Google Drive, iCloud, OneDrive) often hand back a File
  // with file.type === "" or application/octet-stream. Fall back to the
  // filename extension so the media row's media_type remains accurate.
  if (/\.(jpe?g|png|webp|heic|heif|gif)$/.test(lowerName)) return "photo";
  if (/\.(mp4|mov|webm)$/.test(lowerName)) return "video";
  if (lowerName.endsWith(".pdf")) return "pdf";

  return "document";
}

export function enrichProjects(
  rawProjects: Project[],
  assignedAtByProjectId: Map<string, string | null>,
): WorkerProject[] {
  return rawProjects.map((project) => ({
    ...project,
    assignedAt: assignedAtByProjectId.get(project.id) ?? null,
    site: parseGeoPoint(project.site_point),
  }));
}
