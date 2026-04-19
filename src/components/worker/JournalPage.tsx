"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { FileVideo2, ImagePlus, Trash2, UploadCloud } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { formatDateTime } from "@/lib/worker-utils";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";

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
  const checkoutInputRef = useRef<HTMLInputElement | null>(null);
  const [journalFiles, setJournalFiles] = useState<PendingUpload[]>([]);
  const [checkoutFiles, setCheckoutFiles] = useState<PendingUpload[]>([]);
  const [journalCaption, setJournalCaption] = useState("");
  const [checkoutCaption, setCheckoutCaption] = useState("");

  useEffect(() => {
    return () => {
      revokePendingUploads(journalFiles);
      revokePendingUploads(checkoutFiles);
    };
  }, [checkoutFiles, journalFiles]);

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
      {shell.clockState.pendingCheckoutEventId ? (
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
          accept="image/*,video/*"
          capture="environment"
          multiple
          onChange={(event) => replaceJournalFiles(event.target.files)}
          disabled={!shell.clockState.isClockedIn}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => journalInputRef.current?.click()}
          disabled={!shell.clockState.isClockedIn}
          className="upload-dropzone mt-4 w-full p-4 text-left disabled:opacity-60"
        >
          <div className="flex items-start gap-3">
            <div className="upload-dropzone-icon rounded-[var(--radius-md)] bg-[rgba(191,162,52,0.12)] p-2 text-[var(--brand-yellow)]">
              <ImagePlus size={18} />
            </div>
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {t("journal.addPhotoVideo")}
              </div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {t("journal.snapProgress")}
              </div>
            </div>
          </div>
        </button>

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
        <button
          type="button"
          onClick={() => {
            if (journalFiles.length > 0) {
              void uploadMedia(
                journalFiles.map((file) => file.file),
                journalCaption,
                "journal",
              );
            }
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
          {shell.media.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {t("journal.noMedia")}
            </div>
          ) : (
            groupMediaByDay(shell.media).map(({ key, label, items }) => (
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
                        <div
                          className="status-pill"
                          data-tone={entry.is_checkout ? "neutral" : "warning"}
                        >
                          {entry.is_checkout ? t("journal.checkout") : entry.media_type}
                        </div>
                      </div>
                      {entry.caption ? (
                        <p className="mt-3 text-sm text-[var(--text-secondary)]">{entry.caption}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
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
