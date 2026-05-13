"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, Bot, MapPin, ScrollText, ShieldCheck, Sliders, Users, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import type { UserRole } from "@/types/database";

const DEFAULT_RADIUS = 75;
const MIN_RADIUS = 50;
const MAX_RADIUS = 150;

export function AdminSettingsPage({
  managerId,
  managerRole,
  ownerProfiles,
}: {
  managerId: string;
  managerRole: string;
  ownerProfiles: Array<{
    id: string;
    name: string;
    role: UserRole;
    isActive: boolean;
  }>;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [radius, setRadius] = useState<number>(DEFAULT_RADIUS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [tableMissing, setTableMissing] = useState(false);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from("app_settings")
        .select("settings")
        .eq("id", 1)
        .maybeSingle<{ settings: Record<string, unknown> }>();

      if (error) {
        // 42P01 = undefined_table — migration 00005 hasn't been run yet.
        if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
          setTableMissing(true);
        } else {
          setMessage(error.message);
          setMessageTone("error");
        }
        setLoading(false);
        return;
      }

      const stored = Number(data?.settings?.geofence_radius_meters);
      if (Number.isFinite(stored) && stored >= MIN_RADIUS && stored <= MAX_RADIUS) {
        setRadius(stored);
      }
      setLoading(false);
    }
    void load();
  }, [supabase]);

  async function handleSave() {
    setSaving(true);
    setMessage("");

    const payload = {
      id: 1,
      settings: { geofence_radius_meters: radius },
      updated_at: new Date().toISOString(),
      updated_by: managerId,
    };

    const { error } = await supabase
      .from("app_settings")
      .upsert(payload, { onConflict: "id" });

    setSaving(false);
    if (error) {
      if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
        setTableMissing(true);
      } else {
        setMessage(error.message);
        setMessageTone("error");
      }
      return;
    }

    setMessage(t("admin.settings.saved"));
    setMessageTone("success");
    setTimeout(() => setMessage(""), 2500);
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("admin.settings.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("admin.settings.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("admin.settings.description")}
        </p>
        <span
          className="inline-block rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {t("owner.only")} · {managerRole}
        </span>
      </section>

      {tableMissing ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
        >
          {t("admin.settings.tableMissing")}
        </div>
      ) : null}

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background: messageTone === "error" ? "rgba(212, 81, 94, 0.12)" : "rgba(15, 168, 120, 0.16)",
            color: messageTone === "error" ? "var(--red)" : "var(--green)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-[var(--text-primary)]">
              {t("admin.settings.ownerAccounts")}
            </div>
            <p className="mt-1 max-w-[62ch] text-xs leading-5 text-[var(--text-secondary)]">
              {t("admin.settings.ownerAccountsHelp")}
            </p>
          </div>
          <Link href="/managers" className="button-base button-secondary px-3 py-2 text-xs">
            {t("admin.settings.manageAdmins")}
          </Link>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {ownerProfiles.map((profile) => (
            <Link
              key={profile.id}
              href={`/team/${profile.id}`}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{profile.name}</div>
                  <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {profile.role}
                  </div>
                </div>
                <span
                  className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase"
                  style={{
                    background: profile.isActive ? "rgba(15, 168, 120, 0.14)" : "rgba(107, 114, 128, 0.14)",
                    color: profile.isActive ? "var(--green)" : "var(--text-muted)",
                  }}
                >
                  {profile.isActive ? t("common.active") : t("common.inactive")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(96, 165, 250, 0.12)" }}
          >
            <ShieldCheck size={18} style={{ color: "var(--blue)" }} />
          </span>
          <div>
            <div className="text-base font-semibold text-[var(--text-primary)]">
              {t("admin.settings.accessHub")}
            </div>
            <p className="mt-1 max-w-[62ch] text-xs leading-5 text-[var(--text-secondary)]">
              {t("admin.settings.accessHubHelp")}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[
            { href: "/team", icon: Users, label: t("admin.settings.rolesAndTeam"), desc: t("admin.settings.rolesAndTeamDesc") },
            { href: "/payroll", icon: Wallet, label: t("admin.settings.financeAccess"), desc: t("admin.settings.financeAccessDesc") },
            { href: "/admin/audit", icon: ScrollText, label: t("admin.settings.auditLog"), desc: t("admin.settings.auditLogDesc") },
            { href: "/archive", icon: Archive, label: t("admin.settings.archive"), desc: t("admin.settings.archiveDesc") },
            { href: "/ai", icon: Bot, label: t("admin.settings.aiAccess"), desc: t("admin.settings.aiAccessDesc") },
            { href: "/location-data", icon: MapPin, label: t("admin.settings.locationData"), desc: t("admin.settings.locationDataDesc") },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
            >
              <div className="flex items-start gap-2">
                <item.icon size={16} className="mt-0.5 shrink-0 text-[var(--brand-yellow)]" />
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</div>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{item.desc}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex items-start gap-3">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(191, 162, 52, 0.12)" }}
          >
            <Sliders size={18} style={{ color: "var(--brand-yellow)" }} />
          </span>
          <div className="flex-1 space-y-1">
            <div className="text-base font-semibold text-[var(--text-primary)]">
              {t("admin.settings.geofenceRadius")}
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {t("admin.settings.geofenceHelp")}
            </p>
          </div>
          <span
            className="font-mono text-2xl font-bold"
            style={{ color: "var(--brand-yellow)" }}
          >
            {loading ? "—" : radius}m
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <input
            type="range"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            step={5}
            value={radius}
            disabled={loading || tableMissing}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full"
            aria-label={t("admin.settings.geofenceRadius")}
          />
          <div className="flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
            <span>{MIN_RADIUS}m</span>
            <span>{DEFAULT_RADIUS}m (default)</span>
            <span>{MAX_RADIUS}m</span>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || loading || tableMissing}
            className="rounded-[var(--radius-sm)] px-5 py-2.5 text-sm font-semibold"
            style={{
              background: saving || loading || tableMissing ? "var(--border-default)" : "var(--brand-yellow)",
              color: saving || loading || tableMissing ? "var(--text-muted)" : "var(--text-inverse)",
            }}
          >
            {saving ? t("common.saving") : t("settings.saveSettings")}
          </button>
        </div>
      </section>

      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(96, 165, 250, 0.12)" }}
            >
              <MapPin size={18} style={{ color: "var(--blue)" }} />
            </span>
            <div>
              <div className="text-base font-semibold text-[var(--text-primary)]">
                {t("gps.adminTitle")}
              </div>
              <p className="mt-1 max-w-[62ch] text-xs leading-5 text-[var(--text-secondary)]">
                {t("gps.adminDescription")}
              </p>
            </div>
          </div>
          <Link href="/location-data" className="button-base button-secondary px-3 py-2 text-xs">
            {t("gps.adminTitle")}
          </Link>
        </div>
      </section>
    </div>
  );
}
