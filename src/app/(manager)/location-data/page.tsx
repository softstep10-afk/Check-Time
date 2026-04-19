"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { Profile } from "@/types/database";

export default function LocationDataPage() {
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [purgeText, setPurgeText] = useState("");
  const [showPurge, setShowPurge] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  // Mock stats for preview mode
  const [stats] = useState({
    totalRows: 12_847,
    oldestDate: "2026-01-15",
    estimatedSizeMb: 3.2,
  });

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .is("deleted_at", null)
        .order("name");
      setProfiles((data as Profile[]) ?? []);
      setLoading(false);
    }
    void load();
  }, [supabase]);

  function handleExport() {
    // In production: fetch from worker_live_locations with filters, generate CSV
    const csv = "worker_id,lat,lng,accuracy,heading,speed,recorded_at\n(preview data)";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `location-data-${selectedWorker || "all"}-${dateFrom || "start"}-${dateTo || "end"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handlePurge() {
    if (purgeText !== "PURGE") return;
    setBusy(true);
    // In production: DELETE from worker_live_locations WHERE worker_id = X AND recorded_at < Y
    // Plus audit log insert
    await new Promise((r) => setTimeout(r, 500));
    setBusy(false);
    setShowPurge(false);
    setPurgeText("");
    setMessage(t("gps.purgeSuccess"));
    setTimeout(() => setMessage(""), 3000);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("gps.adminTitle")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("gps.adminTitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("gps.adminDescription")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
        >
          {message}
        </div>
      ) : null}

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("gps.totalRows")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{stats.totalRows.toLocaleString()}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("gps.oldestRecord")}</div>
          <div className="mt-2 text-base font-bold text-[var(--text-primary)]">{stats.oldestDate}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Storage</div>
          <div className="mt-2 text-base font-bold text-[var(--text-primary)]">{stats.estimatedSizeMb} MB</div>
        </div>
      </section>

      {/* Filters + Actions */}
      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("gps.filterWorker")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <select
            value={selectedWorker}
            onChange={(e) => setSelectedWorker(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{loading ? t("common.loading") : t("timeline.allWorkers")}</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
            style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
          >
            <Download size={15} />
            {t("gps.exportCsv")}
          </button>
        </div>
      </section>

      {/* Purge (owner only) */}
      <section
        className="rounded-[var(--radius-lg)] border p-4"
        style={{ borderColor: "rgba(212, 81, 94, 0.3)", background: "var(--bg-card)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold" style={{ color: "var(--red)" }}>{t("gps.purge")}</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("gps.ownerOnly")}</p>
          </div>
          {!showPurge ? (
            <button
              type="button"
              onClick={() => setShowPurge(true)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
            >
              <Trash2 size={14} />
              {t("gps.purge")}
            </button>
          ) : null}
        </div>

        {showPurge ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-[var(--text-secondary)]">
              {t("gps.purgeConfirm")}
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={purgeText}
                onChange={(e) => setPurgeText(e.target.value)}
                placeholder="PURGE"
                className="w-32 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                onClick={() => void handlePurge()}
                disabled={purgeText !== "PURGE" || busy}
                className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold"
                style={{
                  background: purgeText === "PURGE" ? "var(--red)" : "var(--border-default)",
                  color: purgeText === "PURGE" ? "white" : "var(--text-muted)",
                }}
              >
                {busy ? "..." : t("gps.purge")}
              </button>
              <button
                type="button"
                onClick={() => { setShowPurge(false); setPurgeText(""); }}
                className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
