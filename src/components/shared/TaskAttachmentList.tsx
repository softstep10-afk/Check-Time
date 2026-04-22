"use client";

import { useMemo } from "react";
import { FileText, Film, Image as ImageIcon, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { TaskAttachmentRef } from "@/lib/task-attachments";

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

  function open(item: TaskAttachmentRef) {
    const { data } = supabase.storage.from("media").getPublicUrl(item.storage_path);
    console.log("[task-attach] open attachment", {
      id: item.id,
      filename: item.filename,
      storage_path: item.storage_path,
      publicUrl: data?.publicUrl,
    });
    if (typeof window !== "undefined" && data?.publicUrl) {
      window.open(data.publicUrl, "_blank", "noopener,noreferrer");
    }
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
            onClick={() => open(item)}
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
