"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import {
  PRIORITY_COLOR,
  PRIORITY_EMOJI,
  type MessagePriority,
} from "@/lib/message-types";
import { isTaskMessagePriority, mergeMessagesById } from "@/lib/message-state";

type CrewMember = { id: string; name: string; role: string };
type ProjectOption = { id: string; name: string; status?: string | null };
type InsertedMessage = { id: string; recipient_id: string };

type HistoryRow = {
  id: string;
  recipient_id: string;
  text: string;
  priority: MessagePriority;
  read: boolean;
  created_at: string;
};

const PRIORITY_OPTIONS: MessagePriority[] = ["urgent", "info", "good", "task"];

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

function formatRelativeTime(iso: string, lang: "en" | "ru"): string {
  const nowMs = Date.now();
  const thenMs = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (diffSec < 60) return lang === "ru" ? "только что" : "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return lang === "ru" ? `${min} мин назад` : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return lang === "ru" ? `${hr} ч назад` : `${hr} hr ago`;
  const day = Math.round(hr / 24);
  return lang === "ru" ? `${day} дн назад` : `${day} d ago`;
}

function mapHistoryRow(row: {
  id: string;
  recipient_id: string;
  text: string;
  priority?: string | null;
  color?: string | null;
  metadata?: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}): HistoryRow {
  return {
    id: row.id,
    recipient_id: row.recipient_id,
    text: row.text,
    priority: inferPriority(row),
    read: row.read,
    created_at: row.created_at,
  };
}

export function BulkMessageComposer({
  orgId,
  senderId,
  senderName,
  crew,
  projects = [],
  historyLimit = 20,
  embedded = false,
}: {
  orgId: string;
  senderId: string;
  senderName: string;
  senderRole?: string;
  crew: CrewMember[];
  projects?: ProjectOption[];
  historyLimit?: number;
  embedded?: boolean;
}) {
  const { t, locale } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [sendToAll, setSendToAll] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("info");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const historyReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recipientOptions = useMemo(
    () => crew.filter((member) => member.id !== senderId),
    [crew, senderId],
  );
  const allRecipientCount = recipientOptions.length;
  const recipientCount = sendToAll
    ? allRecipientCount
    : [...selectedIds].filter((id) => id !== senderId).length;
  const crewById = useMemo(() => new Map(crew.map((c) => [c.id, c])), [crew]);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id, recipient_id, text, priority, color, metadata, read, created_at")
      .eq("sender_id", senderId)
      .order("created_at", { ascending: false })
      .limit(historyLimit);
    setHistory(
      ((data ?? []) as Array<Parameters<typeof mapHistoryRow>[0]>).map(mapHistoryRow),
    );
    setHistoryLoading(false);
  }, [historyLimit, supabase, senderId]);

  const scheduleHistoryLoad = useCallback(() => {
    if (historyReloadTimerRef.current) clearTimeout(historyReloadTimerRef.current);
    historyReloadTimerRef.current = setTimeout(() => {
      historyReloadTimerRef.current = null;
      void loadHistory();
    }, 250);
  }, [loadHistory]);

  useEffect(() => {
    // Defer to microtask so the initial load's setState doesn't fire
    // inside the render/effect body synchronously.
    const id = setTimeout(() => {
      void loadHistory();
    }, 0);
    return () => clearTimeout(id);
  }, [loadHistory]);

  useEffect(() => {
    return () => {
      if (historyReloadTimerRef.current) {
        clearTimeout(historyReloadTimerRef.current);
        historyReloadTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    function mergeHistoryPayload(row: unknown) {
      const nextRow = row as (Parameters<typeof mapHistoryRow>[0] & { sender_id?: string | null }) | null;
      if (!nextRow?.id || nextRow.sender_id !== senderId) return;
      setHistory((current) =>
        mergeMessagesById(current, mapHistoryRow(nextRow)).slice(0, historyLimit),
      );
      setHistoryLoading(false);
    }

    const channel = supabase
      .channel(`manager-message-history-${senderId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${senderId}`,
        },
        (payload) => {
          mergeHistoryPayload(payload.new);
          scheduleHistoryLoad();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `sender_id=eq.${senderId}`,
        },
        (payload) => {
          mergeHistoryPayload(payload.new);
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadHistory();
    }, 30_000);
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void loadHistory();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [historyLimit, loadHistory, scheduleHistoryLoad, senderId, supabase]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setMessage({ kind: "err", text: t("messages.emptyText") });
      return;
    }
    const recipients = sendToAll
      ? recipientOptions.map((c) => c.id)
      : [...selectedIds].filter((id) => id !== senderId);
    if (recipients.length === 0) {
      setMessage({ kind: "err", text: t("messages.pickRecipient") });
      return;
    }

    setSending(true);
    setMessage(null);

    const color = PRIORITY_COLOR[priority];
    const rows = recipients.map((recipientId) => ({
      org_id: orgId,
      sender_id: senderId,
      recipient_id: recipientId,
      text: text.trim(),
      color,
      priority,
      metadata: { priority, broadcast: sendToAll },
    }));

    // Chunk to 50 per insert to keep under request size on bigger orgs.
    let failures = 0;
    const insertedMessages: InsertedMessage[] = [];
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      let result = await supabase
        .from("messages")
        .insert(chunk)
        .select("id, recipient_id");
      let error = result.error;
      if (error && /column .* priority/i.test(error.message)) {
        const fallbackChunk = chunk.map((row) => ({
          org_id: row.org_id,
          sender_id: row.sender_id,
          recipient_id: row.recipient_id,
          text: row.text,
          color: row.color,
          metadata: row.metadata,
        }));
        result = await supabase
          .from("messages")
          .insert(fallbackChunk)
          .select("id, recipient_id");
        error = result.error;
      }
      if (error) failures += error ? 1 : 0;
      else insertedMessages.push(...((result.data ?? []) as InsertedMessage[]));
    }

    if (failures > 0) {
      setSending(false);
      setMessage({
        kind: "err",
        text: `${failures} / ${Math.ceil(rows.length / 50)} ${t("common.errorTryAgain").toLowerCase()}`,
      });
      return;
    }

    if (isTaskMessagePriority(priority)) {
      const taskTitle = text.trim().length > 140
        ? `${text.trim().slice(0, 137)}...`
        : text.trim();
      const taskResponse = await fetch("/api/manager/message-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority,
          items: insertedMessages.map((message) => ({
            messageId: message.id,
            recipientId: message.recipient_id,
            title: taskTitle,
            description: text.trim(),
            projectId: taskProjectId || null,
            source: "broadcast_task",
          })),
        }),
      });
      const taskResult = (await taskResponse.json().catch(() => ({}))) as {
        error?: string;
        tasks?: Array<{ id: string }>;
      };

      if (!taskResponse.ok || (taskResult.tasks?.length ?? 0) !== insertedMessages.length) {
        setSending(false);
        setMessage({
          kind: "err",
          text: t("messages.taskCreateFailed").replace(
            "{error}",
            taskResult.error ?? t("common.errorTryAgain"),
          ),
        });
        return;
      }
    }

    setSending(false);
    setMessage({
      kind: "ok",
      text: priority === "task"
        ? t("messages.tasksCreated").replace("{n}", String(rows.length))
        : t("messages.sentTo").replace("{n}", String(rows.length)),
    });
    setText("");
    setTaskProjectId("");
    setSelectedIds(new Set());
    setSendToAll(false);
    scheduleHistoryLoad();
  }

  return (
    <div className={embedded ? "space-y-4" : "mx-auto max-w-[1000px] space-y-5 p-5"}>
      {!embedded ? (
        <section className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("nav.messages")}
          </p>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
            {t("messages.bulkTitle")}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {t("messages.bulkSubtitle").replace("{name}", senderName)}
          </p>
        </section>
      ) : null}

      <section className="surface-card p-4">
        <form onSubmit={handleSend} className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={sendToAll}
              onChange={(e) => {
                setSendToAll(e.target.checked);
                if (e.target.checked) setSelectedIds(new Set());
              }}
              className="h-4 w-4"
            />
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--text-primary)]">
              <Users size={14} /> {t("messages.sendToAll")}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              ({allRecipientCount} {t("messages.people")})
            </span>
          </label>

          {!sendToAll ? (
            <fieldset className="space-y-2">
              <legend className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t("messages.pickRecipients")}
              </legend>
              <div className="grid max-h-[200px] gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 sm:grid-cols-2">
                {recipientOptions.map((member) => {
                  const checked = selectedIds.has(member.id);
                  return (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5"
                      style={{ background: checked ? "rgba(191, 162, 52, 0.1)" : "transparent" }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(member.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{member.name}</span>
                      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                        {member.role}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <fieldset className="space-y-1.5">
            <legend className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("messages.priority")}
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRIORITY_OPTIONS.map((p) => {
                const accent = PRIORITY_COLOR[p];
                const selected = priority === p;
                const labelKey = (
                  p === "urgent"
                    ? "messages.priorityUrgent"
                    : p === "info"
                      ? "messages.priorityInfo"
                      : p === "good"
                        ? "messages.priorityGood"
                        : "messages.priorityTask"
                ) as Parameters<typeof t>[0];
                return (
                  <label
                    key={p}
                    className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2 text-xs font-semibold"
                    style={{
                      borderColor: selected ? accent : "var(--border-default)",
                      background: selected ? `${accent}1f` : "transparent",
                      color: selected ? accent : "var(--text-secondary)",
                    }}
                  >
                    <input
                      type="radio"
                      name="priority"
                      value={p}
                      checked={selected}
                      onChange={() => setPriority(p)}
                      className="sr-only"
                    />
                    <span aria-hidden>{PRIORITY_EMOJI[p]}</span>
                    <span>{t(labelKey)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {priority === "task" && projects.length > 0 ? (
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t("messages.taskProject")}
              </span>
              <select
                value={taskProjectId}
                onChange={(event) => setTaskProjectId(event.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("messages.taskProjectNone")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <TextInputWithVoice
            multiline
            name="msg-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("messages.placeholder")}
            className="min-h-[100px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />

          {message ? (
            <div
              className="text-xs font-semibold"
              style={{ color: message.kind === "ok" ? "var(--green)" : "var(--red)" }}
            >
              {message.text}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-[var(--text-secondary)]">
              {recipientCount > 0
                ? t("messages.willSendTo").replace("{n}", String(recipientCount))
                : t("messages.noRecipients")}
            </div>
            <button
              type="submit"
              disabled={sending || recipientCount === 0 || !text.trim()}
              className="button-base button-primary inline-flex items-center gap-1.5"
              style={{ background: PRIORITY_COLOR[priority] }}
            >
              <Send size={14} />
              {sending ? t("messages.sending") : t("messages.sendCta")}
            </button>
          </div>
        </form>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("messages.historyTitle")}
        </h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("messages.historySubtitle")}
        </p>
        <div className="mt-4 space-y-2">
          {historyLoading ? (
            <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
          ) : history.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("messages.historyEmpty")}
            </div>
          ) : (
            history.map((row) => {
              const recipient = crewById.get(row.recipient_id);
              const accent = PRIORITY_COLOR[row.priority] ?? "var(--text-muted)";
              const preview = row.text.length > 80 ? row.text.slice(0, 80) + "…" : row.text;
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  style={{ borderLeft: `3px solid ${accent}` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {recipient?.name ?? row.recipient_id.slice(0, 8)}
                      </span>
                      <span
                        className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                        style={{ background: `${accent}1f`, color: accent }}
                      >
                        {row.priority}
                      </span>
                      <span
                        className="text-[10px] font-semibold"
                        style={{ color: row.read ? "var(--green)" : "var(--text-muted)" }}
                        title={
                          row.read
                            ? t("messages.statusRead")
                            : t("messages.statusUnread")
                        }
                      >
                        {row.read ? `✓ ${t("messages.statusRead")}` : `○ ${t("messages.statusUnread")}`}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-secondary)]">{preview}</div>
                  </div>
                  <div className="whitespace-nowrap text-[10px] text-[var(--text-muted)]">
                    {formatRelativeTime(row.created_at, locale === "ru" ? "ru" : "en")}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
