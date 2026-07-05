"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { DateField } from "@/components/shared/DateField";
import {
  PROFILE_SELECT_WITHOUT_RATE,
  profilesWithoutRates,
  type ProfileWithoutRate,
} from "@/lib/profile-rates";
import type { Profile } from "@/types/database";

type MileageProfile = Pick<Profile, "id" | "name" | "role">;

type MileageSummary = {
  profile: MileageProfile;
  miles: number;
  pings: number;
  firstSeen: string | null;
  lastSeen: string | null;
};

type MileageData = {
  summaries: MileageSummary[];
  totalMiles: number;
  totalRows: number;
  oldestRecord: string | null;
  estimatedSizeMb: number;
};

const TRACKED_MILEAGE_ROLES = new Set(["driver", "manager", "admin", "owner"]);

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultMonthStart(): string {
  const date = new Date();
  return toDateInput(new Date(date.getFullYear(), date.getMonth(), 1));
}

function defaultToday(): string {
  return toDateInput(new Date());
}

function roleLabel(role: string, locale: string): string {
  const ru: Record<string, string> = {
    owner: "Владелец",
    admin: "Админ",
    manager: "Менеджер",
    driver: "Водитель",
  };
  const en: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    driver: "Driver",
  };
  return (locale === "ru" ? ru : en)[role] ?? role;
}

function formatDateTime(value: string | null, locale: string): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    hourCycle: "h23",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function emptyMileageData(): MileageData {
  return {
    summaries: [],
    totalMiles: 0,
    totalRows: 0,
    oldestRecord: null,
    estimatedSizeMb: 0.01,
  };
}

export default function LocationDataPage() {
  const supabase = useMemo(() => createClient(), []);
  const { t, locale } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPoints, setLoadingPoints] = useState(true);
  const [mileageData, setMileageData] = useState<MileageData>(() => emptyMileageData());
  const [selectedWorker, setSelectedWorker] = useState("");
  const [dateFrom, setDateFrom] = useState(defaultMonthStart);
  const [dateTo, setDateTo] = useState(defaultToday);
  const [purgeText, setPurgeText] = useState("");
  const [showPurge, setShowPurge] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITHOUT_RATE)
        .is("deleted_at", null)
        .order("name")
        .returns<ProfileWithoutRate[]>();
      setProfiles(profilesWithoutRates(data ?? []));
      setLoading(false);
    }
    void load();
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;

    async function loadPoints() {
      setLoadingPoints(true);
      try {
        const params = new URLSearchParams();
        if (selectedWorker) {
          params.set("workerId", selectedWorker);
        }
        if (dateFrom) {
          params.set("from", dateFrom);
        }
        if (dateTo) {
          params.set("to", dateTo);
        }

        const response = await fetch(`/api/location-data/mileage?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as MileageData | { error: string } | null;
        if (cancelled) return;
        if (!response.ok || !payload || "error" in payload) {
          setMessage((payload && "error" in payload && payload.error) || "Could not load mileage data.");
          setMileageData(emptyMileageData());
        } else {
          setMileageData(payload);
        }
      } catch {
        if (cancelled) return;
        setMessage("Could not load mileage data.");
        setMileageData(emptyMileageData());
      }
      setLoadingPoints(false);
    }

    void loadPoints();

    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, selectedWorker, supabase]);

  const mileageProfiles = useMemo(
    () => profiles.filter((profile) => TRACKED_MILEAGE_ROLES.has(profile.role)),
    [profiles],
  );

  const mileageSummaries = mileageData.summaries;
  const totalMiles = mileageData.totalMiles;
  const oldestDate = mileageData.oldestRecord?.slice(0, 10) ?? "—";
  const estimatedSizeMb = mileageData.estimatedSizeMb;

  function handleExport() {
    const header = [
      "worker_id",
      "worker_name",
      "role",
      "miles",
      "gps_pings",
      "first_ping",
      "last_ping",
      "date_from",
      "date_to",
    ];
    const rows = mileageSummaries.map((summary) => [
      summary.profile.id,
      summary.profile.name,
      summary.profile.role,
      summary.miles.toFixed(2),
      String(summary.pings),
      summary.firstSeen ?? "",
      summary.lastSeen ?? "",
      dateFrom,
      dateTo,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mileage-${selectedWorker || "drivers-managers"}-${dateFrom || "start"}-${dateTo || "end"}.csv`;
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

      <section className="surface-card p-4">
        <p className="text-sm leading-6 text-[var(--text-secondary)]">
          {t("gps.mileageDescription")}
        </p>
      </section>

      {/* Stats */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("gps.totalMiles")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{totalMiles.toFixed(1)}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("gps.totalRows")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{mileageData.totalRows.toLocaleString("en-US")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("gps.oldestRecord")}</div>
          <div className="mt-2 text-base font-bold text-[var(--text-primary)]">{oldestDate}</div>
          <div className="mt-1 text-xs text-[var(--text-muted)]">~{estimatedSizeMb.toFixed(2)} MB</div>
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
            <option value="">{loading ? t("common.loading") : t("gps.allMileageRoles")}</option>
            {mileageProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {roleLabel(p.role, locale)}
              </option>
            ))}
          </select>
          <DateField
            label={t("common.from")}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <DateField
            label={t("common.to")}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <button
            type="button"
            onClick={handleExport}
            disabled={loadingPoints}
            className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
            style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
          >
            <Download size={15} />
            {t("gps.exportCsv")}
          </button>
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] px-4 py-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("gps.mileageReport")}</h2>
          <span className="text-xs text-[var(--text-muted)]">
            {loadingPoints ? t("common.loading") : `${mileageSummaries.length} ${t("gps.peopleTracked")}`}
          </span>
        </div>
        {mileageSummaries.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--text-secondary)]">
            {loadingPoints ? t("common.loading") : t("gps.noMileageRows")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <tr>
                  <th className="px-4 py-3">{t("gps.person")}</th>
                  <th className="px-4 py-3">{t("gps.role")}</th>
                  <th className="px-4 py-3">{t("gps.miles")}</th>
                  <th className="px-4 py-3">{t("gps.totalRows")}</th>
                  <th className="px-4 py-3">{t("gps.firstPing")}</th>
                  <th className="px-4 py-3">{t("gps.lastPing")}</th>
                </tr>
              </thead>
              <tbody>
                {mileageSummaries.map((summary) => (
                  <tr key={summary.profile.id} className="border-t border-[var(--border-subtle)]">
                    <td className="px-4 py-3 font-semibold text-[var(--text-primary)]">
                      {summary.profile.name}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {roleLabel(summary.profile.role, locale)}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-[var(--brand-yellow)]">
                      {summary.miles.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[var(--text-secondary)]">
                      {summary.pings.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {formatDateTime(summary.firstSeen, locale)}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">
                      {formatDateTime(summary.lastSeen, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
