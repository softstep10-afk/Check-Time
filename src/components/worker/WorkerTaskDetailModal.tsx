"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Hand, Mic, MicOff, Paperclip, Play, X } from "lucide-react";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { useTranslation } from "@/lib/i18n";
import {
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
} from "@/lib/task-notifications";
import {
  getEffectiveTaskStatus,
  isEffectiveCompletedTask,
} from "@/lib/task-status";
import { getMaterialTaskItems, isMaterialTask } from "@/lib/material-tasks";
import { ACCEPT_ALL_UPLOADS } from "@/lib/upload-limits";
import type { TaskStatus } from "@/types/database";
import type { TaskAttachmentRef } from "@/lib/task-attachments";
import type { WorkerTaskModalMode } from "@/lib/worker-task-ui";

export type WorkerTaskDetailItem = {
  id: string;
  project_id: string | null;
  projectName?: string | null;
  assigned_to: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: TaskStatus;
  due_date: string | null;
  attachments?: TaskAttachmentRef[];
  /**
   * Carried through so the modal can render the read-only completion
   * evidence panel on already-done tasks (note, follow-up, media).
   * Optional — callers that don't have metadata pass undefined.
   */
  metadata?: Record<string, unknown> | null;
  /**
   * Pre-resolved completion media refs. The parent looks up
   * metadata.completion_media_ids against its attachment map and
   * passes the resolved rows in. Avoids the modal needing its own
   * media query.
   */
  completionAttachments?: TaskAttachmentRef[];
  /** ISO timestamp of completion, mirrored from tasks.completed_at. */
  completed_at?: string | null;
};

export interface WorkerTaskCompletionPayload {
  /** Worker's text note. Empty string allowed — caller trims. */
  note?: string;
  /** True when the worker checked "Needs follow-up". */
  followUpRequired?: boolean;
  /** Free-form follow-up text. */
  followUpNote?: string;
  /** Files the worker attached (photos / video / PDF / business documents). */
  files?: File[];
}

type WorkerTaskDetailModalProps = {
  task: WorkerTaskDetailItem | null;
  /**
   * Render mode hint passed through by callers that route a card's
   * "Mark done" tap straight into the completion form. The modal still
   * renders the same content either way; the mode just adds a stable
   * data-testid so end-to-end checks can assert "this open is the
   * completion path, not just a details peek".
   */
  initialMode?: WorkerTaskModalMode;
  profileId: string;
  busy: boolean;
  busyLabel?: string;
  onClose: () => void;
  onStart: (taskId: string) => void;
  /**
   * Marks the task done with an optional completion-evidence payload.
   * The parent persists everything into `tasks.metadata` and uploads
   * any attached files via `uploadTaskAttachment`. Empty / undefined
   * fields skip their respective metadata writes.
   */
  onDone: (taskId: string, payload?: WorkerTaskCompletionPayload) => void;
  /**
   * Optional — when omitted the Claim button never renders. Pages that
   * surface common (assigned_to=null) project tasks pass a handler;
   * pages that only show "my tasks" (e.g. the global TasksPage) leave
   * it undefined.
   */
  onClaim?: (taskId: string) => void;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

type DictationState = {
  /** Web Speech API is available in this browser. */
  supported: boolean;
  /** True while the recogniser is actively listening. */
  listening: boolean;
  /** Latest interim phrase — UI hint only, never committed. */
  interim: string;
  /** Microphone permission was denied by the browser / OS. */
  permissionDenied: boolean;
  /** Toggle start/stop. */
  toggle: () => void;
};

/**
 * Russian-only dictation for the completion comment field. Wraps the
 * Web Speech API directly (window.SpeechRecognition /
 * webkitSpeechRecognition) with lang="ru-RU", continuous=true and
 * interimResults=true.
 *
 * Final phrases are forwarded via `onFinal` so the parent can append
 * them to the textarea value with a space separator. Interim phrases
 * stay in local state — the modal renders them as a subtle hint and
 * never commits them to the textarea.
 */
function useCompletionDictation({
  onFinal,
}: {
  onFinal: (text: string) => void;
}): DictationState {
  // Lazy init: runs once per mount. On the server (SSR / static
  // markup tests) `window` is undefined → false, so the mic button
  // is omitted. On the client, the modal only mounts after a worker
  // click, so we're guaranteed to be in the browser by the time this
  // executes — no hydration mismatch and no need for a setState-in-effect.
  const [supported] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    return Boolean(SpeechRec);
  });
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onFinalRef = useRef(onFinal);

  // Keep the latest onFinal in a ref so the recognition `onresult`
  // closure (created once when the recogniser starts) always calls
  // the current callback even if the parent's identity changed.
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        // ignore — already stopped
      }
      recognitionRef.current = null;
    }
    setListening(false);
    setInterim("");
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }

    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRec) return;

    const recognition = new SpeechRec();
    recognition.lang = "ru-RU";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      try {
        let finalChunk = "";
        let interimChunk = "";
        const results = event.results;
        // event.resultIndex points at the first newly-changed result;
        // walking from there avoids re-emitting earlier finals on each tick.
        for (let i = event.resultIndex ?? 0; i < results.length; i++) {
          const transcript: string = results[i][0]?.transcript ?? "";
          if (results[i].isFinal) {
            finalChunk += transcript;
          } else {
            interimChunk += transcript;
          }
        }
        const trimmedFinal = finalChunk.trim();
        if (trimmedFinal) {
          onFinalRef.current(trimmedFinal);
        }
        setInterim(interimChunk.trim());
      } catch {
        // Defensive — a malformed event shouldn't crash the modal.
      }
    };

    recognition.onerror = (event: any) => {
      const errorType = event?.error ?? "unknown";
      if (errorType === "no-speech") return; // silence is not an error
      if (errorType === "not-allowed" || errorType === "service-not-allowed") {
        setPermissionDenied(true);
      }
      stop();
    };

    recognition.onend = () => {
      // continuous=true can still fire onend on its own (network hiccup,
      // long pause). Reset state so the next tap restarts cleanly.
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setPermissionDenied(false);
    } catch {
      recognitionRef.current = null;
      setListening(false);
    }
  }, [listening, stop]);

  // Always release the mic when the modal unmounts.
  useEffect(() => {
    return () => {
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return { supported, listening, interim, permissionDenied, toggle };
}

export function WorkerTaskDetailModal(props: WorkerTaskDetailModalProps) {
  if (!props.task) return null;
  // Re-key the body on task.id so switching to a different task remounts
  // the inner subtree. Drops any local state (e.g. the completion note)
  // without an effect — keeps us under the react-hooks/set-state-in-effect
  // rule the project lints with.
  return <WorkerTaskDetailModalBody key={props.task.id} {...props} />;
}

function WorkerTaskDetailModalBody({
  task,
  initialMode = "details",
  profileId,
  busy,
  busyLabel,
  onClose,
  onStart,
  onDone,
  onClaim,
}: WorkerTaskDetailModalProps) {
  const { t } = useTranslation();
  const [completionNote, setCompletionNote] = useState("");
  const [followUpRequired, setFollowUpRequired] = useState(false);
  const [followUpNote, setFollowUpNote] = useState("");
  const [completionFiles, setCompletionFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Append a finalised dictation phrase to the current note value with
  // a space separator. Functional updater so concurrent typing and
  // dictation never overwrite each other.
  const handleDictationFinal = useCallback((text: string) => {
    setCompletionNote((current) => {
      if (!current) return text;
      const sep = current.endsWith(" ") ? "" : " ";
      return `${current}${sep}${text}`;
    });
  }, []);

  const dictation = useCompletionDictation({ onFinal: handleDictationFinal });

  if (!task) return null;

  const isMine = task.assigned_to === profileId;
  const isUnassigned = task.assigned_to === null;
  const isDeliveryTask = task.metadata?.schedule_kind === "delivery";
  const materialItems = isMaterialTask(task) ? getMaterialTaskItems(task) : [];
  const isCommonClaimable = isUnassigned && (Boolean(task.project_id) || isDeliveryTask) && Boolean(onClaim);
  const effectiveStatus = getEffectiveTaskStatus(task);
  // Status-driven buttons only render for tasks the worker already
  // owns. Claim-then-start is a two-step flow: claim flips assigned_to,
  // and the parent re-renders the modal with isMine=true.
  const canStart = isMine && effectiveStatus === "pending";
  const canFinish = isMine && effectiveStatus !== "done" && effectiveStatus !== "cancelled";
  const readOnlyReason = isMine
    ? null
    : isCommonClaimable
      ? t("tasks.commonTaskClaimHint")
      : isUnassigned
        ? t("tasks.projectTaskReadOnly")
        : t("tasks.projectTaskReadOnlyAssigned");

  return (
    // Inline fixed-position modal. We deliberately avoid React.createPortal
    // here: previous attempts to portal-mount to document.body produced
    // an empty render in this dev-mode setup (zero __reactProps$ keys
    // attached to the portal root in CDP probes), so we keep the modal
    // in the same React subtree as its trigger. The high z-index plus
    // the `pointer-events-auto` inner shell guarantee clicks land here
    // even if a sibling chrome (worker bottom nav, banners) overlays
    // partially. Inline numeric z-index (not Tailwind's `z-[80]`)
    // sidesteps any case where Tailwind's arbitrary-value class fails
    // to compile under Turbopack.
    <div
      role="dialog"
      aria-modal="true"
      data-testid="worker-task-detail-modal"
      className="fixed inset-0 flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)", zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:rounded-[var(--radius-lg)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("tasks.taskDetails")}
            </p>
            <h2 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
              {task.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span>{task.projectName ?? t("common.general")}</span>
              <span>·</span>
              <span>{task.priority}</span>
              <span>·</span>
              <span>{effectiveStatus.replace("_", " ")}</span>
              {task.due_date ? (
                <>
                  <span>·</span>
                  <span>{t("tasks.due")} {task.due_date}</span>
                </>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            data-testid="worker-task-detail-close"
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        {task.description ? (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
            {task.description}
          </p>
        ) : (
          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("tasks.noDescription")}
          </div>
        )}

        {materialItems.length > 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {t("materials.materialTask")}
            </div>
            <div className="grid gap-2">
              {materialItems.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  className="rounded-[var(--radius-sm)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-secondary)]"
                >
                  <div className="font-semibold text-[var(--text-primary)]">{item.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {item.quantity ? (
                      <span>
                        {t("materials.quantity")}: {item.quantity}
                      </span>
                    ) : null}
                    {item.unit ? <span>{item.unit}</span> : null}
                    {item.notes ? <span>{item.notes}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {task.attachments && task.attachments.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              {task.attachments.length} {t("tasks.filesShort")}
            </div>
            <TaskAttachmentList items={task.attachments} />
          </div>
        ) : null}

        {task.project_id ? (
          <Link
            href={`/project/${task.project_id}`}
            className="mt-4 inline-flex text-xs font-semibold text-[var(--brand-yellow)]"
          >
            {t("workerProject.openProject")} →
          </Link>
        ) : null}

        {readOnlyReason ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-xs text-[var(--text-secondary)]">
            {readOnlyReason}
          </div>
        ) : null}

        {(() => {
          // Read-only completion evidence — surfaced once the task is
          // done so the worker can see exactly what they (or the prior
          // worker on a project task) submitted. Manager-side surfaces
          // render the same data using the same helpers.
          const completionNoteSaved = getCompletionNote({ metadata: task.metadata ?? null });
          const followUp = getFollowUpInfo({ metadata: task.metadata ?? null });
          const completionRefs = task.completionAttachments ?? [];
          const completionIdsKnown = getCompletionMediaIds({ metadata: task.metadata ?? null });
          const hasEvidence =
            Boolean(completionNoteSaved) ||
            followUp.required ||
            completionRefs.length > 0 ||
            completionIdsKnown.length > 0 ||
            Boolean(task.completed_at);
          if (!isEffectiveCompletedTask(task) || !hasEvidence) return null;
          return (
            <div
              className="mt-4 rounded-[var(--radius-md)] border p-3"
              style={{
                borderColor: followUp.required
                  ? "rgba(245, 158, 11, 0.35)"
                  : "rgba(15, 168, 120, 0.24)",
                background: followUp.required
                  ? "rgba(245, 158, 11, 0.06)"
                  : "rgba(15, 168, 120, 0.06)",
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {t("tasks.completionEvidenceHeader")}
                </div>
                {followUp.required ? (
                  <span
                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                    style={{ background: "rgba(245, 158, 11, 0.16)", color: "#f59e0b" }}
                  >
                    {t("tasks.followUpBadge")}
                  </span>
                ) : null}
              </div>
              {task.completed_at ? (
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {t("tasks.completionAtLabel")}: {task.completed_at}
                </div>
              ) : null}
              {completionNoteSaved ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-primary)]">
                  {completionNoteSaved}
                </p>
              ) : null}
              {followUp.required && followUp.note ? (
                <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-secondary)]">
                  <span className="font-semibold">{t("tasks.followUpNoteLabel")}: </span>
                  {followUp.note}
                </div>
              ) : null}
              {completionRefs.length > 0 ? (
                <div className="mt-2">
                  <TaskAttachmentList items={completionRefs} />
                </div>
              ) : null}
            </div>
          );
        })()}

        {/* Completion form — note + optional photos/video/PDF + a
            "needs follow-up" flag with its own note. Only relevant
            while the worker can still mark the task done. The parent
            persists everything into tasks.metadata + uploads files via
            uploadTaskAttachment, so an empty form falls through to the
            same fast path the prior version used. */}
        {canFinish ? (
          <div
            data-testid={
              initialMode === "completion"
                ? "worker-task-completion-modal"
                : "worker-task-completion-form"
            }
            className="mt-4 space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3"
          >
            <div>
              <label
                htmlFor={`worker-task-note-${task.id}`}
                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
              >
                {t("tasks.completionNoteLabel")}
              </label>
              {/* Relative wrapper anchors the mic button inside the
                  textarea's top-right corner. pr-10 on the textarea
                  keeps the caret away from the icon. */}
              <div className="relative mt-1">
                <textarea
                  id={`worker-task-note-${task.id}`}
                  data-testid="worker-task-completion-note"
                  value={completionNote}
                  onChange={(event) => setCompletionNote(event.target.value)}
                  placeholder={t("tasks.completionNotePlaceholder")}
                  rows={2}
                  className="block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 pr-10 text-sm text-[var(--text-primary)] outline-none"
                />
                {dictation.supported ? (
                  <button
                    type="button"
                    onClick={dictation.toggle}
                    aria-label={
                      dictation.listening
                        ? t("tasks.dictationStop")
                        : t("tasks.dictationStart")
                    }
                    aria-pressed={dictation.listening}
                    data-testid="worker-task-completion-mic"
                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors"
                    style={{
                      background: dictation.listening
                        ? "rgba(212, 81, 94, 0.22)"
                        : "transparent",
                      color: dictation.listening
                        ? "var(--red)"
                        : "var(--text-muted)",
                      border: dictation.listening
                        ? "1px solid rgba(212, 81, 94, 0.45)"
                        : "1px solid var(--border-default)",
                    }}
                  >
                    {dictation.listening ? (
                      <MicOff size={14} className="animate-pulse" />
                    ) : (
                      <Mic size={14} />
                    )}
                  </button>
                ) : null}
              </div>
              {/* Subtle interim hint — never written to state, replaced
                  on each speech tick, dropped when the recognizer ends. */}
              {dictation.listening ? (
                <div
                  data-testid="worker-task-completion-interim"
                  className="mt-1 flex items-center gap-1.5 text-[11px] italic text-[var(--text-muted)]"
                  aria-live="polite"
                >
                  <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full"
                    style={{ background: "var(--red)" }}
                  />
                  {dictation.interim
                    ? dictation.interim
                    : t("tasks.dictationListening")}
                </div>
              ) : null}
              {dictation.permissionDenied ? (
                <div
                  role="alert"
                  data-testid="worker-task-completion-mic-denied"
                  className="mt-1 text-[11px] font-semibold"
                  style={{ color: "var(--red)" }}
                >
                  {t("tasks.dictationPermissionDenied")}
                </div>
              ) : null}
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("tasks.completionEvidenceLabel")}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT_ALL_UPLOADS}
                multiple
                data-testid="worker-task-completion-files"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  setCompletionFiles(files);
                }}
                className="mt-1 block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
              />
              {completionFiles.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <Paperclip size={12} />
                  {completionFiles.length === 1
                    ? completionFiles[0].name
                    : `${completionFiles.length} ${t("tasks.filesShort")}`}
                </div>
              ) : null}
            </div>

            <label className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                data-testid="worker-task-followup-toggle"
                checked={followUpRequired}
                onChange={(event) => setFollowUpRequired(event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--brand-yellow)]"
              />
              <span>
                <span className="font-semibold">{t("tasks.followUpRequiredLabel")}</span>
                <span className="block text-[10px] text-[var(--text-muted)]">
                  {t("tasks.followUpRequiredHint")}
                </span>
              </span>
            </label>

            {followUpRequired ? (
              <div>
                <label
                  htmlFor={`worker-task-followup-${task.id}`}
                  className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]"
                >
                  {t("tasks.followUpNoteLabel")}
                </label>
                <textarea
                  id={`worker-task-followup-${task.id}`}
                  data-testid="worker-task-followup-note"
                  value={followUpNote}
                  onChange={(event) => setFollowUpNote(event.target.value)}
                  placeholder={t("tasks.followUpNotePlaceholder")}
                  rows={2}
                  className="mt-1 block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold"
            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
          >
            {t("common.cancel")}
          </button>
          {isCommonClaimable && onClaim ? (
            <button
              type="button"
              onClick={() => onClaim(task.id)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              <Hand size={14} />
              {busy ? busyLabel ?? t("tasks.taking") : t("tasks.claimCta")}
            </button>
          ) : null}
          {canStart ? (
            <button
              type="button"
              onClick={() => onStart(task.id)}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--brand-yellow)", color: "var(--brand-yellow)" }}
            >
              <Play size={14} />
              {busy ? busyLabel ?? t("tasks.taking") : t("common.start")}
            </button>
          ) : null}
          {canFinish ? (
            <button
              type="button"
              onClick={() => {
                const trimmedNote = completionNote.trim();
                const trimmedFollowUp = followUpNote.trim();
                const payload: WorkerTaskCompletionPayload = {
                  note: trimmedNote || undefined,
                  followUpRequired,
                  followUpNote: followUpRequired ? trimmedFollowUp || undefined : undefined,
                  files: completionFiles.length > 0 ? completionFiles : undefined,
                };
                const isEmpty =
                  !payload.note &&
                  !payload.followUpRequired &&
                  !payload.followUpNote &&
                  !payload.files;
                onDone(task.id, isEmpty ? undefined : payload);
              }}
              disabled={busy}
              data-testid="worker-task-mark-done"
              className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              <CheckCircle2 size={14} />
              {busy
                ? busyLabel ?? t("tasks.finishing")
                : followUpRequired
                  ? t("tasks.markDoneWithFollowUp")
                  : t("tasks.markDone")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
