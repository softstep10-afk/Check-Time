"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { formatEventTime } from "@/lib/worker-utils";
import { MessageAttachmentView } from "@/components/shared/MessageAttachmentView";
import {
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  type AppMessage,
  type MessagePriority,
} from "@/lib/message-types";

const PREVIEW_MESSAGES: AppMessage[] = [
  {
    id: "msg-001",
    from_id: "00000000-0000-0000-0000-000000000010",
    from_name: "Preview Manager",
    to_id: "00000000-0000-0000-0000-000000000011",
    text: "Wear hard hats on level 3 today — crane overhead",
    color: "#ef4444",
    priority: "urgent",
    read: false,
    created_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    attachment: {
      url: "/icon-192.png",
      filename: "safety-notice.png",
      type: "image",
      size: 48_000,
    },
  },
  {
    id: "msg-002",
    from_id: "00000000-0000-0000-0000-000000000010",
    from_name: "Preview Manager",
    to_id: "00000000-0000-0000-0000-000000000011",
    text: "Glass delivery confirmed for 2 PM, keep staging area clear",
    color: "#3b82f6",
    priority: "task",
    read: false,
    created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
];

function inferPriority(row: { priority?: string | null; color?: string | null; metadata?: Record<string, unknown> | null }): MessagePriority {
  const fromColumn = row.priority;
  if (fromColumn === "urgent" || fromColumn === "info" || fromColumn === "good" || fromColumn === "task") {
    return fromColumn;
  }
  const fromMeta = (row.metadata as Record<string, unknown> | null)?.priority;
  if (fromMeta === "urgent" || fromMeta === "info" || fromMeta === "good" || fromMeta === "task") {
    return fromMeta;
  }
  // Legacy color-based fallback for rows written before Wave 7.
  if (row.color === "#ef4444") return "urgent";
  if (row.color === "#22c55e") return "good";
  if (row.color === "#3b82f6") return "task";
  return "info";
}

export function NotificationBell({ profileId }: { profileId?: string }) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  // Lazy-init from localStorage so the load is one-shot at mount and
  // doesn't trigger the react-hooks/set-state-in-effect lint.
  const [deferredIds, setDeferredIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined" || !profileId) return new Set<string>();
    try {
      const raw = window.localStorage.getItem(`check-time-defer-${profileId}`);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });
  const dropdownRef = useRef<HTMLDivElement>(null);

  function deferMessage(id: string) {
    setDeferredIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (typeof window !== "undefined" && profileId) {
        try {
          window.localStorage.setItem(
            `check-time-defer-${profileId}`,
            JSON.stringify([...next]),
          );
        } catch {
          // Ignore quota errors.
        }
      }
      return next;
    });
  }

  // Load messages
  useEffect(() => {
    if (AUTH_BYPASS_ENABLED || !profileId) {
      setMessages(PREVIEW_MESSAGES);
      setLoaded(true);
      return;
    }

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("recipient_id", profileId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (data) {
        const rows = data as Array<{
          id: string;
          sender_id: string;
          recipient_id: string;
          text: string;
          color: string;
          priority?: string | null;
          read: boolean;
          attachment: Record<string, unknown> | null;
          metadata?: Record<string, unknown> | null;
          created_at: string;
        }>;
        setMessages(
          rows.map((r) => ({
            id: r.id,
            from_id: r.sender_id,
            from_name: "", // We don't join profiles here for simplicity
            to_id: r.recipient_id,
            text: r.text,
            color: r.color as AppMessage["color"],
            priority: inferPriority(r),
            read: r.read,
            created_at: r.created_at,
            attachment: r.attachment
              ? {
                  url: (r.attachment as Record<string, string>).url ?? "",
                  filename: (r.attachment as Record<string, string>).filename ?? "",
                  type: ((r.attachment as Record<string, string>).type ?? "image") as "image" | "video" | "pdf",
                  size: Number((r.attachment as Record<string, number>).size ?? 0),
                }
              : undefined,
          })),
        );
      }
      setLoaded(true);
    }
    void load();

    // Poll every 30 seconds for new messages
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [supabase, profileId]);

  const unreadCount = messages.filter((m) => !m.read).length;

  // Urgent first, then info/good/task; within each band newest first.
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const orderDelta = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (orderDelta !== 0) return orderDelta;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [messages]);

  const markRead = useCallback(
    async (id: string) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, read: true } : m)),
      );
      if (!AUTH_BYPASS_ENABLED) {
        await supabase.from("messages").update({ read: true }).eq("id", id);
      }
    },
    [supabase],
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  if (!loaded) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
        style={{
          borderColor: "var(--border-default)",
          background: "transparent",
          color: "var(--text-secondary)",
        }}
        aria-label={t("messages.notifications")}
      >
        <Bell size={15} />
        {unreadCount > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: "var(--red)" }}
          >
            {unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="absolute right-0 top-10 z-50 w-[300px] overflow-hidden rounded-[var(--radius-lg)] border shadow-lg"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
          }}
        >
          <div
            className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)" }}
          >
            {t("messages.notifications")}
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {sortedMessages.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
                {t("messages.noNew")}
              </div>
            ) : (
              sortedMessages.map((msg) => {
                const accent = PRIORITY_COLOR[msg.priority];
                const deferred = deferredIds.has(msg.id);
                // Card tint: full strength for unread urgent, lighter for
                // other unread, faintly muted for deferred-but-still-unread,
                // transparent once truly read.
                const tint = msg.read
                  ? "transparent"
                  : deferred
                    ? `${accent}08`
                    : msg.priority === "urgent"
                      ? `${accent}1f`
                      : `${accent}10`;
                return (
                  <div
                    key={msg.id}
                    className="border-b border-l-2 px-3 py-2.5"
                    style={{
                      borderColor: "var(--border-subtle)",
                      borderLeftColor: accent,
                      background: tint,
                      opacity: deferred && !msg.read ? 0.7 : 1,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: accent,
                          opacity: deferred && !msg.read ? 0.5 : 1,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--text-primary)]">{msg.text}</div>
                        {msg.attachment ? (
                          <MessageAttachmentView attachment={msg.attachment} />
                        ) : null}
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {msg.from_name ? `${msg.from_name} • ` : ""}{formatEventTime(msg.created_at)}
                          </span>
                          {!msg.read ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              {!deferred ? (
                                <button
                                  type="button"
                                  onClick={() => deferMessage(msg.id)}
                                  title={t("messages.readLaterTip")}
                                  className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    borderColor: "var(--border-default)",
                                    color: "var(--text-secondary)",
                                  }}
                                >
                                  📖 {t("messages.readLater")}
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => void markRead(msg.id)}
                                className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold"
                                style={{ background: `${accent}1f`, color: accent }}
                              >
                                {t("messages.gotIt")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
