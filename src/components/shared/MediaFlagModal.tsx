"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Flag, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime } from "@/lib/worker-utils";
import {
  fetchMediaFlagsAnon,
  fetchMediaFlagsFull,
  insertMediaFlag,
  reviewMediaFlag,
  type MediaFlagFull,
  type MediaFlagPublic,
} from "@/lib/media-flags";

export interface MediaFlagButtonProps {
  mediaId: string;
  hasOpenFlag: boolean;
  onClick: () => void;
}

/**
 * Small 🚩 indicator on a media card. Visible only when at least one
 * unreviewed flag exists for the media; click opens the modal.
 */
export function MediaFlagButton({ mediaId: _mediaId, hasOpenFlag, onClick }: MediaFlagButtonProps) {
  void _mediaId;
  const { t } = useTranslation();
  if (!hasOpenFlag) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={t("flags.openFlags")}
      aria-label={t("flags.openFlags")}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full"
      style={{ background: "rgba(212, 81, 94, 0.18)", color: "var(--red)" }}
    >
      <Flag size={12} />
    </button>
  );
}

export interface MediaFlagModalProps {
  open: boolean;
  mediaId: string | null;
  /** Manager-tier viewer sees author column + Reviewed action. */
  viewerRole: "worker" | "manager";
  /** Auth.uid() of the current viewer; used as flagged_by / reviewed_by. */
  viewerId: string;
  onClose: () => void;
  /** Called after a successful add or review so parents can refresh
   * their open-flag set if they care. */
  onMutate?: () => void;
}

export function MediaFlagModal({
  open,
  mediaId,
  viewerRole,
  viewerId,
  onClose,
  onMutate,
}: MediaFlagModalProps) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [flags, setFlags] = useState<MediaFlagFull[] | MediaFlagPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    if (!open || !mediaId) return;

    let cancelled = false;
    // Reset-then-load is the canonical fetch-on-open pattern. The
    // resets happen once per modal open (open + mediaId both change
    // together), not on every render — react-hooks/set-state-in-effect
    // fires here but is the wrong fit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setTableMissing(false);
    setNote("");

    void (async () => {
      const data =
        viewerRole === "manager"
          ? await fetchMediaFlagsFull(supabase, mediaId)
          : await fetchMediaFlagsAnon(supabase, mediaId);
      if (!cancelled) {
        setFlags(data);
        setLoading(false);
      }
    })();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, mediaId, supabase, viewerRole, onClose]);

  if (!open || !mediaId) return null;

  async function handleSubmit() {
    if (!mediaId || !note.trim()) return;
    setSubmitting(true);
    setError(null);

    const result = await insertMediaFlag(supabase, {
      mediaId,
      flaggedBy: viewerId,
      note: note.trim(),
    });

    setSubmitting(false);

    if (!result.ok) {
      if (result.missingTable) setTableMissing(true);
      else setError(result.message ?? t("flags.saveFailed"));
      return;
    }

    setNote("");
    // Refresh in viewer-appropriate shape so the new note picks up the
    // author column for managers.
    const refreshed =
      viewerRole === "manager"
        ? await fetchMediaFlagsFull(supabase, mediaId)
        : await fetchMediaFlagsAnon(supabase, mediaId);
    setFlags(refreshed);
    onMutate?.();
  }

  async function handleReview(flagId: string) {
    if (!mediaId) return;
    setReviewBusyId(flagId);
    setError(null);

    const result = await reviewMediaFlag(supabase, {
      flagId,
      reviewedBy: viewerId,
    });

    setReviewBusyId(null);

    if (!result.ok) {
      if (result.missingTable) setTableMissing(true);
      else setError(result.message ?? t("flags.reviewFailed"));
      return;
    }

    setFlags((prev) =>
      prev.map((flag) =>
        flag.id === flagId
          ? {
              ...flag,
              reviewedAt: new Date().toISOString(),
              isReviewed: true,
            }
          : flag,
      ) as typeof prev,
    );
    onMutate?.();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-[480px] overflow-hidden rounded-t-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] sm:rounded-[var(--radius-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-default)] p-4">
          <div className="flex items-center gap-2">
            <Flag size={16} style={{ color: "var(--red)" }} />
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("flags.modalTitle")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-2 inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="max-h-[calc(85vh-200px)] space-y-2 overflow-y-auto p-4"
          style={{ scrollbarWidth: "thin" }}
        >
          {tableMissing ? (
            <div
              className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
              style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
            >
              {t("flags.tableMissing")}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("common.loading")}
            </div>
          ) : flags.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("flags.modalEmpty")}
            </div>
          ) : (
            flags.map((flag) => {
              const fullFlag = flag as MediaFlagFull;
              const isManagerView = viewerRole === "manager";
              const reviewing = reviewBusyId === flag.id;
              return (
                <div
                  key={flag.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  style={{
                    background: flag.isReviewed
                      ? "rgba(15, 168, 120, 0.06)"
                      : "var(--bg-primary)",
                    borderColor: flag.isReviewed
                      ? "rgba(15, 168, 120, 0.3)"
                      : "var(--border-default)",
                  }}
                >
                  <div className="text-sm text-[var(--text-primary)]">{flag.note}</div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[var(--text-muted)]">
                    <span className="font-mono">{formatDateTime(flag.flaggedAt)}</span>
                    {isManagerView && fullFlag.flaggedByName ? (
                      <span>
                        {t("flags.flaggedBy")}:{" "}
                        <span className="font-semibold text-[var(--text-secondary)]">
                          {fullFlag.flaggedByName}
                        </span>
                      </span>
                    ) : null}
                    {flag.isReviewed ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                        style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                      >
                        <Check size={10} /> {t("flags.reviewed")}
                      </span>
                    ) : isManagerView ? (
                      <button
                        type="button"
                        onClick={() => void handleReview(flag.id)}
                        disabled={reviewing || tableMissing}
                        className="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                        style={{
                          borderColor: "rgba(15, 168, 120, 0.3)",
                          color: "var(--green)",
                        }}
                      >
                        ✅ {t("flags.markReviewed")}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-2 border-t border-[var(--border-default)] p-4">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("flags.notePlaceholder")}
            disabled={submitting || tableMissing}
            rows={2}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-50"
          />
          {error ? (
            <div className="text-xs font-semibold" style={{ color: "var(--red)" }}>
              {error}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !note.trim() || tableMissing}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "var(--red)", color: "white" }}
          >
            <Flag size={13} />
            {submitting ? t("flags.submitting") : t("flags.flagForReview")}
          </button>
        </div>
      </div>
    </div>
  );
}
