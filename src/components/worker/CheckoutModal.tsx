"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { useTranslation } from "@/lib/i18n";

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function CheckoutModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { shell, busyAction, clockOut, uploadMedia } = useWorkerShell();
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickedAt, setPickedAt] = useState<number | null>(null);

  // A "today's checkout video" is any media row marked is_checkout=true
  // for the current project, captured today.
  const hasVideoToday = useMemo(() => {
    const todayStart = startOfTodayMs();
    return shell.media.some((entry) => {
      if (!entry.is_checkout) return false;
      if (entry.project_id !== shell.clockState.currentProjectId) return false;
      return new Date(entry.created_at).getTime() >= todayStart;
    });
  }, [shell.media, shell.clockState.currentProjectId]);

  const requireVideo = shell.profile.require_video;
  const videoSatisfied = !requireVideo || hasVideoToday || pickedAt !== null;
  const uploading = busyAction === "before-leave-video";
  const checkingOut = busyAction === "clock-out";
  const disabled = !videoSatisfied || uploading || checkingOut;

  function handleClose() {
    setPickedAt(null);
    onClose();
  }

  useEffect(() => {
    if (!open) return;

    // ESC keeps the worker checked in — closes the modal without touching
    // sessions or media. Mirrors the Cancel button.
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    await uploadMedia(files, "", "before_leave");
    setPickedAt(Date.now());
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleCheckOut() {
    await clockOut();
    handleClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[460px] rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-5 sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {requireVideo ? t("clock.beforeYouLeave") : t("clock.confirmCheckout")}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {requireVideo ? t("clock.recordOrUpload") : t("clock.confirmCheckoutBody")}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("clock.cancelStayCheckedIn")}
            title={t("clock.cancelStayCheckedIn")}
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        {requireVideo ? (
          <div className="mt-4 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              capture="environment"
              onChange={(e) => void handlePick(e)}
              className="hidden"
              id="before-leave-file"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-semibold"
                style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
              >
                <Camera size={14} />
                {uploading ? t("clock.uploadingVideo") : t("clock.recordVideo")}
              </button>
            </div>
            <div
              className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
              style={{
                background: hasVideoToday || pickedAt !== null
                  ? "rgba(15, 168, 120, 0.16)"
                  : "rgba(212, 81, 94, 0.12)",
                color: hasVideoToday || pickedAt !== null ? "var(--green)" : "var(--red)",
              }}
            >
              {hasVideoToday || pickedAt !== null ? (
                <span className="inline-flex items-center gap-1.5">
                  <Check size={12} />
                  {t("clock.videoCaptured")}
                </span>
              ) : (
                t("clock.videoMissing")
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleClose}
            disabled={checkingOut}
            data-testid="checkout-cancel"
            className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
          >
            {t("clock.cancelStayCheckedIn")}
          </button>
          <button
            type="button"
            onClick={() => void handleCheckOut()}
            disabled={disabled}
            className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold"
            style={{
              background: disabled ? "var(--border-default)" : "var(--red)",
              color: disabled ? "var(--text-muted)" : "white",
            }}
          >
            {checkingOut ? t("clock.closingShift") : t("clock.confirmCheckoutCta")}
          </button>
        </div>
      </div>
    </div>
  );
}
