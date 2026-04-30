"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Play, Square, Receipt as ReceiptIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { validateUploadFile } from "@/lib/upload-limits";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { CheckoutModal } from "@/components/worker/CheckoutModal";
import { SafetyBriefModal } from "@/components/worker/SafetyBriefModal";
import {
  DEFAULT_SAFETY_VERSION,
  writeSafetyAck,
} from "@/lib/safety-acknowledgements";
import { normalizeStoragePath, type TaskAttachmentRef } from "@/lib/task-attachments";
import type { Project, Task } from "@/types/database";

type TaskWithAttachments = Task & { attachments?: TaskAttachmentRef[] };

type ReceiptItem = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  media_type: string;
  storage_path: string;
  created_at: string;
  store_name: string | null;
  amount: number | null;
};

const STORES = [
  "Home Depot",
  "Lowe's",
  "Floor & Decor",
  "Harbor Freight",
  "Ferguson",
  "Supply Masters",
];

type MaterialStatus = "needed" | "ordered" | "delivered";

type MaterialRow = {
  id: string;
  title: string;
  quantity: string;
  status: MaterialStatus;
};

function mapTaskStatusToMaterialStatus(taskStatus: string): MaterialStatus {
  if (taskStatus === "done") return "delivered";
  if (taskStatus === "in_progress") return "ordered";
  return "needed";
}

export function WorkerProjectView({
  project,
  projectMedia,
  projectReceipts,
  tasks,
  orgId,
  profileId,
}: {
  project: Project;
  projectMedia: TaskAttachmentRef[];
  projectReceipts: ReceiptItem[];
  tasks: TaskWithAttachments[];
  orgId: string;
  profileId: string;
}) {
  const { t } = useTranslation();

  // Split tasks into "mine" (assigned to this worker) vs "project-level"
  // (assigned_to IS NULL — visible to the whole crew). Both lists were
  // already loaded by the server route, just split here for display.
  const mineTasks = tasks.filter((task) => task.assigned_to === profileId);
  const projectLevelTasks = tasks.filter((task) => task.assigned_to === null);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <Link href="/my-tasks" className="text-xs font-semibold text-[var(--brand-yellow)]">
          {t("workerProject.backToTasks")}
        </Link>
        <h1 className="mt-2 text-xl font-bold text-[var(--text-primary)]">{project.name}</h1>
        {project.address ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">{project.address}</p>
        ) : null}
      </section>

      {/* Clock In / Clock Out for THIS project. Reuses the shell's existing
          clockIn / clockOut from useWorkerShell — the GPS prompt, offline
          queue, and require-video gate all flow through unchanged. */}
      <ProjectClockControls projectId={project.id} projectName={project.name} />

      {/* Notes — visible to the whole crew. project.notes is on every Project row. */}
      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.notesTitle")}
        </h2>
        {project.notes ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {project.notes}
          </p>
        ) : (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.notesEmpty")}
          </div>
        )}
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.projectMediaTitle")}
        </h2>
        {projectMedia.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.projectMediaEmpty")}
          </div>
        ) : (
          <div className="mt-2">
            <TaskAttachmentList items={projectMedia} />
          </div>
        )}
      </section>

      <WorkerMaterialsList projectId={project.id} />
      <WorkerReceiptUpload
        orgId={orgId}
        projectId={project.id}
        profileId={profileId}
      />

      {/* Existing receipts on this project — list view. Worker can tap to
          open the file in a signed Storage URL. */}
      <ProjectReceiptsList items={projectReceipts} />

      {/* My tasks (assigned_to = me) */}
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("workerProject.tasksMineTitle")}
          </h2>
          <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            {mineTasks.length}
          </span>
        </div>
        {mineTasks.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.tasksEmpty")}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {mineTasks.map((task) => (
              <WorkerTaskCard key={task.id} task={task} t={t} />
            ))}
          </div>
        )}
      </section>

      {/* Project-level tasks (assigned_to IS NULL) */}
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("workerProject.tasksProjectTitle")}
          </h2>
          <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            {projectLevelTasks.length}
          </span>
        </div>
        {projectLevelTasks.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.tasksEmpty")}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {projectLevelTasks.map((task) => (
              <WorkerTaskCard key={task.id} task={task} t={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkerTaskCard({
  task,
  t,
}: {
  task: TaskWithAttachments;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
      <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
      <div className="mt-1 text-xs text-[var(--text-secondary)]">
        {task.priority} • {task.status.replace("_", " ")}
      </div>
      {task.description ? (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{task.description}</p>
      ) : null}
      {task.attachments && task.attachments.length > 0 ? (
        <>
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            📎 {task.attachments.length} {t("tasks.filesShort")}
          </div>
          <TaskAttachmentList items={task.attachments} />
        </>
      ) : null}
    </div>
  );
}

function ProjectReceiptsList({ items }: { items: ReceiptItem[] }) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);

  async function open(item: ReceiptItem) {
    if (typeof window === "undefined") return;
    const tab = window.open("about:blank", "_blank");
    if (!tab) return;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalizeStoragePath(item.storage_path), 3600);
    if (error || !data?.signedUrl) {
      tab.close();
      return;
    }
    tab.location.href = data.signedUrl;
  }

  return (
    <section className="surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.receiptsTitle")}
        </h2>
        <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
          {t("workerProject.receiptsEmpty")}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void open(item)}
              className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-left"
            >
              <div className="flex min-w-0 items-center gap-2">
                <ReceiptIcon size={14} className="shrink-0 text-[var(--brand-yellow)]" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {item.store_name ?? item.filename ?? t("workerProject.receiptsTitle")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {item.created_at.slice(0, 10)}
                  </div>
                </div>
              </div>
              {item.amount !== null && Number.isFinite(item.amount) ? (
                <span className="shrink-0 font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                  ${item.amount.toFixed(2)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Clock In / Clock Out for THIS project. Routes both actions through the
 * existing WorkerShell.clockIn / clockOut via useWorkerShell — keeping the
 * GPS prompt, offline queue, no-GPS path, and require-video gate intact
 * without duplicating any clock logic.
 *
 * Three render branches:
 *   1. Worker is currently clocked in to THIS project → "End shift" button +
 *      opens the existing CheckoutModal (which gates on require_video).
 *   2. Worker is clocked in to a DIFFERENT project → warning panel with the
 *      conflicting project's name and an explicit "End there and start here"
 *      button. The "switch" calls clockOut() then clockIn(thisProjectId).
 *   3. Worker is not clocked in → plain "Start shift" button → clockIn(thisProjectId).
 */
function ProjectClockControls({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { shell, busyAction, clockIn } = useWorkerShell();
  const { t } = useTranslation();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);

  const isClockedIn = shell.clockState.isClockedIn;
  const currentProjectId = shell.clockState.currentProjectId;
  const currentProjectName = shell.clockState.currentProjectName;
  const clockedInHere = isClockedIn && currentProjectId === projectId;
  const clockedInElsewhere = isClockedIn && currentProjectId !== projectId;
  const startingShift = busyAction === "clock-in";

  function handleStart() {
    setSafetyOpen(true);
  }

  async function handleSafetyConfirm() {
    setSafetyOpen(false);
    // Best-effort ack write; never block clockIn on a missing audit row or
    // a thrown error from the supabase client (network blip, RLS surface,
    // table missing pre-migration). Always proceed to clockIn.
    try {
      const ackResult = await writeSafetyAck(supabase, {
        orgId: shell.profile.org_id,
        workerId: shell.profile.id,
        projectId,
        safetyVersion: DEFAULT_SAFETY_VERSION,
      });
      if (!ackResult.ok) {
        console.warn("safety ack write failed:", ackResult.error);
      }
    } catch (err) {
      console.warn("safety ack threw:", err);
    }
    void clockIn(projectId);
  }

  async function handleSwitch() {
    setCheckoutOpen(true);
    // Once the worker confirms in CheckoutModal, the modal calls clockOut()
    // and closes itself. The next render will see isClockedIn=false; the
    // worker can tap Start Shift here. We don't auto-chain into clockIn
    // because the require-video / GPS-prompt branches inside clockOut may
    // need worker interaction first.
  }

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">
        {t("workerProject.clockSectionTitle")}
      </h2>

      {clockedInHere ? (
        <>
          <p
            className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "rgba(46, 166, 122, 0.14)", color: "var(--green)" }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {t("workerProject.clockedInHere")}
          </p>
          <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold"
            style={{ background: "var(--red)", color: "white" }}
          >
            <Square size={14} />
            {t("clock.endShiftCta")}
          </button>
        </>
      ) : clockedInElsewhere ? (
        <>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t("workerProject.clockedInElsewhere").replace(
              "{project}",
              currentProjectName ?? "",
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("workerProject.switchProjectConfirm")}
          </p>
          <button
            type="button"
            onClick={() => void handleSwitch()}
            disabled={startingShift}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "#f59e0b", color: "var(--text-inverse)" }}
          >
            <Square size={14} />
            {t("workerProject.switchEndAndStart")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handleStart}
          disabled={startingShift}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold disabled:opacity-50"
          style={{ background: "#f59e0b", color: "var(--text-inverse)" }}
        >
          <Play size={14} />
          {startingShift ? t("clock.checkingLocation") : t("clock.startShiftCta")}
        </button>
      )}

      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      <SafetyBriefModal
        open={safetyOpen}
        projectName={projectName}
        onConfirm={() => void handleSafetyConfirm()}
        onCancel={() => setSafetyOpen(false)}
      />
    </section>
  );
}

function WorkerMaterialsList({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("tasks")
        .select("id, title, status, metadata")
        .eq("project_id", projectId)
        .eq("metadata->>category", "material")
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      const rows = (data ?? []) as Array<{
        id: string;
        title: string;
        status: string;
        metadata: Record<string, unknown> | null;
      }>;
      setItems(
        rows.map((r) => ({
          id: r.id,
          title: r.title,
          quantity: (r.metadata?.quantity as string) ?? "",
          status: mapTaskStatusToMaterialStatus(r.status),
        })),
      );
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, projectId]);

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">
        {t("materials.title")}
      </h2>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {t("workerProject.readOnlyHint")}
      </p>
      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("materials.empty")}
          </div>
        ) : (
          items.map((item) => {
            const delivered = item.status === "delivered";
            const statusColor =
              item.status === "delivered"
                ? "var(--green)"
                : item.status === "ordered"
                  ? "var(--brand-yellow)"
                  : "var(--text-muted)";
            const statusLabel =
              item.status === "delivered"
                ? t("materials.delivered")
                : item.status === "ordered"
                  ? t("materials.ordered")
                  : t("materials.needed");
            return (
              <div
                key={item.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                style={{ opacity: delivered ? 0.6 : 1 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className="text-sm font-semibold text-[var(--text-primary)]"
                      style={{ textDecoration: delivered ? "line-through" : "none" }}
                    >
                      {item.title}
                    </span>
                    {item.quantity ? (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">×{item.quantity}</span>
                    ) : null}
                  </div>
                  <span
                    className="shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ background: `${statusColor}1f`, color: statusColor }}
                  >
                    {statusLabel}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function WorkerReceiptUpload({
  orgId,
  projectId,
  profileId,
}: {
  orgId: string;
  projectId: string;
  profileId: string;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const file = fileRef.current?.files?.[0] ?? null;
    const storeName = fd.get("store")?.toString() ?? "";
    const otherStore = fd.get("store_other")?.toString().trim() ?? "";
    const finalStore = storeName === "__other" ? otherStore : storeName;
    const amount = Number.parseFloat(fd.get("amount")?.toString() ?? "0");
    const note = fd.get("note")?.toString().trim() ?? "";

    if (!file) {
      setMessage({ kind: "err", text: t("workerProject.receiptPhotoRequired") });
      return;
    }
    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      setMessage({ kind: "err", text: t("workerProject.receiptAmountRequired") });
      return;
    }

    const validation = validateUploadFile(file);
    if (!validation.ok) {
      setMessage({ kind: "err", text: t("uploads.unsupportedType").replace("{kind}", "mime" in validation.error ? validation.error.mime : "") });
      return;
    }

    setBusy(true);
    setMessage(null);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${orgId}/${projectId}/receipts/${Date.now()}-${safeName}`;
    const mimeType = file.type || "application/octet-stream";

    const { error: uploadErr } = await supabase.storage
      .from("media")
      .upload(path, file, { upsert: false, cacheControl: "3600", contentType: mimeType });
    if (uploadErr) {
      setBusy(false);
      setMessage({ kind: "err", text: uploadErr.message });
      return;
    }

    const mediaType = mimeType.startsWith("image/") ? "photo" : "pdf";
    const metadata = {
      kind: "receipt" as const,
      category: "receipt" as const,
      store_name: finalStore || null,
      amount,
      purchase_date: new Date().toISOString().slice(0, 10),
      uploader_name: "Worker",
    };

    const { error: insertErr } = await supabase.from("media").insert({
      org_id: orgId,
      project_id: projectId,
      uploaded_by: profileId,
      media_type: mediaType,
      storage_path: path,
      filename: file.name,
      file_size: file.size,
      mime_type: mimeType,
      caption: note || null,
      is_checkout: false,
      time_event_id: null,
      metadata,
    });

    setBusy(false);
    if (insertErr) {
      setMessage({ kind: "err", text: insertErr.message });
      return;
    }
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    setShowOther(false);
    setMessage({ kind: "ok", text: t("workerProject.receiptSaved") });
  }

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">
        {t("workerProject.addReceiptTitle")}
      </h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("workerProject.addReceiptHint")}
      </p>
      {message ? (
        <div
          className="mt-3 text-xs font-semibold"
          style={{ color: message.kind === "ok" ? "var(--green)" : "var(--red)" }}
        >
          {message.text}
        </div>
      ) : null}
      <form className="mt-3 grid gap-3" onSubmit={handleSubmit}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder={t("workerProject.receiptAmount")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
          <select
            name="store"
            defaultValue=""
            onChange={(e) => setShowOther(e.target.value === "__other")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("workerProject.receiptStorePlaceholder")}</option>
            {STORES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="__other">{t("workerProject.receiptStoreOther")}</option>
          </select>
        </div>
        {showOther ? (
          <input
            name="store_other"
            placeholder={t("workerProject.receiptStoreOtherLabel")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        ) : null}
        <input
          name="note"
          placeholder={t("workerProject.receiptNote")}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="button-base button-primary"
        >
          {busy ? t("common.saving") : t("workerProject.receiptSaveCta")}
        </button>
      </form>
    </section>
  );
}
