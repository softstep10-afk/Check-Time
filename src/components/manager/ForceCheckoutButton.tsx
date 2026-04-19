"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { logAudit } from "@/lib/audit";
import { closeOpenStoreVisits } from "@/lib/store-visits";

function localDatetimeValue(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ForceCheckoutButton({
  orgId,
  managerId,
  profileId,
  projectId,
  workerName,
  projectName,
}: {
  orgId: string;
  managerId: string;
  profileId: string;
  projectId: string;
  workerName: string;
  projectName: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"success" | "error" | null>(null);
  const [checkoutTime, setCheckoutTime] = useState(localDatetimeValue);
  const [reason, setReason] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setResult(null);

    const timestamp = new Date(checkoutTime).toISOString();

    const { error } = await supabase.from("time_events").insert({
      org_id: orgId,
      profile_id: profileId,
      project_id: projectId,
      event_type: "auto_out" as const,
      event_time: timestamp,
      gps_point: null,
      gps_accuracy_m: null,
      gps_source: null,
      video_status: "not_required" as const,
      metadata: {
        forced_by: managerId,
        force_checkout: true,
        reason: reason.trim() || null,
        forced_at: new Date().toISOString(),
      },
    });

    if (error) {
      setBusy(false);
      setResult("error");
      return;
    }

    await supabase
      .from("profiles")
      .update({ current_project: null })
      .eq("id", profileId);

    // Close any open store_visit row for this worker so the auto-detection
    // state machine doesn't treat them as still in a store after the manager
    // ends their shift.
    await closeOpenStoreVisits(supabase, profileId, timestamp);

    // Send notification message to worker
    const notifyText = reason.trim()
      ? `${t("overview.forceCheckoutNotify")} — ${reason.trim()}`
      : t("overview.forceCheckoutNotify");

    if (!AUTH_BYPASS_ENABLED) {
      await supabase.from("messages").insert({
        org_id: orgId,
        sender_id: managerId,
        recipient_id: profileId,
        text: notifyText,
        color: "#ef4444",
        metadata: { kind: "force_checkout_notice" },
      });
    }

    // Audit log
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: "Manager",
      actorRole: "manager",
      action: "force_checkout",
      targetType: "profile",
      targetId: profileId,
      beforeData: { project_id: projectId, worker: workerName },
      afterData: { event_time: timestamp, reason: reason.trim() || null },
    });

    setBusy(false);
    setOpen(false);
    setResult("success");
    router.refresh();
  }

  if (result === "success") {
    return (
      <span className="text-xs font-semibold" style={{ color: "var(--green)" }}>
        {t("overview.forceCheckoutSuccess")}
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setCheckoutTime(localDatetimeValue());
          setReason("");
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
        style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
        title={t("overview.forceCheckout")}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        {t("overview.forceCheckout")}
      </button>
    );
  }

  return (
    <div
      className="space-y-2 rounded-[var(--radius-md)] border p-3"
      style={{
        borderColor: "rgba(212, 81, 94, 0.25)",
        background: "rgba(212, 81, 94, 0.06)",
      }}
    >
      <div className="text-xs font-semibold" style={{ color: "var(--red)" }}>
        {t("overview.forceCheckoutConfirm")
          .replace("{name}", workerName)
          .replace("{project}", projectName)}
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {t("overview.forceCheckoutTime")}
        </span>
        <input
          type="datetime-local"
          value={checkoutTime}
          onChange={(e) => setCheckoutTime(e.target.value)}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {t("overview.forceCheckoutReason")}
        </span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("overview.forceCheckoutReason")}
          className="w-full rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none"
        />
      </label>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void handleConfirm()}
          disabled={busy}
          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[10px] font-semibold"
          style={{ background: "var(--red)", color: "white" }}
        >
          {busy ? "..." : t("overview.forceCheckout")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-[10px] font-semibold"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
        >
          {t("common.cancel")}
        </button>
      </div>

      {result === "error" ? (
        <div className="text-[10px] font-semibold" style={{ color: "var(--red)" }}>
          {t("common.errorTryAgain")}
        </div>
      ) : null}
    </div>
  );
}
