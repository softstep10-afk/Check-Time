"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileText, Image, Play, Receipt } from "lucide-react";
import { selectMediaPlayback, signWithTimeout } from "@/lib/media-playback";
import { normalizeStoragePath } from "@/lib/task-attachments";
import { createClient } from "@/lib/supabase/client";
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
  const supabase = useMemo(() => createClient(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function openMedia(item: ArchiveProjectMediaItem) {
    setBusyId(item.id);
    setError("");
    const playback = selectMediaPlayback(item);
    const { data, error: signError } = await signWithTimeout(
      supabase.storage
        .from("media")
        .createSignedUrl(normalizeStoragePath(playback.path), 3600),
    );
    setBusyId(null);

    if (signError || !data?.signedUrl) {
      setError("Could not open this file. Try again from the project detail page.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
        No media preserved for this project.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-[var(--radius-md)] border p-3 text-sm"
          style={{ borderColor: "rgba(212, 81, 94, 0.32)", color: "var(--red)" }}
        >
          {error}
        </div>
      ) : null}
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
                      {new Date(item.created_at).toLocaleString()}
                      {item.uploadedByName ? ` · ${item.uploadedByName}` : ""}
                    </div>
                    {item.caption ? (
                      <div className="mt-2 text-xs text-[var(--text-secondary)]">{item.caption}</div>
                    ) : null}
                    {item.isReceipt ? (
                      <div className="mt-2 text-xs font-semibold text-[var(--text-secondary)]">
                        Receipt
                        {hasFinanceAccess && item.receiptAmount !== null
                          ? ` · ${currency.format(item.receiptAmount)}`
                          : ""}
                      </div>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void openMedia(item)}
                  disabled={busyId === item.id}
                  className="button-base button-secondary shrink-0 px-2.5 py-1.5 text-xs"
                >
                  <ExternalLink size={14} />
                  {busyId === item.id ? "Opening" : "Open"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
