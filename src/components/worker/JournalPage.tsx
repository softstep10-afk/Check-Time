"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileVideo2, Trash2, UploadCloud } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { formatDateTime } from "@/lib/worker-utils";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { createClient } from "@/lib/supabase/client";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import { normalizeStoragePath } from "@/lib/task-attachments";
import { MediaViewerModal } from "@/components/shared/MediaViewerModal";
import {
  ACCEPT_ALL_UPLOADS,
  ACCEPT_DOCUMENT_UPLOADS,
  ACCEPT_IMAGE_UPLOADS,
  ACCEPT_PDF_UPLOADS,
  ACCEPT_VIDEO_UPLOADS,
} from "@/lib/upload-limits";
import type { WorkerMediaItem } from "@/lib/worker-types";

type PendingUpload = {
  id: string;
  file: File;
  previewUrl: string | null;
  kind: "image" | "video" | "document";
};

function buildPendingUploads(files: FileList | null): PendingUpload[] {
  return Array.from(files ?? []).map((file, index) => ({
    id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
    file,
    previewUrl:
      file.type.startsWith("image/") || file.type.startsWith("video/")
        ? URL.createObjectURL(file)
        : null,
    kind: file.type.startsWith("image/")
      ? "image"
      : file.type.startsWith("video/")
        ? "video"
        : "document",
  }));
}

function revokePendingUploads(files: PendingUpload[]) {
  for (const file of files) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
}

export function JournalPage() {
  const { shell, busyAction, uploadMedia } = useWorkerShell();
  const { t } = useTranslation();
  const journalInputRef = useRef<HTMLInputElement | null>(null);
  const journalPhotoRef = useRef<HTMLInputElement | null>(null);
  const journalVideoRef = useRef<HTMLInputElement | null>(null);
  const journalPdfRef = useRef<HTMLInputElement | null>(null);
  const checkoutInputRef = useRef<HTMLInputElement | null>(null);
  const startInputRef = useRef<HTMLInputElement | null>(null);
  const [journalFiles, setJournalFiles] = useState<PendingUpload[]>([]);
  const [checkoutFiles, setCheckoutFiles] = useState<PendingUpload[]>([]);
  const [startFiles, setStartFiles] = useState<PendingUpload[]>([]);
  const [journalCaption, setJournalCaption] = useState("");
  const [checkoutCaption, setCheckoutCaption] = useState("");
  const [startCaption, setStartCaption] = useState("");
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [mediaOpenError, setMediaOpenError] = useState("");
  // Local save status surfaced inline next to the Capture-the-day form.
  // Mirrors the global banner pattern but lives where the worker is
  // actually looking — without this the spec's "Do not silently fail"
  // requirement leans on a banner that may already have been dismissed.
  const [saveStatus, setSaveStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Selected entry for the in-app viewer. Primary tap on a journal row
  // opens this modal instead of a new browser tab — the spec calls out
  // "Do not open a new browser tab as the default action".
  const [viewerEntry, setViewerEntry] = useState<WorkerMediaItem | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const recentMediaIds = useMemo(
    () => shell.media.map((m) => m.id),
    [shell.media],
  );

  // Pre-compute the 7-day filter once so the render stays pure.
  // eslint-disable-next-line react-hooks/purity
  const cutoffRef = useRef<number>(Date.now() - 7 * 86_400_000);
  const last7DaysMedia = useMemo(() => {
    const cutoff = cutoffRef.current;
    return shell.media.filter(
      (m) => new Date(m.created_at).getTime() >= cutoff,
    );
  }, [shell.media]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await fetchOpenFlagMediaIds(supabase, recentMediaIds);
      if (!cancelled) setOpenFlagIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, recentMediaIds]);

  async function refreshOpenFlags() {
    const ids = await fetchOpenFlagMediaIds(supabase, recentMediaIds);
    setOpenFlagIds(ids);
  }

  function openMediaItem(entry: WorkerMediaItem) {
    // Primary action — open the in-app viewer modal instead of
    // redirecting a fresh browser tab. The viewer signs its own URL
    // and falls back to a Download button when the browser cannot
    // decode the file (HEVC .mov, etc).
    setMediaOpenError("");
    setViewerEntry(entry);
  }

  async function downloadMediaItem(entry: WorkerMediaItem) {
    if (typeof window === "undefined") return;
    setMediaOpenError("");
    const normalized = normalizeStoragePath(entry.storage_path);
    const fallbackName = normalized.split("/").pop() ?? "download";
    const downloadAs = (entry.filename && entry.filename.trim()) || fallbackName;
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

  useEffect(() => {
    return () => {
      revokePendingUploads(journalFiles);
      revokePendingUploads(checkoutFiles);
      revokePendingUploads(startFiles);
    };
  }, [checkoutFiles, journalFiles, startFiles]);

  function replaceJournalFiles(files: FileList | null) {
    setJournalFiles((current) => {
      revokePendingUploads(current);
      return buildPendingUploads(files);
    });
  }

  function replaceCheckoutFiles(files: FileList | null) {
    setCheckoutFiles((current) => {
      revokePendingUploads(current);
      return buildPendingUploads(files);
    });
  }

  function replaceStartFiles(files: FileList | null) {
    setStartFiles((current) => {
      revokePendingUploads(current);
      return buildPendingUploads(files);
    });
  }

  function removeStartFile(fileId: string) {
    setStartFiles((current) => {
      const removed = current.find((file) => file.id === fileId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((file) => file.id !== fileId);
    });
  }

  function removeJournalFile(fileId: string) {
    setJournalFiles((current) => {
      const removed = current.find((file) => file.id === fileId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((file) => file.id !== fileId);
    });
  }

  function removeCheckoutFile(fileId: string) {
    setCheckoutFiles((current) => {
      const removed = current.find((file) => file.id === fileId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return current.filter((file) => file.id !== fileId);
    });
  }

  return (
    <div className="space-y-4">
      {/* Start-of-shift video gate. Mirrors the checkout panel: when
          time_events.video_status of the open clock_in is "pending",
          we surface an upload affordance until the worker submits a
          clip and /api/worker/link-checkin-video flips it to "uploaded". */}
      {shell.clockState.pendingStartVideoEventId ? (
        <section
          className="surface-card p-4"
          style={{
            background: "rgba(15, 168, 120, 0.06)",
            borderColor: "rgba(15, 168, 120, 0.24)",
          }}
        >
          <p
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: "var(--green)" }}
          >
            {t("journal.startVideo")}
          </p>
          <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
            {t("journal.startVideoTitle")}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t("journal.startVideoBody")}{" "}
            {shell.clockState.pendingStartVideoProjectName ?? ""}.
          </p>

          <input
            ref={startInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={(event) => replaceStartFiles(event.target.files)}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => startInputRef.current?.click()}
            className="upload-dropzone mt-4 w-full p-4 text-left"
          >
            <div className="flex items-start gap-3">
              <div className="upload-dropzone-icon rounded-[var(--radius-md)] bg-[rgba(15,168,120,0.12)] p-2 text-[var(--green)]">
                <FileVideo2 size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("journal.attachStart")}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {t("journal.pickClip")}
                </div>
              </div>
            </div>
          </button>

          {startFiles.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {startFiles.map((file) => (
                <div key={file.id} className="media-thumb">
                  {file.kind === "video" && file.previewUrl ? (
                    <video src={file.previewUrl} muted playsInline />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                      <FileVideo2 size={20} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeStartFile(file.id)}
                    className="button-base button-danger-ghost absolute right-2 top-2 min-h-0 px-2 py-2"
                    aria-label={`Remove ${file.file.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <TextInputWithVoice
            multiline
            value={startCaption}
            onChange={(event) => setStartCaption(event.target.value)}
            placeholder={t("journal.startVideoNotePlaceholder")}
            className="mt-4 min-h-[88px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (startFiles.length > 0) {
                void uploadMedia(
                  startFiles.map((file) => file.file),
                  startCaption,
                  "before_work",
                );
              }
            }}
            disabled={startFiles.length === 0 || busyAction === "before-work-video"}
            className="button-base button-primary mt-4 w-full"
          >
            {busyAction === "before-work-video"
              ? t("journal.uploadingVideo")
              : t("journal.uploadStartVideo")}
          </button>
        </section>
      ) : null}

      {shell.clockState.pendingCheckoutEventId && shell.profile.require_video ? (
        <section className="surface-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("journal.checkoutVideo")}
          </p>
          <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
            {t("journal.finishProof")}
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t("journal.recordVideo")} {shell.clockState.pendingCheckoutProjectName}.
          </p>

          <input
            ref={checkoutInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={(event) => replaceCheckoutFiles(event.target.files)}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => checkoutInputRef.current?.click()}
            className="upload-dropzone mt-4 w-full p-4 text-left"
          >
            <div className="flex items-start gap-3">
              <div className="upload-dropzone-icon rounded-[var(--radius-md)] bg-[rgba(74,127,191,0.12)] p-2 text-[var(--blue)]">
                <FileVideo2 size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("journal.attachCheckout")}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {t("journal.pickClip")}
                </div>
              </div>
            </div>
          </button>

          {checkoutFiles.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3">
              {checkoutFiles.map((file) => (
                <div key={file.id} className="media-thumb">
                  {file.kind === "video" && file.previewUrl ? (
                    <video src={file.previewUrl} muted playsInline />
                  ) : (
                    <div className="flex aspect-square items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                      <FileVideo2 size={20} />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeCheckoutFile(file.id)}
                    className="button-base button-danger-ghost absolute right-2 top-2 min-h-0 px-2 py-2"
                    aria-label={`Remove ${file.file.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <TextInputWithVoice
            multiline
            value={checkoutCaption}
            onChange={(event) => setCheckoutCaption(event.target.value)}
            placeholder={t("journal.whatChanged")}
            className="mt-4 min-h-[100px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={() => {
              if (checkoutFiles.length > 0) {
                void uploadMedia(
                  checkoutFiles.map((file) => file.file),
                  checkoutCaption,
                  "checkout",
                );
              }
            }}
            disabled={checkoutFiles.length === 0 || busyAction === "checkout-video"}
            className="button-base button-primary mt-4 w-full"
          >
            {busyAction === "checkout-video" ? t("journal.uploadingVideo") : t("journal.uploadCheckoutVideo")}
          </button>
        </section>
      ) : null}

      <section className="surface-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("journal.fieldJournal")}
        </p>
        <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
          {t("journal.captureDay")}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {shell.clockState.isClockedIn && shell.clockState.currentProjectName
            ? `${t("journal.entriesLandUnder")} ${shell.clockState.currentProjectName}.`
            : t("journal.clockInFirst")}
        </p>

        <input
          ref={journalInputRef}
          type="file"
          accept={ACCEPT_ALL_UPLOADS}
          multiple
          onChange={(event) => replaceJournalFiles(event.target.files)}
          disabled={!shell.clockState.isClockedIn}
          className="hidden"
        />
        <input
          ref={journalPhotoRef}
          type="file"
          accept={ACCEPT_IMAGE_UPLOADS}
          capture="environment"
          multiple
          onChange={(event) => replaceJournalFiles(event.target.files)}
          disabled={!shell.clockState.isClockedIn}
          className="hidden"
        />
        <input
          ref={journalVideoRef}
          type="file"
          accept={ACCEPT_VIDEO_UPLOADS}
          capture="environment"
          multiple
          onChange={(event) => replaceJournalFiles(event.target.files)}
          disabled={!shell.clockState.isClockedIn}
          className="hidden"
        />
        <input
          ref={journalPdfRef}
          type="file"
          accept={`${ACCEPT_PDF_UPLOADS},${ACCEPT_DOCUMENT_UPLOADS}`}
          multiple
          onChange={(event) => replaceJournalFiles(event.target.files)}
          disabled={!shell.clockState.isClockedIn}
          className="hidden"
        />

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => journalPhotoRef.current?.click()}
            disabled={!shell.clockState.isClockedIn}
            className="rounded-[var(--radius-md)] border px-3 py-4 text-center text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ borderColor: "rgba(191, 162, 52, 0.3)", color: "var(--brand-yellow)", background: "rgba(191, 162, 52, 0.08)" }}
          >
            <div className="text-2xl">📷</div>
            <div className="mt-1 text-xs">{t("journal.bigBtnPhoto")}</div>
          </button>
          <button
            type="button"
            onClick={() => journalVideoRef.current?.click()}
            disabled={!shell.clockState.isClockedIn}
            className="rounded-[var(--radius-md)] border px-3 py-4 text-center text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ borderColor: "rgba(74, 127, 191, 0.3)", color: "var(--blue)", background: "rgba(74, 127, 191, 0.08)" }}
          >
            <div className="text-2xl">🎬</div>
            <div className="mt-1 text-xs">{t("journal.bigBtnVideo")}</div>
          </button>
          <button
            type="button"
            onClick={() => journalPdfRef.current?.click()}
            disabled={!shell.clockState.isClockedIn}
            className="rounded-[var(--radius-md)] border px-3 py-4 text-center text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)", background: "rgba(212, 81, 94, 0.06)" }}
          >
            <div className="text-2xl">📄</div>
            <div className="mt-1 text-xs">{t("journal.bigBtnFiles")}</div>
          </button>
        </div>
        <div className="mt-1 text-[10px] text-[var(--text-muted)] text-center">
          {t("journal.snapProgress")}
        </div>

        {journalFiles.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {journalFiles.map((file) => (
              <div key={file.id} className="media-thumb">
                {file.kind === "image" && file.previewUrl ? (
                  <div className="relative aspect-square">
                    <Image
                      src={file.previewUrl}
                      alt={file.file.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                ) : file.kind === "video" && file.previewUrl ? (
                  <video src={file.previewUrl} muted playsInline />
                ) : (
                  <div className="flex aspect-square items-center justify-center bg-[var(--bg-primary)] text-[var(--text-secondary)]">
                    <UploadCloud size={20} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeJournalFile(file.id)}
                  className="button-base button-danger-ghost absolute right-2 top-2 min-h-0 px-2 py-2"
                  aria-label={`Remove ${file.file.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <TextInputWithVoice
          multiline
          value={journalCaption}
          onChange={(event) => setJournalCaption(event.target.value)}
          placeholder={t("journal.whatLookingAt")}
          disabled={!shell.clockState.isClockedIn}
          className="mt-4 min-h-[110px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        {saveStatus ? (
          <div
            role={saveStatus.kind === "err" ? "alert" : "status"}
            className="mt-3 rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
            style={{
              background:
                saveStatus.kind === "ok"
                  ? "rgba(15, 168, 120, 0.16)"
                  : "rgba(212, 81, 94, 0.12)",
              color: saveStatus.kind === "ok" ? "var(--green)" : "var(--red)",
            }}
          >
            {saveStatus.text}
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            // The button is disabled when journalFiles is empty, but
            // belt-and-suspenders: refuse explicitly with a visible
            // message rather than silently doing nothing on edge cases
            // (mid-render race, browser autosave restoring an old DOM).
            if (!shell.clockState.isClockedIn) {
              setSaveStatus({ kind: "err", text: t("journal.clockInFirst") });
              return;
            }
            if (journalFiles.length === 0) {
              setSaveStatus({ kind: "err", text: t("journal.attachFileFirst") });
              return;
            }
            setSaveStatus(null);
            void (async () => {
              const beforeCount = shell.media.length;
              try {
                await uploadMedia(
                  journalFiles.map((file) => file.file),
                  journalCaption,
                  "journal",
                );
                // uploadMedia surfaces its own banner on validation /
                // network errors and returns without throwing. Detect
                // a successful upload by whether the shell media list
                // grew, and fall back to "queued" otherwise.
                const grew = shell.media.length > beforeCount;
                if (grew || !window.navigator.onLine) {
                  setSaveStatus({
                    kind: "ok",
                    text: window.navigator.onLine
                      ? t("journal.saveSuccess")
                      : t("uploads.queued"),
                  });
                  // Clear local picker on success — uploadMedia leaves the
                  // file picker in place, which suggests the worker still
                  // has unsent files and is a confusing state.
                  revokePendingUploads(journalFiles);
                  setJournalFiles([]);
                  setJournalCaption("");
                  if (journalInputRef.current) journalInputRef.current.value = "";
                  if (journalPhotoRef.current) journalPhotoRef.current.value = "";
                  if (journalVideoRef.current) journalVideoRef.current.value = "";
                  if (journalPdfRef.current) journalPdfRef.current.value = "";
                } else {
                  setSaveStatus({ kind: "err", text: t("journal.saveFailedHint") });
                }
              } catch (err) {
                const message = err instanceof Error ? err.message : t("journal.saveFailedHint");
                setSaveStatus({ kind: "err", text: message });
              }
            })();
          }}
          disabled={
            !shell.clockState.isClockedIn ||
            journalFiles.length === 0 ||
            busyAction === "journal-upload"
          }
          className="button-base button-primary mt-4 w-full"
        >
          {busyAction === "journal-upload" ? t("journal.savingEntry") : t("journal.saveEntry")}
        </button>
      </section>

      <section className="surface-card surface-card--muted p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {t("journal.recentEntries")}
            </p>
            <h3 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
              {t("journal.latestUploads")}
            </h3>
          </div>
          <div className="text-xs text-[var(--text-muted)]">{shell.media.length} {t("common.total")}</div>
        </div>

        <div className="mt-4 space-y-5">
          {mediaOpenError ? (
            <div className="rounded-[var(--radius-md)] border border-[rgba(212,81,94,0.35)] bg-[rgba(212,81,94,0.08)] px-3 py-2 text-sm text-[var(--red)]">
              {mediaOpenError}
            </div>
          ) : null}
          {shell.media.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {t("journal.noMedia")}
            </div>
          ) : (
            groupMediaByDay(last7DaysMedia).map(({ key, label, items }) => (
              <div key={key}>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {label === "today" ? t("journal.todayLabel") : label === "yesterday" ? t("journal.yesterdayLabel") : key}
                </div>
                <div className="space-y-3">
                  {items.map((entry) => (
                    <div
                      key={entry.id}
                      className="surface-panel p-3"
                      style={{ background: "rgba(15, 17, 23, 0.84)" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[var(--text-primary)]">
                            {entry.filename ?? entry.media_type}
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {entry.projectName ?? t("journal.unlinkedProject")} • {formatDateTime(entry.created_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <MediaFlagButton
                            mediaId={entry.id}
                            hasOpenFlag={openFlagIds.has(entry.id)}
                            onClick={() => setFlagModalMediaId(entry.id)}
                          />
                          <div
                            className="status-pill"
                            data-tone={entry.is_checkout ? "neutral" : "warning"}
                          >
                            {entry.is_checkout ? t("journal.checkout") : entry.media_type}
                          </div>
                        </div>
                      </div>
                      {entry.caption ? (
                        <p className="mt-3 text-sm text-[var(--text-secondary)]">{entry.caption}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void openMediaItem(entry)}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
                        >
                          <ExternalLink size={11} />
                          {t("messages.openFile")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadMediaItem(entry)}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                        >
                          <Download size={11} />
                          {t("messages.downloadFile")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setFlagModalMediaId(entry.id)}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                          style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                        >
                          🚩 {t("flags.flagForReview")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <MediaFlagModal
        open={flagModalMediaId !== null}
        mediaId={flagModalMediaId}
        viewerRole="worker"
        viewerId={shell.profile.id}
        onClose={() => setFlagModalMediaId(null)}
        onMutate={() => void refreshOpenFlags()}
      />

      <MediaViewerModal
        item={
          viewerEntry
            ? {
                id: viewerEntry.id,
                storage_path: viewerEntry.storage_path,
                filename: viewerEntry.filename,
                mime_type: viewerEntry.mime_type,
                media_type: viewerEntry.media_type,
                caption: viewerEntry.caption,
                created_at: viewerEntry.created_at,
                metadata: viewerEntry.metadata as Record<string, unknown> | null,
                projectName: viewerEntry.projectName,
              }
            : null
        }
        onClose={() => setViewerEntry(null)}
      />
    </div>
  );
}

function groupMediaByDay<T extends { created_at: string }>(items: T[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = new Date(today.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const day = item.created_at.slice(0, 10);
    const bucket = buckets.get(day) ?? [];
    bucket.push(item);
    buckets.set(day, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({
      key,
      label: key === todayKey ? "today" : key === yesterdayKey ? "yesterday" : key,
      items: list,
    }));
}
