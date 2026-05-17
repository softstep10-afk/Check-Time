"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckSquare, FileText, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  type AppMessage,
  type MessagePriority,
} from "@/lib/message-types";
import { playNotificationChime, unlockNotificationAudio } from "@/lib/client-notification-sound";
import type { Locale } from "@/lib/i18n";

type ManagerTaskNotification = {
  id: string;
  title: string;
  project_id: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

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

function inferPriority(row: {
  priority?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
}): MessagePriority {
  if (row.priority === "urgent" || row.priority === "info" || row.priority === "good" || row.priority === "task") {
    return row.priority;
  }
  const fromMeta = row.metadata?.priority;
  if (fromMeta === "urgent" || fromMeta === "info" || fromMeta === "good" || fromMeta === "task") {
    return fromMeta;
  }
  if (row.color === "#ef4444") return "urgent";
  if (row.color === "#22c55e") return "good";
  if (row.color === "#3b82f6") return "task";
  return "info";
}

function taskKindLabel(task: ManagerTaskNotification, locale: "en" | "ru") {
  const kind = task.metadata?.schedule_kind;
  if (kind === "delivery") return locale === "ru" ? "Доставка" : "Delivery";
  if (kind === "inspection") return locale === "ru" ? "Инспекция" : "Inspection";
  if (kind === "client_meeting") return locale === "ru" ? "Встреча с клиентом" : "Client meeting";
  if (kind === "worker_meeting") return locale === "ru" ? "Встреча команды" : "Crew meeting";
  return locale === "ru" ? "Задача" : "Task";
}

export function ManagerNotificationBell({
  profileId,
  orgId,
  muted,
  locale,
  labels,
}: {
  profileId: string | null;
  orgId: string | null;
  muted: boolean;
  locale: Locale;
  labels: {
    notifications: string;
    noNew: string;
    gotIt: string;
  };
}) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [tasks, setTasks] = useState<ManagerTaskNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastSignalAtRef = useRef(0);

  const ring = useCallback(
    (force = false) => {
      if (muted) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - lastSignalAtRef.current < 45_000) return;
      lastSignalAtRef.current = now;
      playNotificationChime();
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([120, 60, 120]);
      }
    },
    [muted],
  );

  const load = useCallback(
    async (reason: "initial" | "visibility" | "realtime" | "poll" = "poll") => {
      if (!profileId || !orgId) return;
      const [messagesResult, tasksResult] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("recipient_id", profileId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("tasks")
          .select("id, title, project_id, status, due_date, created_at, updated_at, metadata")
          .eq("org_id", orgId)
          .eq("assigned_to", profileId)
          .is("deleted_at", null)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

      const mappedMessages = ((messagesResult.data ?? []) as Array<{
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
      }>).map((row) => ({
        id: row.id,
        from_id: row.sender_id,
        from_name: "",
        to_id: row.recipient_id,
        text: row.text,
        color: row.color as AppMessage["color"],
        priority: inferPriority(row),
        read: row.read,
        created_at: row.created_at,
        attachment: row.attachment
          ? {
              url: (row.attachment as Record<string, string>).url ?? "",
              storagePath: (row.attachment as Record<string, string>).storagePath ?? "",
              filename: (row.attachment as Record<string, string>).filename ?? "",
              type: ((row.attachment as Record<string, string>).type ?? "image") as "image" | "video" | "pdf",
              size: Number((row.attachment as Record<string, number>).size ?? 0),
            }
          : undefined,
      }));
      const mappedTasks = (tasksResult.data ?? []) as ManagerTaskNotification[];
      setMessages(mappedMessages);
      setTasks(mappedTasks);
      setLoaded(true);

      const unreadCount = mappedMessages.filter((message) => !message.read).length;
      const total = unreadCount + mappedTasks.length;
      if (total > 0 && (reason === "initial" || reason === "visibility" || reason === "realtime")) {
        ring(reason === "realtime");
      }
    },
    [orgId, profileId, ring, supabase],
  );

  useEffect(() => {
    function unlock() {
      unlockNotificationAudio();
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => document.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!profileId || !orgId) return;
    const initialTimer = window.setTimeout(() => void load("initial"), 0);

    const channel = supabase
      .channel(`manager-notifications-${profileId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${profileId}` },
        () => void load("realtime"),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${profileId}` },
        () => void load("poll"),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "tasks", filter: `assigned_to=eq.${profileId}` },
        () => void load("realtime"),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tasks", filter: `assigned_to=eq.${profileId}` },
        () => void load("realtime"),
      )
      .subscribe();

    const interval = window.setInterval(() => void load("poll"), 30_000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void load("visibility");
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [load, orgId, profileId, supabase]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (!open) return;
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const unreadMessages = messages.filter((message) => !message.read);
  const totalBadge = unreadMessages.length + tasks.length;
  const sortedMessages = useMemo(() => {
    return [...messages].sort((a, b) => {
      const priorityGap = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityGap !== 0) return priorityGap;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [messages]);

  const markRead = useCallback(
    async (id: string) => {
      setMessages((prev) => prev.map((message) => (message.id === id ? { ...message, read: true } : message)));
      await supabase.from("messages").update({ read: true }).eq("id", id);
    },
    [supabase],
  );

  if (!profileId || !loaded) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border"
        style={{
          borderColor: totalBadge > 0 ? "rgba(212, 81, 94, 0.45)" : "var(--border-default)",
          background: totalBadge > 0 ? "rgba(212, 81, 94, 0.1)" : "transparent",
          color: totalBadge > 0 ? "var(--red)" : "var(--text-secondary)",
        }}
        aria-label={labels.notifications}
        title={labels.notifications}
      >
        <Bell size={16} />
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
          className="absolute right-0 top-11 z-50 w-[320px] overflow-hidden rounded-[var(--radius-lg)] border shadow-lg"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
          }}
        >
          <div
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)" }}
          >
            <span>{labels.notifications}</span>
            <span className="text-[10px] normal-case tracking-normal">{totalBadge}</span>
          </div>
          {tasks.length > 0 ? (
            <Link
              href="/tasks"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-b px-3 py-2.5 text-sm font-semibold"
              style={{
                borderColor: "var(--border-subtle)",
                background: "rgba(191, 162, 52, 0.08)",
                color: "var(--brand-yellow)",
              }}
            >
              <CheckSquare size={15} />
              {locale === "ru" ? `Назначено задач: ${tasks.length}` : `${tasks.length} assigned task(s)`}
            </Link>
          ) : null}
          <div className="max-h-[430px] overflow-y-auto">
            {totalBadge === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
                {labels.noNew}
              </div>
            ) : null}
            {tasks.map((task) => (
              <Link
                key={task.id}
                href={task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks"}
                onClick={() => setOpen(false)}
                className="block border-b border-l-2 px-3 py-2.5"
                style={{
                  borderBottomColor: "var(--border-subtle)",
                  borderLeftColor: "var(--brand-yellow)",
                  background: "rgba(191, 162, 52, 0.06)",
                }}
              >
                <div className="flex items-start gap-2">
                  <CheckSquare size={14} className="mt-0.5 shrink-0 text-[var(--brand-yellow)]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                      {taskKindLabel(task, locale === "ru" ? "ru" : "en")}
                      {task.due_date ? ` · ${task.due_date}` : ""}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
            {sortedMessages.map((message) => {
              const accent = PRIORITY_COLOR[message.priority];
              return (
                <div
                  key={message.id}
                  className="border-b border-l-2 px-3 py-2.5"
                  style={{
                    borderBottomColor: "var(--border-subtle)",
                    borderLeftColor: accent,
                    background: message.read ? "transparent" : `${accent}12`,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquare size={14} className="mt-0.5 shrink-0" style={{ color: accent }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--text-primary)]">{message.text}</div>
                      {message.attachment ? (
                        <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-2 text-xs text-[var(--text-secondary)]">
                          <FileText size={14} className="shrink-0" />
                          <span className="truncate">{message.attachment.filename}</span>
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] text-[var(--text-muted)]">
                          {relativeTime(message.created_at, locale === "ru" ? "ru" : "en")}
                        </span>
                        {!message.read ? (
                          <button
                            type="button"
                            onClick={() => void markRead(message.id)}
                            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${accent}1f`, color: accent }}
                          >
                            {labels.gotIt}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
