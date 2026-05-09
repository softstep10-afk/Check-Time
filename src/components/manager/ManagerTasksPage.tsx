"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { ACCEPT_ALL_UPLOADS, validateUploadFile } from "@/lib/upload-limits";
import {
  buildProfileNameMap,
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
  getTaskCompletionAudit,
} from "@/lib/task-notifications";
import {
  getAttachmentMediaIds,
  linkMediaToTask,
  type TaskAttachmentRef,
  uploadTaskAttachment,
} from "@/lib/task-attachments";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { formatDateTime } from "@/lib/worker-utils";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";
import type {
  ProjectStatus,
  Task,
  TaskPriority,
  TaskStatus,
  UserRole,
} from "@/types/database";

type ProjectOption = { id: string; name: string; status: ProjectStatus };
type WorkerOption = { id: string; name: string; role: UserRole };
type TaskRow = Task & {
  projectName: string | null;
  assigneeName: string | null;
  completedByName?: string | null;
};

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "done", "cancelled"];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "#ef4444",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "var(--text-muted)",
  in_progress: "var(--blue)",
  done: "var(--green)",
  cancelled: "var(--red)",
};

export function ManagerTasksPage({
  orgId,
  managerId,
  projects,
  workers,
  initialTasks,
  attachmentMedia = [],
}: {
  orgId: string;
  managerId: string;
  projects: ProjectOption[];
  workers: WorkerOption[];
  initialTasks: TaskRow[];
  attachmentMedia?: TaskAttachmentRef[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();

  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("success");
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null);
  const [pendingClearDone, setPendingClearDone] = useState(false);

  const [filterProject, setFilterProject] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const workersById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const workerNameById = useMemo(() => buildProfileNameMap(workers), [workers]);
  const attachmentById = useMemo(
    () => new Map(attachmentMedia.map((m) => [m.id, m])),
    [attachmentMedia],
  );

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterProject && task.project_id !== filterProject) return false;
      if (filterStatus && task.status !== filterStatus) return false;
      return true;
    });
  }, [tasks, filterProject, filterStatus]);
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "done"),
    [tasks],
  );

  function priorityLabel(priority: TaskPriority): string {
    if (priority === "urgent") return t("tasks.priorityUrgent");
    if (priority === "high") return t("tasks.priorityHigh");
    if (priority === "medium") return t("tasks.priorityMedium");
    return t("tasks.priorityLow");
  }

  function statusLabel(status: TaskStatus): string {
    if (status === "in_progress") return t("tasks.statusInProgress");
    if (status === "done") return t("tasks.statusDone");
    if (status === "cancelled") return t("tasks.statusCancelled");
    return t("tasks.statusPending");
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const title = formData.get("title")?.toString().trim() ?? "";
    if (!title) {
      setMessage(t("projectDetail.taskTitleRequired"));
      setMessageTone("error");
      return;
    }

    const projectId = formData.get("project_id")?.toString() || null;
    const assignedTo = formData.get("assigned_to")?.toString() || null;
    const priority = (formData.get("priority")?.toString() ?? "medium") as TaskPriority;
    const dueDate = formData.get("due_date")?.toString() || null;
    const description = formData.get("description")?.toString().trim() || null;

    setBusyKey("create");
    setMessage("");

    // Attachments require a project (storage path includes projectId).
    if (attachmentFiles.length > 0 && !projectId) {
      setMessage(t("tasks.attachmentNeedsProject"));
      setMessageTone("error");
      setBusyKey(null);
      return;
    }

    console.log("[task-attach] ManagerTasksPage create: file count", attachmentFiles.length);

    const uploadedMediaIds: string[] = [];
    for (const file of attachmentFiles) {
      // Cloud-picker guard: see ProjectDetailPage.handleCreateTask.
      if (!file || file.size === 0 || !file.name) {
        console.error("[task-attach] invalid File detected (likely cloud picker)", {
          name: file?.name,
          size: file?.size,
          type: file?.type,
        });
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        console.error("[task-attach] ManagerTasksPage validation FAIL", validation.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      const result = await uploadTaskAttachment(supabase, {
        orgId,
        projectId: projectId!,
        uploadedBy: managerId,
        file,
      });
      if (!result.ok) {
        console.error("[task-attach] ManagerTasksPage upload FAIL", result.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      uploadedMediaIds.push(result.mediaId);
    }

    console.log("[task-attach] ManagerTasksPage task insert begin", {
      hasAttachments: uploadedMediaIds.length > 0,
    });
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        org_id: orgId,
        project_id: projectId,
        assigned_to: assignedTo,
        assigned_by: managerId,
        title,
        description,
        priority,
        status: "pending",
        due_date: dueDate,
        metadata: uploadedMediaIds.length > 0
          ? { attachment_media_ids: uploadedMediaIds }
          : {},
      })
      .select("*")
      .single<Task>();

    setBusyKey(null);

    if (error || !data) {
      console.error("[task-attach] ManagerTasksPage task insert FAIL", error);
      setMessage(`task-insert: ${error?.message ?? "no data"}`);
      setMessageTone("error");
      return;
    }
    console.log("[task-attach] ManagerTasksPage task insert ok", { taskId: data.id });

    if (uploadedMediaIds.length > 0) {
      void linkMediaToTask(supabase, data.id, uploadedMediaIds);
    }

    setTasks((prev) => [
      {
        ...data,
        projectName: projectId ? projectsById.get(projectId)?.name ?? null : null,
        assigneeName: assignedTo ? workersById.get(assignedTo)?.name ?? null : null,
        completedByName: null,
      },
      ...prev,
    ]);
    form.reset();
    setAttachmentFiles([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    setMessage(t("tasks.created"));
    setMessageTone("success");
    router.refresh();
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    setBusyKey(`status-${taskId}`);
    const patch: Record<string, unknown> = { status };
    const completedAt = status === "done" ? new Date().toISOString() : null;
    const completedBy = status === "done" ? managerId : null;
    if (status === "done") {
      patch.completed_at = completedAt;
      patch.completed_by = completedBy;
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }
    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status, completed_at: completedAt, completed_by: completedBy }
          : t,
      ),
    );
  }

  async function handleDelete(taskId: string) {
    if (pendingDeleteTaskId !== taskId) {
      setPendingDeleteTaskId(taskId);
      setPendingClearDone(false);
      setMessage(t("tasks.deleteSecondClick"));
      setMessageTone("info");
      return;
    }

    setBusyKey(`delete-${taskId}`);
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", taskId);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setPendingDeleteTaskId(null);
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setMessage(t("tasks.deleted"));
    setMessageTone("success");
  }

  async function handleClearCompleted() {
    const ids = completedTasks.map((task) => task.id);
    if (ids.length === 0) return;

    if (!pendingClearDone) {
      setPendingClearDone(true);
      setPendingDeleteTaskId(null);
      setMessage(
        t("tasks.clearCompletedSecondClick").replace("{count}", String(ids.length)),
      );
      setMessageTone("info");
      return;
    }

    setBusyKey("clear-completed");
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setPendingClearDone(false);
    setTasks((prev) => prev.filter((task) => task.status !== "done"));
    setMessage(t("tasks.completedCleared").replace("{count}", String(ids.length)));
    setMessageTone("success");
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("common.tasks")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("tasks.subtitle")}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("tasks.descriptionLong")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background:
              messageTone === "error"
                ? "rgba(212, 81, 94, 0.12)"
                : messageTone === "info"
                  ? "rgba(191, 162, 52, 0.12)"
                  : "rgba(15, 168, 120, 0.16)",
            color:
              messageTone === "error"
                ? "var(--red)"
                : messageTone === "info"
                  ? "var(--brand-yellow)"
                  : "var(--green)",
          }}
        >
          {message}
        </div>
      ) : null}

      <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-secondary)]">
        {t("tasks.preferProjectPage")}
        <Link href="/projects" className="ml-2 font-semibold text-[var(--brand-yellow)]">
          {t("tasks.openProjects")}
        </Link>
      </div>

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        {/* ── Assign Task ── */}
        <div className="surface-card p-4">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: "rgba(191, 162, 52, 0.12)" }}
            >
              <Plus size={16} style={{ color: "var(--brand-yellow)" }} />
            </span>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("tasks.assignTask")}
            </h2>
          </div>

          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            {t("tasks.createInsideProject")}
          </p>
          <Link
            href="/projects"
            className="button-base button-primary mt-4 inline-flex"
          >
            {t("tasks.openProjects")}
          </Link>
        </div>

        {/* ── All Tasks ── */}
        <div className="surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("tasks.allTasks")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleClearCompleted()}
                disabled={completedTasks.length === 0 || busyKey === "clear-completed"}
                className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{
                  borderColor: pendingClearDone ? "rgba(212, 81, 94, 0.36)" : "var(--border-default)",
                  color: pendingClearDone ? "var(--red)" : "var(--text-primary)",
                }}
              >
                {busyKey === "clear-completed"
                  ? t("common.saving")
                  : pendingClearDone
                    ? t("tasks.confirmClearCompleted")
                    : t("tasks.clearCompleted")}
              </button>
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.allProjects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.allStatuses")}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 max-h-[600px] space-y-2 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {visibleTasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
                {t("tasks.noTasks")}
              </div>
            ) : (
              visibleTasks.map((task) => {
                const accent = PRIORITY_COLORS[task.priority];
                const statusColor = STATUS_COLORS[task.status];
                const updating = busyKey === `status-${task.id}` || busyKey === `delete-${task.id}`;
                const rowAudit = getManagerTaskRowAuditText(task, workerNameById, {
                  unassigned: t("tasks.unassigned"),
                  unknown: t("tasks.unknown"),
                  formatCompletedAt: formatDateTime,
                });
                return (
                  <article
                    key={task.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {task.title}
                          </span>
                          <span
                            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                            style={{ background: `${accent}1f`, color: accent }}
                          >
                            {priorityLabel(task.priority)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                          {task.project_id ? (
                            <Link href={`/projects/${task.project_id}`} className="text-[var(--brand-yellow)]">
                              {task.projectName ?? t("tasks.generalTask")}
                            </Link>
                          ) : (
                            <span>{t("tasks.generalTask")}</span>
                          )}
                          <span>·</span>
                          <span>{t("tasks.assignedToLabel")}:</span>
                          {task.assigned_to ? (
                            <Link
                              href={`/team/${task.assigned_to}`}
                              className="text-[var(--text-primary)]"
                            >
                              {rowAudit.assignedToText}
                            </Link>
                          ) : (
                            <span>{rowAudit.assignedToText}</span>
                          )}
                          {task.due_date ? (
                            <>
                              <span>·</span>
                              <span className="font-mono">{t("tasks.due")} {task.due_date}</span>
                            </>
                          ) : null}
                        </div>
                        {task.status === "done" ? (
                          <div
                            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--text-primary)]"
                            data-testid="manager-task-row-completion-audit"
                          >
                            <span>
                              {t("tasks.rowAssignedLabel")}: {rowAudit.assignedToText}
                            </span>
                            <span>
                              {t("tasks.rowCompletedByLabel")}: {rowAudit.completedByText}
                            </span>
                            <span>
                              {t("tasks.rowCompletedAtLabel")}: {rowAudit.completedAtText}
                            </span>
                          </div>
                        ) : null}
                        {task.description ? (
                          <p className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">
                            {task.description}
                          </p>
                        ) : null}
                        {(() => {
                          const refs = getAttachmentMediaIds(task)
                            .map((id) => attachmentById.get(id))
                            .filter((m): m is TaskAttachmentRef => Boolean(m));
                          if (refs.length === 0) return null;
                          return (
                            <>
                              <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                                📎 {refs.length} {t("tasks.filesShort")}
                              </div>
                              <TaskAttachmentList items={refs} />
                            </>
                          );
                        })()}
                        {(() => {
                          // Worker completion evidence — same shape as
                          // the Project Detail page panel, condensed for
                          // the All Tasks list view.
                          const completionNote = getCompletionNote(task);
                          const followUp = getFollowUpInfo(task);
                          const audit = getTaskCompletionAudit(task, workerNameById);
                          const completionRefs = getCompletionMediaIds(task)
                            .map((id) => attachmentById.get(id))
                            .filter((m): m is TaskAttachmentRef => Boolean(m));
                          const hasEvidence =
                            Boolean(completionNote) ||
                            followUp.required ||
                            completionRefs.length > 0 ||
                            audit.hasAudit;
                          if (!hasEvidence) return null;
                          return (
                            <div
                              className="mt-2 rounded-[var(--radius-md)] border p-2"
                              style={{
                                borderColor: followUp.required
                                  ? "rgba(245, 158, 11, 0.35)"
                                  : "rgba(15, 168, 120, 0.24)",
                                background: followUp.required
                                  ? "rgba(245, 158, 11, 0.06)"
                                  : "rgba(15, 168, 120, 0.06)",
                              }}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                  {t("tasks.completionEvidenceHeader")}
                                </span>
                                {task.status === "done" ? (
                                  <span
                                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                                    style={{
                                      background: "rgba(15, 168, 120, 0.16)",
                                      color: "var(--green)",
                                    }}
                                  >
                                    {statusLabel(task.status)}
                                  </span>
                                ) : null}
                                {followUp.required ? (
                                  <span
                                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                                    style={{
                                      background: "rgba(245, 158, 11, 0.16)",
                                      color: "#f59e0b",
                                    }}
                                  >
                                    {t("tasks.followUpBadge")}
                                  </span>
                                ) : null}
                              </div>
                              {audit.completedById ? (
                                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                                  {t("tasks.completionByLabel")}:{" "}
                                  {audit.completedByName ?? audit.completedById}
                                </div>
                              ) : null}
                              {audit.completedAt ? (
                                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                                  {t("tasks.completionAtLabel")}: {formatDateTime(audit.completedAt)}
                                </div>
                              ) : null}
                              {completionNote ? (
                                <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text-primary)]">
                                  {completionNote}
                                </p>
                              ) : null}
                              {followUp.required && followUp.note ? (
                                <div className="mt-1 text-[10px] text-[var(--text-secondary)]">
                                  <span className="font-semibold">
                                    {t("tasks.followUpNoteLabel")}:{" "}
                                  </span>
                                  {followUp.note}
                                </div>
                              ) : null}
                              {completionRefs.length > 0 ? (
                                <TaskAttachmentList items={completionRefs} />
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <select
                          value={task.status}
                          onChange={(e) => void handleStatusChange(task.id, e.target.value as TaskStatus)}
                          disabled={updating}
                          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-semibold uppercase outline-none"
                          style={{ color: statusColor }}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(status)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleDelete(task.id)}
                          disabled={updating}
                          aria-label={t("team.actionRemove")}
                          title={t("team.actionRemove")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                          style={{
                            borderColor:
                              pendingDeleteTaskId === task.id
                                ? "var(--red)"
                                : "rgba(212, 81, 94, 0.3)",
                            color: "var(--red)",
                            background:
                              pendingDeleteTaskId === task.id
                                ? "rgba(212, 81, 94, 0.12)"
                                : "transparent",
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
