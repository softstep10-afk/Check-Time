import type { Profile } from "@/types/database";

export const SAFE_PROFILE_COLUMNS = [
  "id",
  "org_id",
  "name",
  "role",
  "color",
  "is_active",
  "require_video",
  "language",
  "settings",
  "last_clock_in",
  "current_project",
  "created_at",
  "updated_at",
  "deleted_at",
  "notif_mode",
  "project_access_mode",
] as const;

export const PROFILE_WITH_RATE_COLUMNS = [
  "id",
  "org_id",
  "name",
  "role",
  "color",
  "is_active",
  "require_video",
  "hourly_rate",
  "language",
  "settings",
  "last_clock_in",
  "current_project",
  "created_at",
  "updated_at",
  "deleted_at",
  "notif_mode",
  "project_access_mode",
] as const;

export const SAFE_PROFILE_SELECT = SAFE_PROFILE_COLUMNS.join(", ");

export const PROFILE_WITH_RATE_SELECT = PROFILE_WITH_RATE_COLUMNS.join(", ");

export type SafeProfile = Omit<Profile, "hourly_rate" | "pin_hash">;
