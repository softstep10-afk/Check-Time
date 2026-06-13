import type { Profile } from "@/types/database";

export const SAFE_PROFILE_SELECT = [
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
].join(", ");

export const PROFILE_WITH_RATE_SELECT = `${SAFE_PROFILE_SELECT}, hourly_rate`;

export type SafeProfile = Omit<Profile, "hourly_rate" | "pin_hash">;
export type ProfileWithRate = SafeProfile & Pick<Profile, "hourly_rate">;
