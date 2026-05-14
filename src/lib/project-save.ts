import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCoordinateInputPair, parseGeoPoint, toSupabasePoint } from "@/lib/worker-utils";
import type {
  Project,
  ProjectBudgetStatus,
  ProjectStatus,
  ProjectTimelineStatus,
} from "@/types/database";

export const PROJECT_GPS_RADIUS_MIN = 25;
export const PROJECT_GPS_RADIUS_MAX = 300;
export const PROJECT_GPS_RADIUS_DEFAULT = 75;
export const PROJECT_RADIUS_DEFAULT = 200;
export const PROJECT_RATE_DEFAULT = 25;

const PROJECT_STATUSES: ProjectStatus[] = ["active", "paused", "completed", "archived"];
const PROJECT_TIMELINE_STATUSES: ProjectTimelineStatus[] = ["on_track", "at_risk", "delayed"];
const PROJECT_BUDGET_STATUSES: ProjectBudgetStatus[] = ["on_budget", "over_budget", "critical"];
const CLIENT_TONES = ["green", "yellow", "red"] as const;
type ClientTone = (typeof CLIENT_TONES)[number];

export type ProjectWriteRecord = Pick<
  Project,
  | "id"
  | "org_id"
  | "rate"
  | "radius_m"
  | "status"
  | "site_point"
  | "start_date"
  | "end_date"
  | "settings"
  | "timeline_status"
  | "budget_status"
> & {
  gps_radius_m?: number | null;
};

type ValidationError = {
  ok: false;
  error: string;
  status: number;
};

type ValidationSuccess = {
  ok: true;
  payload: Record<string, unknown>;
};

export type ProjectSaveValidationResult = ValidationError | ValidationSuccess;

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function readText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }

  return "";
}

function readNullableText(value: unknown): string | null {
  const text = readText(value);
  return text || null;
}

function readFloat(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = readText(value);
  if (!text) {
    return null;
  }

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  const text = readText(value);
  if (!text) {
    return null;
  }

  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function readOptionalDate(body: Record<string, unknown>, key: string, fallback: string | null): string | null {
  if (!hasOwn(body, key)) {
    return fallback;
  }

  const value = readText(body[key]);
  return value || null;
}

function readConfirmed(value: unknown): boolean {
  return value === true || value === "true";
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && PROJECT_STATUSES.includes(value as ProjectStatus);
}

function isProjectTimelineStatus(value: unknown): value is ProjectTimelineStatus {
  return typeof value === "string" && PROJECT_TIMELINE_STATUSES.includes(value as ProjectTimelineStatus);
}

function isProjectBudgetStatus(value: unknown): value is ProjectBudgetStatus {
  return typeof value === "string" && PROJECT_BUDGET_STATUSES.includes(value as ProjectBudgetStatus);
}

function readClientTone(value: unknown, fallback: ClientTone): ClientTone {
  return typeof value === "string" && CLIENT_TONES.includes(value as ClientTone)
    ? (value as ClientTone)
    : fallback;
}

function readSettings(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function clampProjectGpsRadius(
  value: unknown,
  fallback = PROJECT_GPS_RADIUS_DEFAULT,
): number {
  const parsed = readInteger(value);
  if (parsed === null) {
    return fallback;
  }

  if (parsed < PROJECT_GPS_RADIUS_MIN) {
    return PROJECT_GPS_RADIUS_MIN;
  }

  if (parsed > PROJECT_GPS_RADIUS_MAX) {
    return PROJECT_GPS_RADIUS_MAX;
  }

  return parsed;
}

export function hasValidProjectSiteCoordinates(project: Pick<Project, "site_point">): boolean {
  return Boolean(parseGeoPoint(project.site_point));
}

export function validateProjectSaveBody(
  body: Record<string, unknown>,
  options: {
    allowBlankCoordinates: boolean;
    fallbackRate?: number;
    fallbackRadius?: number;
    fallbackGpsRadius?: number;
    defaultStatus?: ProjectStatus;
    fallbackStartDate?: string | null;
    fallbackEndDate?: string | null;
    fallbackSettings?: Record<string, unknown> | null;
    fallbackTimelineStatus?: ProjectTimelineStatus | null;
    fallbackBudgetStatus?: ProjectBudgetStatus | null;
    requireConfirmation?: boolean;
  },
): ProjectSaveValidationResult {
  const name = readText(body.name);
  if (!name) {
    return { ok: false, error: "Project name is required.", status: 400 };
  }

  const coordinates = parseCoordinateInputPair(body.lat, body.lng, {
    allowBlank: options.allowBlankCoordinates,
  });

  if (coordinates.error) {
    return {
      ok: false,
      error:
        coordinates.error === "invalid"
          ? "Latitude must be between -90 and 90 and longitude must be between -180 and 180."
          : "Valid latitude and longitude are required before saving this project.",
      status: 400,
    };
  }

  if ((options.requireConfirmation ?? true) && !readConfirmed(body.coordinatesConfirmed)) {
    return {
      ok: false,
      error: "Confirm these coordinates are correct for this job site before saving.",
      status: 400,
    };
  }

  const fallbackRate = options.fallbackRate ?? PROJECT_RATE_DEFAULT;
  const fallbackRadius = options.fallbackRadius ?? PROJECT_RADIUS_DEFAULT;
  const fallbackGpsRadius = options.fallbackGpsRadius ?? PROJECT_GPS_RADIUS_DEFAULT;
  const defaultStatus = options.defaultStatus ?? "active";
  const fallbackSettings = readSettings(options.fallbackSettings);
  const fallbackClientTone = readClientTone(fallbackSettings.client_tone, "green");
  const clientTone = readClientTone(body.client_tone, fallbackClientTone);

  const payload: Record<string, unknown> = {
    name,
    address: readNullableText(body.address),
    notes: readNullableText(body.notes),
    rate: readFloat(body.rate) ?? fallbackRate,
    radius_m: readInteger(body.radius_m) ?? fallbackRadius,
    gps_radius_m: hasOwn(body, "gps_radius_m")
      ? clampProjectGpsRadius(body.gps_radius_m, fallbackGpsRadius)
      : fallbackGpsRadius,
    status: isProjectStatus(body.status) ? body.status : defaultStatus,
    start_date: readOptionalDate(body, "start_date", options.fallbackStartDate ?? null),
    end_date: readOptionalDate(body, "end_date", options.fallbackEndDate ?? null),
    timeline_status: isProjectTimelineStatus(body.timeline_status)
      ? body.timeline_status
      : options.fallbackTimelineStatus ?? "on_track",
    budget_status: isProjectBudgetStatus(body.budget_status)
      ? body.budget_status
      : options.fallbackBudgetStatus ?? "on_budget",
    settings: {
      ...fallbackSettings,
      client_tone: clientTone,
    },
  };

  if (coordinates.point) {
    payload.site_point = toSupabasePoint(coordinates.point);
  }

  return { ok: true, payload };
}

export function isMissingGpsRadiusColumnError(
  error: { message?: string; code?: string } | null,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "PGRST204" || error.code === "42703") {
    return true;
  }

  return /column .* gps_radius_m/i.test(error.message ?? "");
}

export async function insertProjectTolerant(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const first = await supabase.from("projects").insert(payload).select("id").single<{ id: string }>();
  if (first.error && isMissingGpsRadiusColumnError(first.error)) {
    const { gps_radius_m: _omit, ...rest } = payload;
    void _omit;
    return supabase.from("projects").insert(rest).select("id").single<{ id: string }>();
  }

  return first;
}

export async function updateProjectTolerant(
  supabase: SupabaseClient,
  projectId: string,
  payload: Record<string, unknown>,
) {
  const first = await supabase.from("projects").update(payload).eq("id", projectId);
  if (first.error && isMissingGpsRadiusColumnError(first.error)) {
    const { gps_radius_m: _omit, ...rest } = payload;
    void _omit;
    return supabase.from("projects").update(rest).eq("id", projectId);
  }

  return first;
}
