import type { Media, Project, TimeEvent } from "@/types/database";
import type {
  WorkerClockState,
  WorkerGeoPoint,
  WorkerMediaItem,
  WorkerProject,
  WorkerSession,
  WorkerSummary,
} from "@/lib/worker-types";

export function parseGeoPoint(value: unknown): WorkerGeoPoint | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    const match = value.match(/POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i);
    if (match) {
      const lng = Number.parseFloat(match[1]);
      const lat = Number.parseFloat(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
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
      if (typeof lat === "number" && typeof lng === "number") {
        return { lat, lng };
      }
    }

    if (typeof maybePoint.lat === "number" && typeof maybePoint.lng === "number") {
      return { lat: maybePoint.lat, lng: maybePoint.lng };
    }

    if (
      typeof maybePoint.latitude === "number" &&
      typeof maybePoint.longitude === "number"
    ) {
      return {
        lat: maybePoint.latitude,
        lng: maybePoint.longitude,
      };
    }

    if (typeof maybePoint.y === "number" && typeof maybePoint.x === "number") {
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

function getCheckoutStatus(
  clockOutEvent: TimeEvent | null,
  checkoutMediaByEventId: Map<string, WorkerMediaItem>,
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

  return clockOutEvent.video_status;
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

    sessions.push({
      id: openClockIn.id,
      projectId: openClockIn.project_id,
      projectName: getProjectName(projectsById, openClockIn.project_id),
      clockInEventId: openClockIn.id,
      clockOutEventId: event.id,
      clockInTime: openClockIn.event_time,
      clockOutTime: event.event_time,
      durationMinutes,
      checkoutStatus: getCheckoutStatus(event, checkoutMediaByEventId),
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

  return {
    isClockedIn: Boolean(openSession),
    clockInTime: openSession?.clockInTime ?? null,
    currentProjectId: openSession?.projectId ?? null,
    currentProjectName: openSession?.projectName ?? null,
    openEventId: openSession?.clockInEventId ?? null,
    pendingCheckoutEventId: pendingCheckout?.clockOutEventId ?? null,
    pendingCheckoutProjectId: pendingCheckout?.projectId ?? null,
    pendingCheckoutProjectName: pendingCheckout?.projectName ?? null,
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
  if (file.type.startsWith("image/")) {
    return "photo";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  if (file.type === "application/pdf") {
    return "pdf";
  }

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
