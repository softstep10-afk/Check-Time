"use client";

import { useMemo } from "react";
import { FileText, Film, Image as ImageIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeStoragePath, type TaskAttachmentRef } from "@/lib/task-attachments";

function iconFor(mediaType: string) {
  if (mediaType === "photo") return ImageIcon;
  if (mediaType === "video") return Film;
  if (mediaType === "pdf" || mediaType === "document") return FileText;
  return Paperclip;
}

export function TaskAttachmentList({
  items,
}: {
  items: TaskAttachmentRef[];
}) {
  const supabase = useMemo(() => createClient(), []);
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
    console.log("[task-attach] open attachment", {
      id: item.id,
      filename: item.filename,
      bucket: "media",
      storage_path_raw: item.storage_path,
      storage_path_normalized: normalized,
      pathHadLeadingSlash: item.storage_path.startsWith("/"),
      pathHadBucketPrefix: item.storage_path.startsWith("media/") || item.storage_path.startsWith("/media/"),
      signedUrl: data?.signedUrl,
      error: error ? { message: error.message, name: error.name } : null,
    });
    if (error || !data?.signedUrl) {
      console.error("[task-attach] failed to sign URL", error);
      tab.close();
      return;
    }
    tab.location.href = data.signedUrl;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {items.map((item) => {
        const Icon = iconFor(item.media_type);
        const label = item.filename ?? item.id.slice(0, 8);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => void open(item)}
            className="inline-flex max-w-[220px] items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-medium"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-primary)",
              color: "var(--text-secondary)",
            }}
            title={label}
          >
            <Icon size={12} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
