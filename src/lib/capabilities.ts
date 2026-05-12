import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The full set of per-user capability keys understood by the app.
 *
 * Stored in public.user_capabilities (Wave X1 migration 00010) as plain
 * text — adding a new key here does NOT require a schema change. The DB
 * just doesn't know about a key until something starts checking it via
 * has_capability(<key>).
 *
 * Labels and descriptions live alongside the keys so the permissions UI
 * stays in sync without a separate i18n table.
 */

export type CapabilityKey =
  | "upload_receipts"
  | "view_all_projects_map"
  | "view_supply_stores"
  | "flag_media"
  | "finance_access";

export interface CapabilityDescriptor {
  key: CapabilityKey;
  label_en: string;
  label_ru: string;
  description_en: string;
  description_ru: string;
}

export const CAPABILITIES: readonly CapabilityDescriptor[] = [
  {
    key: "upload_receipts",
    label_en: "Upload receipts",
    label_ru: "Загрузка чеков",
    description_en: "Allow this worker to upload supply-store receipts on the project they are clocked into.",
    description_ru: "Разрешить рабочему загружать чеки из магазинов на проекте, где он на смене.",
  },
  {
    key: "view_all_projects_map",
    label_en: "View map of all projects",
    label_ru: "Карта всех проектов",
    description_en: "Show every active project on the map, not just the ones the worker is assigned to.",
    description_ru: "Показывать все активные проекты на карте, а не только назначенные рабочему.",
  },
  {
    key: "view_supply_stores",
    label_en: "View supply stores",
    label_ru: "Список магазинов стройматериалов",
    description_en: "Grant access to the supply-store directory and per-store visit history.",
    description_ru: "Дать доступ к справочнику магазинов и истории посещений.",
  },
  {
    key: "flag_media",
    label_en: "Flag media for review",
    label_ru: "Отметка медиа на проверку",
    description_en: "Lets the worker flag a photo, video, or PDF in the field for a manager to review.",
    description_ru: "Разрешает рабочему отмечать фото, видео или PDF для проверки менеджером.",
  },
  {
    key: "finance_access",
    label_en: "View finances",
    label_ru: "Доступ к финансам",
    description_en: "Allow this user to see all receipts and project totals across the org. Without this, the user only sees their own receipts.",
    description_ru: "Разрешить пользователю видеть все чеки и итоги по проектам. Без этого — только свои чеки.",
  },
] as const;

/**
 * Lookup helper for a capability descriptor. Returns null for unknown
 * keys so callers don't crash on stale data after a key rename.
 */
export function findCapability(key: string): CapabilityDescriptor | null {
  return CAPABILITIES.find((capability) => capability.key === key) ?? null;
}

/**
 * Read the granted state of every shipped capability for a single user.
 *
 * Returns an object keyed by every CapabilityKey, defaulting to false.
 * Tolerates the user_capabilities table being absent (returns the
 * defaults) so the UI loads cleanly before migration 00010 is applied.
 */
export async function fetchUserCapabilities(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<CapabilityKey, boolean>> {
  const defaults = Object.fromEntries(
    CAPABILITIES.map((capability) => [capability.key, false]),
  ) as Record<CapabilityKey, boolean>;

  const { data, error } = await supabase
    .from("user_capabilities")
    .select("capability, granted")
    .eq("user_id", userId);

  if (error || !data) return defaults;

  const result: Record<CapabilityKey, boolean> = { ...defaults };
  for (const row of data as Array<{ capability: string; granted: boolean }>) {
    if (row.capability in result) {
      result[row.capability as CapabilityKey] = Boolean(row.granted);
    }
  }
  return result;
}

/**
 * Upsert a single capability grant. Tolerates the table being absent —
 * returns { ok: false, missingTable: true } so the UI can show a helpful
 * banner instead of a generic error.
 */
export async function setUserCapability(
  supabase: SupabaseClient,
  args: {
    userId: string;
    capability: CapabilityKey;
    granted: boolean;
    grantedBy: string | null;
    note?: string | null;
  },
): Promise<{ ok: true } | { ok: false; missingTable?: boolean; message?: string }> {
  const { error } = await supabase
    .from("user_capabilities")
    .upsert(
      {
        user_id: args.userId,
        capability: args.capability,
        granted: args.granted,
        granted_by: args.grantedBy,
        granted_at: new Date().toISOString(),
        note: args.note ?? null,
      },
      { onConflict: "user_id,capability" },
    );

  if (!error) return { ok: true };
  if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
    return { ok: false, missingTable: true };
  }
  return { ok: false, message: error.message };
}
