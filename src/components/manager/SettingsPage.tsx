"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";

export function SettingsPage({
  orgId,
  orgName,
  orgSlug,
  managerName,
  crewCount,
  activeProjectCount,
}: {
  orgId: string;
  orgName: string;
  orgSlug: string;
  managerName: string;
  crewCount: number;
  activeProjectCount: number;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const { t } = useTranslation();

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? orgName;
    const slug = formData.get("slug")?.toString().trim().toLowerCase() ?? orgSlug;

    if (!name || !slug) {
      setMessage(t("settings.orgRequired"));
      return;
    }

    setBusy(true);
    setMessage("");

    const { error } = await supabase.from("organizations").update({ name, slug }).eq("id", orgId);

    if (error) {
      setMessage(error.message);
      setBusy(false);
      return;
    }

    setBusy(false);
    setMessage(t("settings.orgUpdated"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("settings.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("settings.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("settings.description")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("settings.organization")}</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleSave}>
            <TextInputWithVoice
              name="name"
              defaultValue={orgName}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <TextInputWithVoice
              name="slug"
              defaultValue={orgSlug}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: busy ? "var(--border-default)" : "var(--brand-yellow)",
                color: busy ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busy ? t("common.saving") : t("settings.saveSettings")}
            </button>
          </form>
        </div>

        <div className="space-y-4">
          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("settings.workspacePulse")}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("settings.manager")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">{managerName}</div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.crew")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">{crewCount}</div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("projects.title")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">{activeProjectCount}</div>
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4 text-sm leading-6 text-[var(--text-secondary)]">
            {t("settings.footerNote")}
          </div>
        </div>
      </section>
    </div>
  );
}
