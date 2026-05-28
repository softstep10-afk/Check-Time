import type { TranslationKey } from "@/lib/i18n";

export type OfflineVisibilityInput = {
  isOnline: boolean;
  draining: boolean;
  offlineActionCount: number;
  offlineUploadCount: number;
  offlineShiftCount: number;
};

export type OfflineVisibilityState = {
  mode: "offline" | "pending" | "syncing";
  count: number;
  labelKey: TranslationKey;
  tone: "warning" | "syncing";
};

export function buildOfflineVisibilityState(
  input: OfflineVisibilityInput,
): OfflineVisibilityState | null {
  const count =
    input.offlineActionCount + input.offlineUploadCount + input.offlineShiftCount;

  if (input.draining && count > 0) {
    return {
      mode: "syncing",
      count,
      labelKey: "worker.offlineSyncingSummary",
      tone: "syncing",
    };
  }

  if (!input.isOnline && count > 0) {
    return {
      mode: "pending",
      count,
      labelKey: "worker.offlinePendingSummary",
      tone: "warning",
    };
  }

  if (!input.isOnline) {
    return {
      mode: "offline",
      count: 0,
      labelKey: "worker.offlineMode",
      tone: "warning",
    };
  }

  if (count > 0) {
    return {
      mode: "pending",
      count,
      labelKey: "worker.offlinePendingSummary",
      tone: "warning",
    };
  }

  return null;
}
