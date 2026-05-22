"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playNotificationChime, unlockNotificationAudio } from "@/lib/client-notification-sound";
import { useTranslation } from "@/lib/i18n";
import { keepStableListIfUnchanged } from "@/lib/list-stability";
import { markMessagesReadById } from "@/lib/message-state";
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
import { MessageAttachmentView } from "@/components/shared/MessageAttachmentView";
import {
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  type AppMessage,
  type MessageAttachment,
  type MessagePriority,
} from "@/lib/message-types";

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

function messageFingerprint(message: AppMessage): string {
  const attachment = message.attachment;
  return [
    message.id,
    message.read ? "1" : "0",
    message.priority,
    message.color,
    message.created_at,
    message.text,
    attachment?.storagePath ?? "",
    attachment?.filename ?? "",
    attachment?.mimeType ?? "",
    String(attachment?.size ?? ""),
  ].join("\u001f");
}

export function NotificationBell({
  profileId,
  onUrgentArrival,
  onUnreadReminder,
  unseenTaskCount = 0,
}: {
  profileId?: string;
  onUrgentArrival?: (msg: AppMessage) => void;
  onUnreadReminder?: (summary: {
    unreadMessageCount: number;
    unseenTaskCount: number;
    latestUnreadMessage: AppMessage | null;
  }) => void;
  /**
   * Number of tasks the worker hasn't yet seen. Sourced from the
   * worker shell's localStorage-backed lastSeenAt marker. Folded into
   * the bell badge alongside unread messages so a single number
   * communicates "something new for you".
   */
  unseenTaskCount?: number;
}) {
  const { t, locale } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  // Track which message ids we've already surfaced so the urgent-overlay
  // callback fires once per newly-arrived urgent unread, not on every poll.
  const seenIdsRef = useRef<Set<string>>(new Set());
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
  const lastSignalAtRef = useRef(0);

  const signal = useCallback((force = false) => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const now = Date.now();
    if (!force && now - lastSignalAtRef.current < 45_000) return;
    lastSignalAtRef.current = now;
    playNotificationChime();
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([120, 60, 120]);
    }
  }, []);

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
    if (!profileId) return;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;

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
        const mapped: AppMessage[] = rows.map((r) => ({
          id: r.id,
          from_id: r.sender_id,
          from_name: "", // We don't join profiles here for simplicity
          to_id: r.recipient_id,
          text: r.text,
          color: r.color as AppMessage["color"],
          priority: inferPriority(r),
          read: r.read,
          created_at: r.created_at,
          metadata: r.metadata ?? null,
          attachment: r.attachment
            ? {
                url: (r.attachment as Record<string, string>).url ?? "",
                storagePath: (r.attachment as Record<string, string>).storagePath ?? "",
                filename: (r.attachment as Record<string, string>).filename ?? "",
                type: ((r.attachment as Record<string, string>).type ?? "image") as MessageAttachment["type"],
                mimeType: (r.attachment as Record<string, string>).mimeType ?? undefined,
                size: Number((r.attachment as Record<string, number>).size ?? 0),
              }
            : undefined,
        }));
        setMessages((current) =>
          keepStableListIfUnchanged(current, mapped, messageFingerprint),
        );
        // Fire the urgent-arrival callback once per newly-seen unread urgent
        // message. Tracking via ref so it survives re-renders + multiple polls.
        for (const msg of mapped) {
          if (
            msg.priority === "urgent" &&
            !msg.read &&
            !seenIdsRef.current.has(msg.id)
          ) {
            signal(true);
            onUrgentArrival?.(msg);
          }
          seenIdsRef.current.add(msg.id);
        }
      }
      setLoaded(true);
    }

    function scheduleLoad() {
      if (document.visibilityState !== "visible") return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void load();
      }, 250);
    }

    void load();

    function unlock() {
      unlockNotificationAudio();
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });

    // Realtime: every new message INSERT for this recipient triggers an
    // immediate refetch so the bell badge + urgent overlay react within
    // ~1s of the manager's send. The 30s poll stays as a fallback for
    // cases where the realtime channel drops.
    const channel = supabase
      .channel(`messages-recipient-${profileId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${profileId}`,
        },
        scheduleLoad,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${profileId}`,
        },
        scheduleLoad,
      )
      .subscribe();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void load();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      clearInterval(interval);
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [supabase, profileId, onUrgentArrival, signal]);

  const unreadMessages = useMemo(
    () => messages.filter((message) => !message.read),
    [messages],
  );
  const unreadCount = unreadMessages.length;
  // Bell badge folds messages + unseen tasks into a single number so the
  // worker can read "you have N things to look at" at a glance. The
  // dropdown still discriminates the two — there's a "Tasks" link at the
  // top when unseenTaskCount > 0, and the rest of the list is messages.
  const totalBadge = unreadCount + unseenTaskCount;

  // Urgent first, then info/good/task; within each band newest first.
  const sortedMessages = useMemo(() => {
    return [...unreadMessages].sort((a, b) => {
      const orderDelta = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (orderDelta !== 0) return orderDelta;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [unreadMessages]);

  useEffect(() => {
    if (!loaded) return;
    const unreadMessages = messages.filter((message) => !message.read);
    if (unreadMessages.length === 0 && unseenTaskCount === 0) return;
    if (unseenTaskCount > 0) {
      signal();
    }
    onUnreadReminder?.({
      unreadMessageCount: unreadMessages.length,
      unseenTaskCount,
      latestUnreadMessage: unreadMessages[0] ?? null,
    });
  }, [loaded, messages, onUnreadReminder, signal, unseenTaskCount]);

  const markRead = useCallback(
    async (id: string) => {
      setMessages((prev) => markMessagesReadById(prev, [id]));
      setDeferredIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
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
      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("recipient_id", profileId)
        .eq("id", id);
      if (error) {
        console.warn("markRead failed:", error.message);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === id ? { ...message, read: false } : message,
          ),
        );
      }
    },
    [profileId, supabase],
  );

  const markAllRead = useCallback(async () => {
    const unreadIds = messages.filter((m) => !m.read).map((m) => m.id);
    if (unreadIds.length === 0) return;
    setMessages((prev) => markMessagesReadById(prev, unreadIds));
    setDeferredIds((prev) => {
      const next = new Set(prev);
      for (const id of unreadIds) next.delete(id);
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
    const { error } = await supabase
      .from("messages")
      .update({ read: true })
      .eq("recipient_id", profileId)
      .in("id", unreadIds);
    if (error) {
      console.warn("markAllRead failed:", error.message);
      setMessages((prev) =>
        prev.map((message) =>
          unreadIds.includes(message.id) ? { ...message, read: false } : message,
        ),
      );
    }
  }, [messages, profileId, supabase]);

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

  if (!profileId || !loaded) return null;

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
        {totalBadge > 0 ? (
          <span
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: "var(--red)" }}
          >
            {totalBadge}
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
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)" }}
          >
            <span>{t("messages.notifications")}</span>
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[9px] font-semibold normal-case tracking-normal"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                {t("messages.markAllRead")}
              </button>
            ) : null}
          </div>
          <Link
            href="/my-messages"
            onClick={() => setOpen(false)}
            className="block border-b px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
          >
            {t("messages.openHistory")}
          </Link>
          {unseenTaskCount > 0 ? (
            <Link
              href="/my-tasks"
              onClick={() => setOpen(false)}
              className="block border-b px-3 py-2.5 text-sm font-semibold"
              style={{
                borderColor: "var(--border-subtle)",
                background: "rgba(191, 162, 52, 0.08)",
                color: "var(--brand-yellow)",
              }}
            >
              📋 {t("tasks.newTasksBellLink").replace("{count}", String(unseenTaskCount))}
            </Link>
          ) : null}
          <div className="max-h-[400px] overflow-y-auto">
            {sortedMessages.length === 0 && unseenTaskCount === 0 ? (
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
                            {msg.from_name ? `${msg.from_name} • ` : ""}{relativeTime(msg.created_at, locale === "ru" ? "ru" : "en")}
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
