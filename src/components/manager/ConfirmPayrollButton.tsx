"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/lib/i18n";

export function ConfirmPayrollButton({
  periodEnd,
}: {
  periodEnd: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handleConfirm() {
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/payroll/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ periodEnd }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("payroll.runFailed"));
      setBusy(false);
      return;
    }

    setBusy(false);
    setMessage(t("payroll.confirmed"));
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => void handleConfirm()}
        disabled={busy}
        className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
        style={{
          background: busy ? "var(--border-default)" : "var(--brand-yellow)",
          color: busy ? "var(--text-muted)" : "var(--text-inverse)",
        }}
      >
        {busy ? t("payroll.confirming") : t("payroll.confirmPayroll")}
      </button>
      {message ? <div className="text-sm text-[var(--brand-yellow)]">{message}</div> : null}
    </div>
  );
}
