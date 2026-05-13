"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, User, ClipboardCheck, Receipt, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { formatDateTime } from "@/lib/worker-utils";

type TrashItem = {
  id: string;
  kind: "project" | "profile" | "task" | "receipt";
  name: string;
  deletedAt: string;
};

export default function TrashPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);

  async function handleEmptyAll() {
    setBusyKey("empty-all");
    setMessage("");
    const snapshot = [...items];
    let failures = 0;
    for (const item of snapshot) {
      const { error } = await supabase
        .from(tableName(item.kind))
        .delete()
        .eq("id", item.id);
      if (error) failures += 1;
    }
    setBusyKey(null);
    setConfirmEmptyAll(false);
    if (failures > 0) {
      setMessage(`${failures} / ${snapshot.length} ${t("common.errorTryAgain").toLowerCase()}`);
      setMessageType("error");
    } else {
      setMessage(t("trash.emptied"));
      setMessageType("success");
    }
    void loadTrash();
    router.refresh();
  }

  async function loadTrash() {
    const [projectsRes, profilesRes, tasksRes, receiptsRes] = await Promise.all([
      supabase.from("projects").select("id, name, deleted_at").not("deleted_at", "is", null),
      supabase.from("profiles").select("id, name, deleted_at").not("deleted_at", "is", null),
      supabase.from("tasks").select("id, title, deleted_at").not("deleted_at", "is", null),
      supabase
        .from("media")
        .select("id, filename, deleted_at, metadata")
        .eq("metadata->>category", "receipt")
        .not("deleted_at", "is", null),
    ]);

    const all: TrashItem[] = [];

    for (const row of projectsRes.data ?? []) {
      all.push({ id: row.id, kind: "project", name: row.name, deletedAt: row.deleted_at as string });
    }
    for (const row of profilesRes.data ?? []) {
      all.push({ id: row.id, kind: "profile", name: row.name, deletedAt: row.deleted_at as string });
    }
    for (const row of tasksRes.data ?? []) {
      all.push({ id: row.id, kind: "task", name: row.title, deletedAt: row.deleted_at as string });
    }
    for (const row of receiptsRes.data ?? []) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const store = (meta.store_name as string) ?? "";
      const amount = (meta.amount as number) ?? 0;
      const label = store ? `${store} — $${amount.toFixed(2)}` : (row.filename ?? "Receipt");
      all.push({ id: row.id, kind: "receipt", name: label, deletedAt: row.deleted_at as string });
    }

    all.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
    setItems(all);
    setLoading(false);
  }

  useEffect(() => {
    void loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirmEmptyAll) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setConfirmEmptyAll(false);
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirmEmptyAll]);

  function tableName(kind: TrashItem["kind"]): "projects" | "profiles" | "tasks" | "media" {
    if (kind === "project") return "projects";
    if (kind === "profile") return "profiles";
    if (kind === "receipt") return "media";
    return "tasks";
  }

  async function handleRestore(item: TrashItem) {
    setBusyKey(`restore-${item.id}`);
    setMessage("");

    const { error } = await supabase
      .from(tableName(item.kind))
      .update({ deleted_at: null })
      .eq("id", item.id);

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("trash.restored"));
    setMessageType("success");
    void loadTrash();
    router.refresh();
  }

  async function handlePermanentDelete(item: TrashItem) {
    setBusyKey(`delete-${item.id}`);
    setMessage("");

    const { error } = await supabase
      .from(tableName(item.kind))
      .delete()
      .eq("id", item.id);

    if (error) {
      setMessage(error.message);
      setMessageType("error");
      setBusyKey(null);
      setConfirmDeleteId(null);
      return;
    }

    setBusyKey(null);
    setConfirmDeleteId(null);
    setMessage(t("trash.deleted"));
    setMessageType("success");
    void loadTrash();
    router.refresh();
  }

  function kindLabel(kind: TrashItem["kind"]): string {
    if (kind === "project") return t("trash.project");
    if (kind === "profile") return t("trash.profile");
    if (kind === "receipt") return t("trash.receipt");
    return t("trash.task");
  }

  function KindIcon({ kind }: { kind: TrashItem["kind"] }) {
    if (kind === "project") return <FolderKanban size={16} className="text-[var(--brand-yellow)]" />;
    if (kind === "profile") return <User size={16} className="text-[var(--blue)]" />;
    if (kind === "receipt") return <Receipt size={16} className="text-[var(--brand-yellow)]" />;
    return <ClipboardCheck size={16} className="text-[var(--green)]" />;
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("trash.title")}
          </p>
          <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
            {t("trash.subtitle")}
          </h1>
          <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
            {t("trash.description")}
          </p>
        </div>
        <Link
          href="/archive"
          aria-label={t("common.dismiss")}
          title={t("common.dismiss")}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border text-[var(--text-primary)] transition hover:border-[var(--brand-yellow)] hover:text-[var(--brand-yellow)]"
          style={{ borderColor: "var(--border-default)" }}
        >
          <X size={17} />
        </Link>
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

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("trash.title")}</h2>
          <div className="flex items-center gap-3">
            <div className="text-xs text-[var(--text-muted)]">{items.length} {t("tasks.items")}</div>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={() => setConfirmEmptyAll(true)}
                disabled={busyKey === "empty-all"}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
              >
                <Trash2 size={12} /> {t("trash.emptyAll")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
              {t("common.loading")}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-6 text-center">
              <div className="text-3xl" role="img" aria-label="broom">🧹</div>
              <div className="mt-2 text-sm text-[var(--text-secondary)]">{t("trash.empty")}</div>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <KindIcon kind={item.kind} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{item.name}</div>
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                          style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)" }}
                        >
                          {kindLabel(item.kind)}
                        </span>
                        <span>{t("trash.deletedOn")} {formatDateTime(item.deletedAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRestore(item)}
                      disabled={busyKey === `restore-${item.id}`}
                      className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                      style={{ borderColor: "rgba(15, 168, 120, 0.3)", color: "var(--green)" }}
                    >
                      {busyKey === `restore-${item.id}` ? "..." : t("trash.restore")}
                    </button>

                    {confirmDeleteId === `${item.kind}-${item.id}` ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--red)]">{t("trash.deleteConfirm")}</span>
                        <button
                          type="button"
                          onClick={() => void handlePermanentDelete(item)}
                          disabled={busyKey === `delete-${item.id}`}
                          className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                          style={{ background: "var(--red)", color: "white" }}
                        >
                          {busyKey === `delete-${item.id}` ? "..." : t("teamMember.yesRemove")}
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
                        onClick={() => setConfirmDeleteId(`${item.kind}-${item.id}`)}
                        className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                        style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                      >
                        {t("trash.deletePermanently")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {confirmEmptyAll ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setConfirmEmptyAll(false)}
        >
          <div
            className="surface-card w-full max-w-[440px] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {t("trash.emptyAllConfirmTitle")}
              </h2>
              <button
                type="button"
                onClick={() => setConfirmEmptyAll(false)}
                aria-label={t("common.dismiss")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t("trash.emptyAllConfirmBody").replace("{n}", String(items.length))}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void handleEmptyAll()}
                disabled={busyKey === "empty-all"}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                style={{ background: "var(--red)", color: "white" }}
              >
                {busyKey === "empty-all" ? "…" : t("trash.emptyAll")}
              </button>
              <button
                type="button"
                onClick={() => setConfirmEmptyAll(false)}
                className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
