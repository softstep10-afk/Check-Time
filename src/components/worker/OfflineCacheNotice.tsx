"use client";

import { useTranslation } from "@/lib/i18n";
import { formatOfflineSnapshotTime } from "@/lib/offline-field-cache";

export function OfflineCacheNotice({ savedAt }: { savedAt: string }) {
  const { t, locale } = useTranslation();
  return (
    <div
      data-testid="offline-cache-notice"
      className="rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold"
      style={{
        background: "rgba(245, 158, 11, 0.12)",
        borderColor: "rgba(245, 158, 11, 0.28)",
        color: "#f59e0b",
      }}
    >
      <div>{t("worker.offlineCachedData")}</div>
      <div className="mt-0.5 opacity-85">
        {t("worker.offlineCacheUpdated").replace(
          "{time}",
          formatOfflineSnapshotTime(savedAt, locale),
        )}
      </div>
    </div>
  );
}

export function OfflineCacheEmptyState() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="offline-cache-empty"
      className="rounded-[var(--radius-md)] border px-3 py-3 text-sm"
      style={{
        background: "rgba(245, 158, 11, 0.08)",
        borderColor: "rgba(245, 158, 11, 0.22)",
        color: "var(--text-secondary)",
      }}
    >
      {t("worker.offlineCacheEmpty")}
    </div>
  );
}
