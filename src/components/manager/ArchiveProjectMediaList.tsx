"use client";

import { useState } from "react";
import { Eye, FileText, Image, Play, Receipt } from "lucide-react";
import {
  MediaViewerModal,
  useMediaViewerOpenGuard,
} from "@/components/shared/MediaViewerModal";
import { useTranslation } from "@/lib/i18n";
import type { MediaType } from "@/types/database";

export type ArchiveProjectMediaItem = {
  id: string;
  media_type: MediaType;
  storage_path: string;
  filename: string | null;
  mime_type: string | null;
  caption: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  uploadedByName: string | null;
  isReceipt: boolean;
  receiptAmount: number | null;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const COPY = {
  en: {
    empty: "No media preserved for this project.",
    receipt: "Receipt",
    open: "View",
  },
  ru: {
    empty: "По этому проекту нет сохранённых файлов.",
    receipt: "Чек",
    open: "Смотреть",
  },
} as const;

function iconFor(item: ArchiveProjectMediaItem) {
  if (item.isReceipt) return Receipt;
  if (item.media_type === "photo") return Image;
  if (item.media_type === "video") return Play;
  return FileText;
}

export function ArchiveProjectMediaList({
  items,
  hasFinanceAccess,
}: {
  items: ArchiveProjectMediaItem[];
  hasFinanceAccess: boolean;
}) {
  const { locale } = useTranslation();
  const text = COPY[locale];
  const [viewerItem, setViewerItem] = useState<ArchiveProjectMediaItem | null>(null);
  const { canOpenViewerItem, suppressViewerItem } = useMediaViewerOpenGuard();

  function openMedia(item: ArchiveProjectMediaItem) {
    if (!canOpenViewerItem(item.id)) return;
    setViewerItem(item);
  }

  function closeViewer() {
    const itemId = viewerItem?.id;
    setViewerItem(null);
    suppressViewerItem(itemId);
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
        {text.empty}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((item) => {
          const Icon = iconFor(item);
          return (
            <div key={item.id} className="rounded-[var(--radius-md)] border p-3"
              style={{ borderColor: "var(--border-default)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--bg-primary)] text-[var(--text-muted)]">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                      {item.filename ?? item.media_type}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {new Date(item.created_at).toLocaleString(undefined, { hourCycle: "h23" })}
                      {item.uploadedByName ? ` · ${item.uploadedByName}` : ""}
                    </div>
                    {item.caption ? (
                      <div className="mt-2 text-xs text-[var(--text-secondary)]">{item.caption}</div>
                    ) : null}
                    {item.isReceipt ? (
                      <div className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
                        {text.receipt}
                        {hasFinanceAccess && item.receiptAmount !== null
                          ? ` · ${currency.format(item.receiptAmount)}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openMedia(item)}
                  className="button-base button-secondary shrink-0 px-2.5 py-1.5 text-xs"
                >
                  <Eye size={14} />
                  {text.open}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <MediaViewerModal
        item={
          viewerItem
            ? {
                id: viewerItem.id,
                storage_path: viewerItem.storage_path,
                filename: viewerItem.filename,
                mime_type: viewerItem.mime_type,
                media_type: viewerItem.media_type,
                caption: viewerItem.caption,
                created_at: viewerItem.created_at,
                metadata: viewerItem.metadata,
                uploaderName: viewerItem.uploadedByName,
              }
            : null
        }
        onClose={closeViewer}
      />
    </div>
  );
}
