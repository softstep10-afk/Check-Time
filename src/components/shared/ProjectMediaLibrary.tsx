"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import {
  countProjectMediaCategories,
  filterProjectMediaByCategory,
  type ProjectMediaCategory,
} from "@/lib/project-media-library";
import type { TaskAttachmentRef } from "@/lib/task-attachments";

export function ProjectMediaLibrary({
  items,
  emptyText,
}: {
  items: TaskAttachmentRef[];
  emptyText: string;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<ProjectMediaCategory>("all");
  const counts = useMemo(() => countProjectMediaCategories(items), [items]);
  const filteredItems = useMemo(
    () => filterProjectMediaByCategory(items, category),
    [category, items],
  );

  if (items.length === 0) {
    return (
      <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
        {emptyText}
      </div>
    );
  }

  const tabs: Array<{ key: ProjectMediaCategory; label: string; count: number }> = [
    { key: "all", label: t("projectDetail.mediaFilterAll"), count: counts.all },
    { key: "photo", label: t("projectDetail.mediaFilterPhoto"), count: counts.photo },
    { key: "video", label: t("projectDetail.mediaFilterVideo"), count: counts.video },
    { key: "documents", label: t("projectDetail.mediaFilterDocuments"), count: counts.documents },
  ];

  return (
    <div className="mt-3 space-y-3" data-testid="project-media-library">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t("projectDetail.recentMedia")}>
        {tabs.map((tab) => {
          const selected = category === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setCategory(tab.key)}
              className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold transition-colors"
              style={{
                borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
              }}
            >
              {tab.label}
              <span className="ml-1 opacity-60">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {filteredItems.length === 0 ? (
        <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
          {t("projectDetail.noMediaForFilter")}
        </div>
      ) : (
        <TaskAttachmentList items={filteredItems} />
      )}
    </div>
  );
}
