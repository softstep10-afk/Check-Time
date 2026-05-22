"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { markMessagesReadById } from "@/lib/message-state";
import {
  PRIORITY_COLOR,
  type AppMessage,
  type MessageAttachment,
  type MessagePriority,
} from "@/lib/message-types";
import { MessageAttachmentView } from "@/components/shared/MessageAttachmentView";
import { useWorkerShell } from "@/components/worker/WorkerShell";

const PRIORITY_LABEL_KEYS: Record<MessagePriority, TranslationKey> = {
  urgent: "messages.priorityUrgent",
  info: "messages.priorityInfo",
  good: "messages.priorityGood",
  task: "messages.priorityTask",
};

function inferPriority(row: {
  priority?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}): MessagePriority {
  if (
    row.priority === "urgent" ||
    row.priority === "info" ||
    row.priority === "good" ||
    row.priority === "task"
  ) {
    return row.priority;
  }
  const fromMeta = row.metadata?.priority;
  if (
    fromMeta === "urgent" ||
    fromMeta === "info" ||
    fromMeta === "good" ||
    fromMeta === "task"
  ) {
    return fromMeta;
  }
  if (row.color === "#ef4444") return "urgent";
  if (row.color === "#22c55e") return "good";
  if (row.color === "#3b82f6") return "task";
  return "info";
}

function relativeTime(iso: string, lang: "en" | "ru"): string {
  const diff = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 60) return lang === "ru" ? "только что" : "just now";
  const min = Math.round(diff / 60);
  if (min < 60) return lang === "ru" ? `${min} мин назад` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return lang === "ru" ? `${hr} ч назад` : `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return lang === "ru" ? `${day} дн назад` : `${day} d ago`;
}

export function WorkerMessagesPage() {
  const { shell } = useWorkerShell();
  const { t, locale } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadMessages() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", shell.profile.id)
        .order("created_at", { ascending: false })
        .limit(100);

      const rows = (data ?? []) as Array<{
        id: string;
        sender_id: string;
        recipient_id: string;
        text: string;
        color: string | null;
        priority?: string | null;
        read: boolean;
        attachment: Record<string, unknown> | null;
        metadata?: Record<string, unknown> | null;
        created_at: string;
      }>;
      const senderIds = Array.from(new Set(rows.map((row) => row.sender_id).filter(Boolean)));
      const nameById = new Map<string, string>();
      if (senderIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", senderIds);
        for (const profile of (profiles ?? []) as Array<{ id: string; name: string }>) {
          nameById.set(profile.id, profile.name);
        }
      }

      if (!active) return;
      const unreadIds = rows.filter((row) => !row.read).map((row) => row.id);
      setMessages(
        rows.map((row) => ({
          id: row.id,
          from_id: row.sender_id,
          from_name: nameById.get(row.sender_id) ?? "",
          to_id: row.recipient_id,
          text: row.text,
          color: (row.color ?? PRIORITY_COLOR[inferPriority(row)]) as AppMessage["color"],
          priority: inferPriority(row),
          read: row.read,
          created_at: row.created_at,
          metadata: row.metadata ?? null,
          attachment: row.attachment
            ? {
                url: String(row.attachment.url ?? ""),
                storagePath: String(row.attachment.storagePath ?? ""),
                filename: String(row.attachment.filename ?? ""),
                type: (String(row.attachment.type ?? "image") as MessageAttachment["type"]),
                mimeType: row.attachment.mimeType ? String(row.attachment.mimeType) : undefined,
                size: Number(row.attachment.size ?? 0),
              }
            : null,
        })),
      );
      setLoading(false);

      if (unreadIds.length > 0) {
        void supabase
          .from("messages")
          .update({ read: true })
          .eq("recipient_id", shell.profile.id)
          .in("id", unreadIds)
          .then(({ error }) => {
            if (error) {
              console.warn("Could not mark messages as read", error);
              return;
            }
            if (active) {
              setMessages((current) => markMessagesReadById(current, unreadIds));
            }
          });
      }
    }

    function scheduleMessagesLoad() {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void loadMessages();
      }, 250);
    }

    void loadMessages();
    const channel = supabase
      .channel(`worker-message-history-${shell.profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${shell.profile.id}`,
        },
        scheduleMessagesLoad,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${shell.profile.id}`,
        },
        scheduleMessagesLoad,
      )
      .subscribe();
    return () => {
      active = false;
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [shell.profile.id, supabase]);

  return (
    <section className="mx-auto max-w-[760px] space-y-4">
      <div className="surface-card p-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: "rgba(59, 130, 246, 0.12)", color: "var(--blue)" }}
          >
            <MessageSquare size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">
              {t("messages.workerHistoryTitle")}
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">
              {t("messages.workerHistoryHelp")}
            </p>
          </div>
        </div>
      </div>

      <div className="surface-card divide-y divide-[var(--border-subtle)] overflow-hidden">
        {loading ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            {t("common.loading")}
          </div>
        ) : messages.length === 0 ? (
          <div className="p-4 text-sm text-[var(--text-secondary)]">
            {t("messages.workerHistoryEmpty")}
          </div>
        ) : (
          messages.map((message) => {
            const accent = PRIORITY_COLOR[message.priority];
            return (
              <article
                key={message.id}
                className="border-l-2 p-4"
                style={{
                  borderLeftColor: accent,
                  background: message.read ? "transparent" : `${accent}0f`,
                }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {message.from_name || t("messages.senderManager")}
                      </span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase"
                        style={{
                          background: `${accent}1f`,
                          color: accent,
                        }}
                      >
                        {t(PRIORITY_LABEL_KEYS[message.priority])}
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {message.read ? t("messages.statusRead") : t("messages.statusUnread")}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                      {message.text}
                    </p>
                    {message.attachment ? (
                      <div className="mt-3">
                        <MessageAttachmentView attachment={message.attachment} />
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-xs text-[var(--text-muted)]">
                    {relativeTime(message.created_at, locale === "ru" ? "ru" : "en")}
                  </span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
