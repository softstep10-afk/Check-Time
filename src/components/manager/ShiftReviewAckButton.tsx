"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { ShiftReviewStatus } from "@/lib/shift-review";

export function ShiftReviewAckButton({
  eventId,
  managerId,
  status,
}: {
  eventId: string;
  managerId: string;
  status: ShiftReviewStatus;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleClick() {
    setBusy(true);
    setError("");
    const { data, error: readError } = await supabase
      .from("time_events")
      .select("org_id, profile_id, project_id")
      .eq("id", eventId)
      .single<{ org_id: string; profile_id: string; project_id: string }>();

    if (readError) {
      setBusy(false);
      setError(readError.message);
      return;
    }

    const { error: insertError } = await supabase
      .from("time_events")
      .insert({
        org_id: data.org_id,
        profile_id: data.profile_id,
        project_id: data.project_id,
        event_type: "adjust",
        event_time: new Date().toISOString(),
        notes: "Shift review acknowledged",
        metadata: {
          shift_review_ack: {
            status,
            reviewed_event_id: eventId,
            reviewed_at: new Date().toISOString(),
            reviewed_by: managerId,
          },
        },
      });

    setBusy(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
        style={{ borderColor: "rgba(15, 168, 120, 0.34)", color: "var(--green)" }}
      >
        <CheckCircle2 size={13} />
        {busy ? t("common.saving") : t("shiftReview.markReviewed")}
      </button>
      {error ? (
        <span className="max-w-[240px] text-right text-[10px] text-[var(--red)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
