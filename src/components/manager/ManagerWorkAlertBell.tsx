"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellOff, CheckSquare, MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { playNotificationChime, unlockNotificationAudio } from "@/lib/client-notification-sound";
import { keepStableListIfUnchanged } from "@/lib/list-stability";
import { markMessagesReadById } from "@/lib/message-state";
import {
  PRIORITY_COLOR,
  PRIORITY_ORDER,
  type AppMessage,
  type MessagePriority,
} from "@/lib/message-types";

type ManagerProfile = {
  id: string;
  org_id: string;
  role: string;
};

type AlertTask = {
  id: string;
  title: string;
  project_id: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
};

type AlertLoadReason = "initial" | "visibility" | "realtime" | "poll";

type AlertsSnapshot = {
  messages: AppMessage[];
  tasks: AlertTask[];
  loaded: true;
};

type AlertPollOwner = {
  id: string;
  updatedAt: number;
};

type AlertBroadcastMessage =
  | {
      type: "snapshot";
      profileId: string;
      ownerId: string;
      reason: AlertLoadReason;
      targetId?: string;
      snapshot: AlertsSnapshot;
    }
  | {
      type: "refresh-request";
      profileId: string;
      requesterId: string;
      reason: Extract<AlertLoadReason, "initial" | "visibility">;
    }
  | {
      type: "owner-heartbeat";
      profileId: string;
      ownerId: string;
      updatedAt: number;
    }
  | {
      type: "owner-released";
      profileId: string;
      ownerId: string;
    };

const MANAGER_WORK_ALERT_POLL_MS = 30_000;
const MANAGER_WORK_ALERT_OWNER_HEARTBEAT_MS = 10_000;
const MANAGER_WORK_ALERT_OWNER_STALE_MS = 45_000;

function makePollerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ownerStorageKey(profileId: string): string {
  return `check-time-manager-work-alert-owner:${profileId}`;
}

function canUsePollOwnership(): boolean {
  try {
    const key = "check-time-manager-work-alert-owner:test";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function readPollOwner(key: string): AlertPollOwner | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AlertPollOwner>;
    if (typeof parsed.id !== "string" || typeof parsed.updatedAt !== "number") return null;
    return { id: parsed.id, updatedAt: parsed.updatedAt };
  } catch {
    return null;
  }
}

function claimPollOwnership(key: string, owner: AlertPollOwner): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(owner));
    return readPollOwner(key)?.id === owner.id;
  } catch {
    return false;
  }
}

function releasePollOwnership(key: string, ownerId: string) {
  try {
    if (readPollOwner(key)?.id === ownerId) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage can be blocked; ownership simply falls back to per-tab polling.
  }
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

function isManagerRole(role: string) {
  return role === "owner" || role === "admin" || role === "manager";
}

function taskKindLabel(task: AlertTask) {
  const kind = task.metadata?.schedule_kind;
  if (kind === "delivery") return "Доставка";
  if (kind === "inspection") return "Инспекция";
  if (kind === "client_meeting") return "Встреча";
  if (kind === "worker_meeting") return "Команда";
  return "Задача";
}

function mapMessages(rows: unknown[]): AppMessage[] {
  return (rows as Array<{
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
    attachment: undefined,
  }));
}

function messageFingerprint(message: AppMessage): string {
  return [
    message.id,
    message.read ? "1" : "0",
    message.priority,
    message.color,
    message.created_at,
    message.text,
  ].join("\u001f");
}

function taskFingerprint(task: AlertTask): string {
  return [
    task.id,
    task.status,
    task.updated_at,
    task.due_date ?? "",
    task.title,
    task.project_id ?? "",
    String(task.metadata?.schedule_kind ?? ""),
  ].join("\u001f");
}

export function ManagerWorkAlertBell() {
  const supabase = useMemo(() => createClient(), []);
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [tasks, setTasks] = useState<AlertTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("check-time-manager-alert-muted") === "true";
  });
  const pollerIdRef = useRef<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const lastSignalAtRef = useRef(0);

  if (pollerIdRef.current === null) {
    pollerIdRef.current = makePollerId();
  }

  const signal = useCallback(
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

  const applyAlertsSnapshot = useCallback(
    (snapshot: AlertsSnapshot, reason: AlertLoadReason) => {
      setMessages((current) =>
        keepStableListIfUnchanged(current, snapshot.messages, messageFingerprint),
      );
      setTasks((current) =>
        keepStableListIfUnchanged(current, snapshot.tasks, taskFingerprint),
      );
      setLoaded(snapshot.loaded);

      const total = snapshot.messages.filter((message) => !message.read).length + snapshot.tasks.length;
      if (total > 0 && (reason === "initial" || reason === "visibility" || reason === "realtime")) {
        signal(reason === "realtime");
      }
    },
    [signal],
  );

  const loadAlerts = useCallback(
    async (reason: AlertLoadReason = "poll"): Promise<AlertsSnapshot | null> => {
      if (!profile) return null;
      const [messagesResult, tasksResult] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("recipient_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(25),
        supabase
          .from("tasks")
          .select("id, title, project_id, status, due_date, created_at, updated_at, metadata")
          .eq("org_id", profile.org_id)
          .eq("assigned_to", profile.id)
          .is("deleted_at", null)
          .in("status", ["pending", "in_progress"])
          .order("created_at", { ascending: false })
          .limit(25),
      ]);

      const nextMessages = mapMessages(messagesResult.data ?? []);
      const nextTasks = (tasksResult.data ?? []) as AlertTask[];
      const snapshot: AlertsSnapshot = { messages: nextMessages, tasks: nextTasks, loaded: true };
      applyAlertsSnapshot(snapshot, reason);
      return snapshot;
    },
    [applyAlertsSnapshot, profile, supabase],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      const { data: userResult } = await supabase.auth.getUser();
      const user = userResult.user;
      if (!user) {
        setLoaded(true);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("id, org_id, role")
        .eq("id", user.id)
        .maybeSingle<ManagerProfile>();
      if (cancelled) return;
      if (data && isManagerRole(data.role)) {
        setProfile(data);
      } else {
        setLoaded(true);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    function unlock() {
      unlockNotificationAudio();
    }
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    const activeProfile = profile;
    if (!activeProfile) return;
    const activeProfileId = activeProfile.id;
    if (typeof window === "undefined") return;
    const pollerId = pollerIdRef.current ?? makePollerId();
    pollerIdRef.current = pollerId;
    const ownershipKey = ownerStorageKey(activeProfileId);
    const canSharePoll = typeof BroadcastChannel !== "undefined" && canUsePollOwnership();
    const broadcast = canSharePoll
      ? new BroadcastChannel(`check-time-manager-work-alerts:${activeProfileId}`)
      : null;
    let stopped = false;
    let ownsPoll = false;
    let reloadTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let pollInterval: number | null = null;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    let pendingReason: AlertLoadReason = "poll";

    function emit(message: AlertBroadcastMessage) {
      broadcast?.postMessage(message);
    }

    function isVisible() {
      return document.visibilityState === "visible";
    }

    function activeOtherOwner(): AlertPollOwner | null {
      if (!canSharePoll) return null;
      const owner = readPollOwner(ownershipKey);
      if (!owner || owner.id === pollerId) return null;
      if (Date.now() - owner.updatedAt > MANAGER_WORK_ALERT_OWNER_STALE_MS) return null;
      return owner;
    }

    function refreshOwnership() {
      if (!canSharePoll) return true;
      const owner = { id: pollerId, updatedAt: Date.now() };
      if (!claimPollOwnership(ownershipKey, owner)) return false;
      emit({
        type: "owner-heartbeat",
        profileId: activeProfileId,
        ownerId: pollerId,
        updatedAt: owner.updatedAt,
      });
      return true;
    }

    function clearReloadTimer() {
      if (reloadTimer) {
        window.clearTimeout(reloadTimer);
        reloadTimer = null;
      }
    }

    async function runLoad(reason: AlertLoadReason, targetId?: string) {
      const snapshot = await loadAlerts(targetId ? "poll" : reason);
      if (!snapshot || stopped || !ownsPoll) return;
      emit({
        type: "snapshot",
        profileId: activeProfileId,
        ownerId: pollerId,
        reason,
        targetId,
        snapshot,
      });
    }

    function scheduleAlertsLoad(reason: AlertLoadReason) {
      if (document.visibilityState !== "visible") return;
      if (reason === "realtime" || pendingReason !== "realtime") {
        pendingReason = reason;
      }
      clearReloadTimer();
      reloadTimer = window.setTimeout(() => {
        const reasonToLoad = pendingReason;
        pendingReason = "poll";
        reloadTimer = null;
        void runLoad(reasonToLoad);
      }, 250);
    }

    function stopOwner(release = true) {
      if (!ownsPoll) return;
      ownsPoll = false;
      clearReloadTimer();
      if (heartbeatTimer) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pollInterval) {
        window.clearInterval(pollInterval);
        pollInterval = null;
      }
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
      }
      if (release && canSharePoll) {
        releasePollOwnership(ownershipKey, pollerId);
        emit({ type: "owner-released", profileId: activeProfileId, ownerId: pollerId });
      }
    }

    function startOwner(reason: AlertLoadReason) {
      if (stopped || ownsPoll || !isVisible()) return;
      if (activeOtherOwner()) return;
      if (!refreshOwnership()) return;
      ownsPoll = true;

      realtimeChannel = supabase
        .channel(`manager-work-alerts-${activeProfileId}-${pollerId}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${activeProfileId}` },
          () => scheduleAlertsLoad("realtime"),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages", filter: `recipient_id=eq.${activeProfileId}` },
          () => scheduleAlertsLoad("poll"),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tasks", filter: `assigned_to=eq.${activeProfileId}` },
          () => scheduleAlertsLoad("realtime"),
        )
        .subscribe();

      pollInterval = window.setInterval(() => {
        if (isVisible()) scheduleAlertsLoad("poll");
      }, MANAGER_WORK_ALERT_POLL_MS);

      heartbeatTimer = window.setInterval(() => {
        if (!ownsPoll) return;
        if (!isVisible()) {
          stopOwner(true);
          return;
        }
        if (!refreshOwnership()) stopOwner(false);
      }, MANAGER_WORK_ALERT_OWNER_HEARTBEAT_MS);

      void runLoad(reason);
    }

    function requestOwnerRefresh(reason: Extract<AlertLoadReason, "initial" | "visibility">) {
      if (!canSharePoll) return;
      emit({
        type: "refresh-request",
        profileId: activeProfileId,
        requesterId: pollerId,
        reason,
      });
    }

    function ensureOwner(reason: Extract<AlertLoadReason, "initial" | "visibility">) {
      if (stopped || !isVisible()) return;
      if (activeOtherOwner()) {
        requestOwnerRefresh(reason);
        return;
      }
      startOwner(reason);
    }

    function handleBroadcast(event: MessageEvent) {
      const message = event.data as AlertBroadcastMessage | undefined;
      if (!message || message.profileId !== activeProfileId) return;
      if (message.type === "snapshot") {
        if (message.ownerId === pollerId) return;
        const reason = message.targetId && message.targetId !== pollerId ? "poll" : message.reason;
        applyAlertsSnapshot(message.snapshot, reason);
        return;
      }
      if (message.type === "refresh-request") {
        if (message.requesterId !== pollerId && ownsPoll) {
          void runLoad(message.reason, message.requesterId);
        }
        return;
      }
      if (message.type === "owner-heartbeat") {
        if (message.ownerId !== pollerId && ownsPoll && readPollOwner(ownershipKey)?.id !== pollerId) {
          stopOwner(false);
        }
        return;
      }
      if (message.ownerId !== pollerId && !ownsPoll) {
        ensureOwner("visibility");
      }
    }

    function handleStorage(event: StorageEvent) {
      if (!canSharePoll || event.key !== ownershipKey || ownsPoll) return;
      if (activeOtherOwner()) return;
      ensureOwner("visibility");
    }

    function handleVisibilityChange() {
      if (!isVisible()) {
        stopOwner(true);
        return;
      }
      if (ownsPoll) {
        scheduleAlertsLoad("visibility");
      } else {
        ensureOwner("visibility");
      }
    }

    broadcast?.addEventListener("message", handleBroadcast);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const initialTimer = window.setTimeout(() => ensureOwner("initial"), 0);

    return () => {
      stopped = true;
      window.clearTimeout(initialTimer);
      stopOwner(true);
      broadcast?.removeEventListener("message", handleBroadcast);
      broadcast?.close();
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applyAlertsSnapshot, loadAlerts, profile, supabase]);

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
      if (!profile) return;
      setMessages((prev) => markMessagesReadById(prev, [id]));
      const { error } = await supabase
        .from("messages")
        .update({ read: true })
        .eq("id", id)
        .eq("recipient_id", profile.id)
        .eq("org_id", profile.org_id);
      if (error) {
        console.warn("manager markRead failed:", error.message);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === id ? { ...message, read: false } : message,
          ),
        );
      }
    },
    [profile, supabase],
  );

  const toggleMuted = useCallback(() => {
    setMuted((value) => {
      const next = !value;
      window.localStorage.setItem("check-time-manager-alert-muted", String(next));
      if (!next) unlockNotificationAudio();
      return next;
    });
  }, []);

  if (!profile || !loaded) return null;

  return (
    <div className="fixed bottom-24 right-4 z-[70] md:bottom-5 md:right-5" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggleMuted}
          className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border shadow-lg"
          style={{
            borderColor: "var(--border-default)",
            background: "rgba(7, 11, 18, 0.88)",
            color: muted ? "var(--text-muted)" : "var(--brand-yellow)",
          }}
          aria-label={muted ? "Включить звук" : "Без звука"}
          title={muted ? "Включить звук" : "Без звука"}
        >
          {muted ? <BellOff size={16} /> : <Bell size={16} />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border shadow-lg"
          style={{
            borderColor: totalBadge > 0 ? "rgba(212, 81, 94, 0.55)" : "var(--border-default)",
            background: totalBadge > 0 ? "rgba(212, 81, 94, 0.16)" : "rgba(7, 11, 18, 0.88)",
            color: totalBadge > 0 ? "var(--red)" : "var(--text-secondary)",
          }}
          aria-label="Уведомления"
          title="Уведомления"
        >
          <Bell size={17} />
          {totalBadge > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
              style={{ background: "var(--red)" }}
            >
              {totalBadge}
            </span>
          ) : null}
        </button>
      </div>

      {open ? (
        <div
          className="absolute bottom-12 right-0 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-lg)] border shadow-xl"
          style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-default)",
          }}
        >
          <div
            className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-default)" }}
          >
            <span>Уведомления</span>
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
              Назначено задач: {tasks.length}
            </Link>
          ) : null}
          <div className="max-h-[430px] overflow-y-auto">
            {totalBadge === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
                Новых уведомлений нет.
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
                      {taskKindLabel(task)}
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
                      <div className="mt-1 flex justify-end">
                        {!message.read ? (
                          <button
                            type="button"
                            onClick={() => void markRead(message.id)}
                            className="rounded-[var(--radius-sm)] px-2 py-0.5 text-[10px] font-semibold"
                            style={{ background: `${accent}1f`, color: accent }}
                          >
                            Прочитано
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
