"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime } from "@/lib/worker-utils";
import type { Profile } from "@/types/database";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";

export default function ManagersPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [managers, setManagers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function loadManagers() {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .in("role", ["owner", "admin", "manager", "supervisor"])
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    setManagers((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void loadManagers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() ?? "";
    const pin = formData.get("pin")?.toString().trim() ?? "";
    const role = formData.get("role")?.toString() ?? "manager";

    if (!name || !pin) {
      setMessage(t("team.nameRequired"));
      setMessageType("error");
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setMessage(t("team.pinLength"));
      setMessageType("error");
      return;
    }

    setBusyKey("create");
    setMessage("");

    const response = await fetch("/api/team/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, pin, role, hourlyRate: "", requireVideo: false }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("team.couldNotCreate"));
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    form.reset();
    setBusyKey(null);
    setMessage(t("managers.added"));
    setMessageType("success");
    void loadManagers();
    router.refresh();
  }

  async function handleDelete(profileId: string) {
    setBusyKey(`delete-${profileId}`);
    setMessage("");

    const response = await fetch("/api/team/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, deleteAuthUser: true }),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? t("teamMember.couldNotRemove"));
      setMessageType("error");
      setBusyKey(null);
      setConfirmDeleteId(null);
      return;
    }

    setBusyKey(null);
    setConfirmDeleteId(null);
    setMessage(t("managers.removed"));
    setMessageType("success");
    void loadManagers();
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("managers.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("managers.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("managers.description")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background: messageType === "error" ? "rgba(212, 81, 94, 0.12)" : "rgba(15, 168, 120, 0.16)",
            color: messageType === "error" ? "var(--red)" : "var(--green)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("managers.title")}</h2>
          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("common.loading")}
              </div>
            ) : managers.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("managers.noManagers")}
              </div>
            ) : (
              managers.map((mgr) => (
                <div
                  key={mgr.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{mgr.name}</div>
                      <div className="flex items-center gap-2">
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
                        >
                          {mgr.role}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {t("managers.pin")}: ****
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-muted)]">
                        {t("managers.created")} {formatDateTime(mgr.created_at)}
                      </div>
                    </div>
                    <div>
                      {confirmDeleteId === mgr.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--red)]">{t("managers.deleteConfirm")}</span>
                          <button
                            type="button"
                            onClick={() => void handleDelete(mgr.id)}
                            disabled={busyKey === `delete-${mgr.id}`}
                            className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                            style={{ background: "var(--red)", color: "white" }}
                          >
                            {busyKey === `delete-${mgr.id}` ? "..." : t("teamMember.yesRemove")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(mgr.id)}
                          className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                          style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                        >
                          {t("common.remove")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("managers.addManager")}</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleCreate}>
            <TextInputWithVoice
              name="name"
              placeholder={t("managers.name")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <input
              name="pin"
              inputMode="numeric"
              maxLength={6}
              placeholder={`${t("managers.pin")} (4-6)`}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <select
              name="role"
              defaultValue="manager"
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="manager">manager</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              disabled={busyKey === "create"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: busyKey === "create" ? "var(--border-default)" : "var(--brand-yellow)",
                color: busyKey === "create" ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busyKey === "create" ? t("common.creating") : t("managers.addManager")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
