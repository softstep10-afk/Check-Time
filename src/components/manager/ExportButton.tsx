"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

export function ExportButton({
  format,
  periodEnd,
}: {
  format: "pdf" | "csv";
  periodEnd: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/payroll/export?format=${format}&periodEnd=${encodeURIComponent(periodEnd)}`,
      );

      if (!res.ok) {
        const text = await res.text();
        alert(`${t("export.failed")}: ${text}`);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        format === "pdf"
          ? `payroll-${periodEnd}.pdf`
          : `payroll-${periodEnd}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`${t("export.failed")}: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  }

  const Icon = format === "pdf" ? FileText : Download;
  const label = format === "pdf" ? t("export.pdf") : t("export.csv");

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--brand-yellow)] px-3 py-2.5 text-sm font-semibold text-[var(--brand-yellow)] transition-opacity hover:opacity-80 disabled:opacity-50"
      style={{ background: "transparent" }}
    >
      <Icon size={15} strokeWidth={1.8} />
      {busy ? t("export.exporting") : label}
    </button>
  );
}
