"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Film, Image as ImageIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeStoragePath, type TaskAttachmentRef } from "@/lib/task-attachments";

function iconFor(mediaType: string) {
  if (mediaType === "photo") return ImageIcon;
  if (mediaType === "video") return Film;
  if (mediaType === "pdf" || mediaType === "document") return FileText;
  return Paperclip;
}

function typeLabel(mediaType: string): string {
  if (mediaType === "photo") return "Image";
  if (mediaType === "video") return "Video";
  if (mediaType === "pdf") return "PDF";
  if (mediaType === "document") return "Doc";
  return "File";
}

export function TaskAttachmentList({
  items,
}: {
  items: TaskAttachmentRef[];
}) {
  const supabase = useMemo(() => createClient(), []);
  // Eagerly batch-sign image paths so the worker/manager sees real
  // thumbnails instead of an icon placeholder. Videos and PDFs would
  // need a separate poster-frame pipeline; for them we keep an icon
  // tile. One batch call per attachment list mount, regardless of how
  // many photos.
  const [thumbUrls, setThumbUrls] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;
    const photos = items.filter((item) => item.media_type === "photo");
    if (photos.length === 0) return;
    let cancelled = false;
    void (async () => {
      const paths = photos.map((item) => normalizeStoragePath(item.storage_path));
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrls(paths, 3600);
      if (cancelled || !data) return;
      const next = new Map<string, string>();
      for (let i = 0; i < photos.length; i++) {
        const url = data[i]?.signedUrl;
        if (url) next.set(photos[i].id, url);
      }
      setThumbUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items, supabase]);

  if (items.length === 0) return null;

  async function open(item: TaskAttachmentRef) {
    if (typeof window === "undefined") return;
    // Open the tab synchronously inside the click handler — iOS Safari
    // and Android Chrome refuse window.open() that fires after an
    // `await`, because the click context is gone. Keeping a reference
    // means we lose `noopener`, but the destination is a Supabase
    // Storage object (raw file, not an HTML page that can run scripts),
    // so window.opener access is not exploitable.
    const tab = window.open("about:blank", "_blank");
    if (!tab) {
      console.warn("[task-attach] popup blocked");
      return;
    }
    const normalized = normalizeStoragePath(item.storage_path);
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600);
    if (error || !data?.signedUrl) {
      console.error("[task-attach] failed to sign URL", error);
      tab.close();
      return;
    }
    tab.location.href = data.signedUrl;
  }

  return (
    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((item) => {
        const Icon = iconFor(item.media_type);
        const thumbUrl = thumbUrls.get(item.id);
        const label = item.filename ?? item.id.slice(0, 8);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => void open(item)}
            title={label}
            className="group relative aspect-square overflow-hidden rounded-[var(--radius-md)] border text-left"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-primary)",
            }}
          >
            {item.media_type === "photo" && thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbUrl}
                alt={label}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                <Icon size={28} className="text-[var(--brand-yellow)]" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {typeLabel(item.media_type)}
                </span>
              </div>
            )}
            <div
              className="absolute inset-x-0 bottom-0 px-1.5 py-1"
              style={{
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 100%)",
              }}
            >
              <div className="truncate text-[10px] font-medium text-white">
                {label}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
