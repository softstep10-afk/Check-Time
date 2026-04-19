"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { CAPABILITIES, type CapabilityKey } from "@/lib/capabilities";
import { toggleUserCapability } from "@/app/(manager)/admin/users/[id]/permissions/actions";

export function UserPermissionsPage({
  managerId: _managerId,
  target,
  initialCapabilities,
}: {
  managerId: string;
  target: { id: string; name: string; role: string };
  initialCapabilities: Record<CapabilityKey, boolean>;
}) {
  void _managerId;
  const { t, locale } = useTranslation();
  const [capabilities, setCapabilities] =
    useState<Record<CapabilityKey, boolean>>(initialCapabilities);
  const [busyKey, setBusyKey] = useState<CapabilityKey | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [, startTransition] = useTransition();

  function handleToggle(capability: CapabilityKey, next: boolean) {
    const previous = capabilities[capability];
    // Optimistic flip — flip back on failure.
    setCapabilities((prev) => ({ ...prev, [capability]: next }));
    setBusyKey(capability);
    setMessage(null);

    startTransition(async () => {
      const result = await toggleUserCapability({
        userId: target.id,
        capability,
        granted: next,
      });
      setBusyKey(null);
      if (result.ok) {
        setMessage({ tone: "success", text: t("permissions.saved") });
        setTimeout(() => setMessage(null), 1500);
        return;
      }
      // Roll back optimistic update on failure.
      setCapabilities((prev) => ({ ...prev, [capability]: previous }));
      if (result.missingTable) {
        setTableMissing(true);
      } else {
        setMessage({
          tone: "error",
          text: result.message ?? t("permissions.saveFailed"),
        });
      }
    });
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-5 p-5">
      <section className="space-y-2">
        <Link
          href={`/team/${target.id}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-yellow)]"
        >
          <ArrowLeft size={12} /> {target.name}
        </Link>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("permissions.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("permissions.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("permissions.description")}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-muted)]">{t("permissions.role")}:</span>
          <span
            className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
          >
            <ShieldCheck size={10} />
            {target.role}
          </span>
        </div>
      </section>

      {tableMissing ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
        >
          {t("permissions.tableMissing")}
        </div>
      ) : null}

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background: message.tone === "error" ? "rgba(212, 81, 94, 0.12)" : "rgba(15, 168, 120, 0.16)",
            color: message.tone === "error" ? "var(--red)" : "var(--green)",
          }}
        >
          {message.text}
        </div>
      ) : null}

      <section className="space-y-2">
        {CAPABILITIES.map((capability) => {
          const granted = capabilities[capability.key];
          const busy = busyKey === capability.key;
          const label = locale === "ru" ? capability.label_ru : capability.label_en;
          const description = locale === "ru" ? capability.description_ru : capability.description_en;
          return (
            <div
              key={capability.key}
              className="surface-card flex items-start justify-between gap-4 p-4"
              style={{
                borderColor: granted ? "rgba(15, 168, 120, 0.3)" : "var(--border-default)",
              }}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {label}
                </div>
                <p className="mt-1 max-w-[60ch] text-xs text-[var(--text-secondary)]">
                  {description}
                </p>
                <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                  {capability.key}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={granted}
                aria-label={label}
                onClick={() => handleToggle(capability.key, !granted)}
                disabled={busy || tableMissing}
                className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
                style={{ background: granted ? "var(--green)" : "var(--border-default)" }}
              >
                <span
                  className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
                  style={{ transform: granted ? "translateX(22px)" : "translateX(4px)" }}
                />
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
