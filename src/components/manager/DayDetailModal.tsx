"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Camera,
  Download,
  ExternalLink,
  LogIn,
  LogOut,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Media, Task } from "@/types/database";
import type { ManagerSession } from "@/lib/manager-types";
import type { WorkerAdjustmentItem } from "@/lib/worker-types";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n/translations";
import { formatDurationCompact, formatEventTime } from "@/lib/worker-utils";
import { createClient } from "@/lib/supabase/client";
import {
  MediaSignTimeoutError,
  isBrowserUnsafeVideo,
  selectMediaPlayback,
  signWithTimeout,
} from "@/lib/media-playback";
import { normalizeStoragePath } from "@/lib/task-attachments";
import { isEffectiveCompletedTask } from "@/lib/task-status";

type MediaKindTag = "check_in_video" | "checkout" | "before_leave" | "project_media" | "receipt" | "journal";

/**
 * Single read of the metadata blob → high-level kind tag for the
 * day-detail row badge. Falls through to "journal" as the catch-all
 * because every uploaded media row that isn't tagged otherwise is a
 * worker journal entry by convention.
 */
function classifyMedia(item: Media): MediaKindTag {
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  if (meta.kind === "before_leave") return "before_leave";
  if (meta.kind === "before_work" || meta.kind === "check_in_video") {
    return "check_in_video";
  }
  if (meta.kind === "project_media") return "project_media";
  if (meta.kind === "receipt" || meta.category === "receipt") return "receipt";
  if (item.is_checkout) return "checkout";
  return "journal";
}

type EventKind = "check_in" | "check_out" | "task_done" | "media" | "adjust";

type DayEvent = {
  id: string;
  kind: EventKind;
  timestamp: string;
  primary: string;
  secondary: string | null;
  mediaItem?: Media;
  /** High-level media tag for the badge — only set when kind === "media". */
  mediaTag?: MediaKindTag;
  /** Worker caption / note from the media row, if present. */
  caption?: string | null;
  /** Worker checkout note pulled from time_events.metadata.checkout_note. */
  checkoutNote?: string | null;
};

const ICON_FOR: Record<EventKind, typeof LogIn> = {
  check_in: LogIn,
  check_out: LogOut,
  task_done: CheckCircle2,
  media: Camera,
  adjust: SlidersHorizontal,
};

const COLOR_FOR: Record<EventKind, string> = {
  check_in: "var(--green)",
  check_out: "var(--red)",
  task_done: "var(--green)",
  media: "var(--brand-yellow)",
  adjust: "var(--text-muted)",
};

const MEDIA_TAG_LABELS: Record<MediaKindTag, TranslationKey> = {
  check_in_video: "dayDetail.tagCheckInVideo",
  checkout: "dayDetail.tagCheckoutVideo",
  before_leave: "dayDetail.tagCheckoutVideo",
  project_media: "dayDetail.tagProjectMedia",
  receipt: "dayDetail.tagReceipt",
  journal: "dayDetail.tagJournal",
};

const MEDIA_TAG_COLORS: Record<MediaKindTag, string> = {
  check_in_video: "var(--green)",
  checkout: "var(--red)",
  before_leave: "var(--red)",
  project_media: "var(--brand-yellow)",
  receipt: "#f97316",
  journal: "var(--text-secondary)",
};

function dayKey(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayBounds(date: string): { startMs: number; endMs: number } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

function sessionOverlapMinutes(session: ManagerSession, date: string): number {
  const { startMs, endMs } = dayBounds(date);
  const clockInMs = new Date(session.clockInTime).getTime();
  const clockOutMs = session.clockOutTime
    ? new Date(session.clockOutTime).getTime()
    : Date.now();

  if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs)) {
    return 0;
  }

  const overlapStart = Math.max(clockInMs, startMs);
  const overlapEnd = Math.min(clockOutMs, endMs);
  return Math.max(0, Math.round((overlapEnd - overlapStart) / 60_000));
}

export function DayDetailModal({
  open,
  date,
  sessions,
  tasks,
  media,
  adjustments,
  onClose,
}: {
  open: boolean;
  date: string | null;
  sessions: ManagerSession[];
  tasks: Task[];
  media: Media[];
  adjustments: WorkerAdjustmentItem[];
  onClose: () => void;
}) {
  const { locale, t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [mediaOpenError, setMediaOpenError] = useState("");
  const [previewMedia, setPreviewMedia] = useState<{
    item: Media;
    signedUrl: string;
    mimeType: string | null;
    isPlaybackVersion: boolean;
    /** True for an HEVC/.mov original most browsers can't decode. */
    browserUnsafe: boolean;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const daySessions = useMemo(() => {
    if (!date) return [];
    return sessions.filter((session) => sessionOverlapMinutes(session, date) > 0);
  }, [sessions, date]);

  const totalMinutes = useMemo(
    () =>
      date
        ? daySessions.reduce(
            (sum, session) => sum + sessionOverlapMinutes(session, date),
            0,
          )
        : 0,
    [daySessions, date],
  );

  const events: DayEvent[] = useMemo(() => {
    if (!date) return [];

    const out: DayEvent[] = [];

    for (const s of sessions) {
      if (dayKey(s.clockInTime) === date) {
        out.push({
          id: `in-${s.clockInEventId}`,
          kind: "check_in",
          timestamp: s.clockInTime,
          primary: t("dayDetail.checkIn"),
          secondary: s.projectName,
        });
      }
      if (s.clockOutTime && s.clockOutEventId && dayKey(s.clockOutTime) === date) {
        out.push({
          id: `out-${s.clockOutEventId}`,
          kind: "check_out",
          timestamp: s.clockOutTime,
          primary: t("dayDetail.checkOut"),
          secondary: `${s.projectName} · ${formatDurationCompact(s.durationMinutes)}`,
          checkoutNote: s.checkoutNote ?? null,
        });
      }
    }

    for (const task of tasks) {
      if (!isEffectiveCompletedTask(task) || !task.completed_at) continue;
      if (dayKey(task.completed_at) !== date) continue;
      out.push({
        id: `task-${task.id}`,
        kind: "task_done",
        timestamp: task.completed_at,
        primary: t("dayDetail.taskDone"),
        secondary: task.title,
      });
    }

    for (const item of media) {
      if (item.deleted_at) continue;
      if (dayKey(item.created_at) !== date) continue;
      out.push({
        id: `media-${item.id}`,
        kind: "media",
        timestamp: item.created_at,
        primary: t("dayDetail.mediaUploaded"),
        secondary: item.filename ?? item.media_type,
        mediaItem: item,
        mediaTag: classifyMedia(item),
        caption: item.caption?.trim() || null,
      });
    }

    for (const adj of adjustments) {
      if (dayKey(adj.eventTime) !== date) continue;
      const sign = adj.minutes >= 0 ? "+" : "−";
      out.push({
        id: `adj-${adj.id}`,
        kind: "adjust",
        timestamp: adj.eventTime,
        primary: t("dayDetail.adjustment"),
        secondary: `${sign}${formatDurationCompact(Math.abs(adj.minutes))}${adj.reason ? ` — ${adj.reason}` : ""}`,
      });
    }

    return out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  }, [date, sessions, tasks, media, adjustments, t]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !date) return null;

  // Preview-first open. Photos and videos render in an in-page
  // <img>/<video> so the manager doesn't have to download a file just
  // to glance at it. PDFs / unknown types still hand off to a new tab
  // because the browser's native PDF chrome beats anything inline.
  //
  // selectMediaPlayback decides which Storage path to sign:
  //   • a transcoded H.264 MP4 under metadata.playback_path when
  //     transcoding_status === "ready", OR
  //   • the original storage_path otherwise.
  // It never returns metadata.mux_playback_id as `path` — Mux IDs
  // are exposed separately so a future Mux signing layer consumes
  // them without us accidentally feeding one through Supabase Storage.
  async function openMediaItem(item: Media) {
    if (typeof window === "undefined") return;
    setMediaOpenError("");

    const playback = selectMediaPlayback(item);
    const normalized = normalizeStoragePath(playback.path);

    if (item.media_type === "pdf" || item.media_type === "document") {
      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        setMediaOpenError(t("projectDetail.mediaOpenFailed"));
        return;
      }
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(normalized, 3600);
      if (error || !data?.signedUrl) {
        tab.close();
        setMediaOpenError(t("projectDetail.mediaOpenFailed"));
        return;
      }
      tab.location.href = data.signedUrl;
      return;
    }

    setPreviewLoading(true);
    setPreviewMedia(null);
    // signWithTimeout caps the await at 9s so a hung signing call
    // can't strand the modal on Loading. See media-playback.ts for
    // the rationale.
    try {
      const signed = await signWithTimeout(
        supabase.storage.from("media").createSignedUrl(normalized, 3600),
      );
      const { data, error } = signed;

      if (error || !data?.signedUrl) {
        const isTimeout = error instanceof MediaSignTimeoutError;
        setMediaOpenError(
          isTimeout
            ? t("projectDetail.mediaOpenTimeout")
            : t("projectDetail.mediaOpenFailed"),
        );
        return;
      }

      setPreviewMedia({
        item,
        signedUrl: data.signedUrl,
        mimeType: playback.mimeType,
        isPlaybackVersion: playback.isPlaybackVersion,
        browserUnsafe:
          item.media_type === "video" &&
          !playback.isPlaybackVersion &&
          isBrowserUnsafeVideo(item),
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewMedia(null);
    setPreviewLoading(false);
  }

  async function downloadMediaItem(item: Media) {
    if (typeof window === "undefined") return;
    setMediaOpenError("");
    const normalized = normalizeStoragePath(item.storage_path);
    const fallbackName = normalized.split("/").pop() ?? "download";
    const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600, { download: downloadAs });

    if (error || !data?.signedUrl) {
      setMediaOpenError(t("projectDetail.mediaOpenFailed"));
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = downloadAs;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const headline = new Date(`${date}T12:00:00`).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[520px] overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] p-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("dayDetail.title")}
            </p>
            <h2 className="mt-0.5 text-lg font-bold text-[var(--text-primary)]">{headline}</h2>
            {totalMinutes > 0 ? (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("dayDetail.duration")}:{" "}
                <span className="font-mono font-semibold text-[var(--brand-yellow)]">
                  {formatDurationCompact(totalMinutes)}
                </span>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="max-h-[calc(85vh-100px)] space-y-1.5 overflow-y-auto p-4"
          style={{ scrollbarWidth: "thin" }}
        >
          {mediaOpenError ? (
            <div className="mb-2 rounded-[var(--radius-md)] border border-[rgba(212,81,94,0.35)] bg-[rgba(212,81,94,0.08)] px-3 py-2 text-sm text-[var(--red)]">
              {mediaOpenError}
            </div>
          ) : null}
          {events.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
              {t("dayDetail.noEvents")}
            </div>
          ) : (
            events.map((event) => {
              const Icon = ICON_FOR[event.kind];
              const color = COLOR_FOR[event.kind];
              const isClickableMedia = event.kind === "media" && Boolean(event.mediaItem);
              const tagLabel = event.mediaTag
                ? t(MEDIA_TAG_LABELS[event.mediaTag])
                : null;
              const tagColor = event.mediaTag
                ? MEDIA_TAG_COLORS[event.mediaTag]
                : null;
              const rowBody = (
                <>
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
                  >
                    <Icon size={12} style={{ color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {event.primary}
                      </span>
                      {tagLabel && tagColor ? (
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                          style={{ background: `${tagColor}1f`, color: tagColor }}
                        >
                          {tagLabel}
                        </span>
                      ) : null}
                    </div>
                    {event.secondary ? (
                      <div className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
                        {event.secondary}
                      </div>
                    ) : null}
                    {event.caption ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs italic text-[var(--text-secondary)]">
                        “{event.caption}”
                      </p>
                    ) : null}
                    {event.kind === "check_out" && event.checkoutNote ? (
                      <div
                        className="mt-2 rounded-[var(--radius-sm)] border px-2 py-1.5 text-xs"
                        style={{
                          borderColor: "rgba(191, 162, 52, 0.24)",
                          background: "rgba(191, 162, 52, 0.06)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          {t("dayDetail.checkoutNoteLabel")}
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap break-words">
                          {event.checkoutNote}
                        </div>
                      </div>
                    ) : null}
                    {isClickableMedia ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
                        >
                          <ExternalLink size={11} />
                          {t("messages.openFile")}
                        </span>
                        <button
                          type="button"
                          onClick={(clickEvent) => {
                            clickEvent.stopPropagation();
                            void downloadMediaItem(event.mediaItem!);
                          }}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                        >
                          <Download size={11} />
                          {t("messages.downloadFile")}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-[var(--text-muted)]">
                    {formatEventTime(event.timestamp)}
                  </span>
                </>
              );
              return isClickableMedia ? (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => void openMediaItem(event.mediaItem!)}
                  className="flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-left transition-colors hover:border-[var(--brand-yellow)] focus:outline-none focus-visible:border-[var(--brand-yellow)]"
                >
                  {rowBody}
                </button>
              ) : (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2"
                >
                  {rowBody}
                </div>
              );
            })
          )}
        </div>
      </div>

      {previewMedia ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={closePreview}
        >
          <div
            className="w-full max-w-[860px] max-h-[90vh] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-[var(--text-primary)]">
                  {previewMedia.item.filename ?? previewMedia.item.media_type}
                </h3>
                <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                  {formatEventTime(previewMedia.item.created_at)}
                  {" · "}
                  {previewMedia.item.media_type}
                  {previewMedia.isPlaybackVersion ? (
                    <span className="ml-2 rounded-[var(--radius-pill)] bg-[rgba(15,168,120,0.16)] px-1.5 py-0.5 font-semibold text-[var(--green)]">
                      {t("projectDetail.mediaPlaybackVersion")}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={closePreview}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-3 flex justify-center rounded-[var(--radius-md)] bg-black p-2">
              {previewMedia.item.media_type === "video" ? (
                <video
                  key={previewMedia.signedUrl}
                  src={previewMedia.signedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[68vh] w-full"
                >
                  {previewMedia.mimeType ? (
                    <source
                      src={previewMedia.signedUrl}
                      type={previewMedia.mimeType}
                    />
                  ) : null}
                </video>
              ) : previewMedia.item.media_type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewMedia.signedUrl}
                  alt={previewMedia.item.filename ?? "media"}
                  className="max-h-[68vh] w-auto object-contain"
                />
              ) : null}
            </div>

            {previewMedia.item.caption ? (
              <p className="mt-3 whitespace-pre-wrap break-words rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {previewMedia.item.caption}
              </p>
            ) : null}

            {previewMedia.browserUnsafe ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs font-semibold text-[#f59e0b]">
                {t("projectDetail.mediaBrowserUnsafe")}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <a
                href={previewMedia.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
              >
                <ExternalLink size={12} />
                {t("messages.openFile")}
              </a>
              <button
                type="button"
                onClick={() => void downloadMediaItem(previewMedia.item)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
              >
                <Download size={12} />
                {t("messages.downloadFile")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewLoading && !previewMedia ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 text-sm font-semibold text-white"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={closePreview}
        >
          {t("common.loading")}
        </div>
      ) : null}
    </div>
  );
}
