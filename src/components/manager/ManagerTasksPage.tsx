"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { logAudit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { DateField } from "@/components/shared/DateField";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import {
  buildProfileNameMap,
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
  getTaskCompletionAudit,
} from "@/lib/task-notifications";
import {
  getAttachmentMediaIds,
  type TaskAttachmentRef,
} from "@/lib/task-attachments";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { formatDateTime } from "@/lib/worker-utils";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";
import {
  getEffectiveTaskStatus,
  isEffectiveCompletedTask,
} from "@/lib/task-status";
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
  managerName,
  managerRole,
  projects,
  workers,
  initialTasks,
  attachmentMedia = [],
  embedded = false,
}: {
  orgId: string;
  managerId: string;
  managerName: string;
  managerRole: UserRole;
  projects: ProjectOption[];
  workers: WorkerOption[];
  initialTasks: TaskRow[];
  attachmentMedia?: TaskAttachmentRef[];
  embedded?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { t } = useTranslation();

  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | "info">("success");
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null);
  const [pendingClearDone, setPendingClearDone] = useState(false);

  const [filterProject, setFilterProject] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  const workerNameById = useMemo(() => buildProfileNameMap(workers), [workers]);
  const attachmentById = useMemo(
    () => new Map(attachmentMedia.map((m) => [m.id, m])),
    [attachmentMedia],
  );

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterProject && task.project_id !== filterProject) return false;
      if (filterStatus && getEffectiveTaskStatus(task) !== filterStatus) return false;
      return true;
    });
  }, [tasks, filterProject, filterStatus]);
  const completedTasks = useMemo(
    () => tasks.filter(isEffectiveCompletedTask),
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

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = formData.get("title")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() ?? "";
    const projectId = formData.get("project_id")?.toString() ?? "";
    const assignedTo = formData.get("assigned_to")?.toString() ?? "";
    const priorityValue = formData.get("priority")?.toString() ?? "medium";
    const priority: TaskPriority =
      priorityValue === "low" ||
      priorityValue === "medium" ||
      priorityValue === "high" ||
      priorityValue === "urgent"
        ? priorityValue
        : "medium";
    const dueDate = formData.get("due_date")?.toString() ?? "";

    if (title.length < 2) {
      setMessage(t("projectDetail.taskTitleRequired"));
      setMessageTone("error");
      return;
    }

    setBusyKey("create-task");
    setMessage("");
    const response = await fetch("/api/manager/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        projectId: projectId || null,
        assignedTo: assignedTo || null,
        priority,
        dueDate: dueDate || null,
        source: "manager_tasks_page",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      task?: Task;
    };
    setBusyKey(null);

    if (!response.ok || !result.task?.id) {
      setMessage(result.error ?? t("tasks.createTaskFailed"));
      setMessageTone("error");
      return;
    }

    const task = result.task;
    const nextRow: TaskRow = {
      ...task,
      projectName: task.project_id
        ? projects.find((project) => project.id === task.project_id)?.name ?? null
        : null,
      assigneeName: task.assigned_to
        ? workers.find((worker) => worker.id === task.assigned_to)?.name ?? null
        : null,
      completedByName: task.completed_by
        ? workers.find((worker) => worker.id === task.completed_by)?.name ?? null
        : null,
    };
    setTasks((prev) => [nextRow, ...prev.filter((existing) => existing.id !== task.id)]);
    form.reset();
    setMessage(t("tasks.created"));
    setMessageTone("success");
    router.refresh();
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    setBusyKey(`status-${taskId}`);
    const previousTask = tasks.find((task) => task.id === taskId) ?? null;
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
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "task_status_changed",
      targetType: "task",
      targetId: taskId,
      beforeData: previousTask
        ? {
            title: previousTask.title,
            project_id: previousTask.project_id,
            assigned_to: previousTask.assigned_to,
            status: previousTask.status,
            effective_status: getEffectiveTaskStatus(previousTask),
            completed_at: previousTask.completed_at,
            completed_by: previousTask.completed_by,
          }
        : null,
      afterData: {
        title: previousTask?.title ?? null,
        project_id: previousTask?.project_id ?? null,
        assigned_to: previousTask?.assigned_to ?? null,
        status,
        completed_at: completedAt,
        completed_by: completedBy,
      },
    });
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
    const previousTask = tasks.find((task) => task.id === taskId) ?? null;
    const deletedAt = new Date().toISOString();
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: deletedAt })
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
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "task_deleted",
      targetType: "task",
      targetId: taskId,
      beforeData: previousTask
        ? {
            title: previousTask.title,
            project_id: previousTask.project_id,
            assigned_to: previousTask.assigned_to,
            status: previousTask.status,
            completed_at: previousTask.completed_at,
          }
        : null,
      afterData: {
        deleted_at: deletedAt,
      },
    });
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
    const deletedAt = new Date().toISOString();
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: deletedAt })
      .in("id", ids);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setPendingClearDone(false);
    setTasks((prev) => prev.filter((task) => !isEffectiveCompletedTask(task)));
    setMessage(t("tasks.completedCleared").replace("{count}", String(ids.length)));
    setMessageTone("success");
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "tasks_completed_cleared",
      targetType: "task",
      beforeData: {
        task_ids: ids,
        count: ids.length,
      },
      afterData: {
        deleted_at: deletedAt,
      },
    });
  }

  return (
    <div className={embedded ? "space-y-5" : "mx-auto max-w-[1400px] space-y-5 p-5"}>
      {!embedded ? (
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
      ) : null}

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
            {t("tasks.createTaskHelp")}
          </p>
          <form className="mt-4 grid gap-3" onSubmit={handleCreateTask}>
            <TextInputWithVoice
              name="title"
              placeholder={t("projectDetail.taskTitle")}
              required
              maxLength={180}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <TextInputWithVoice
              multiline
              name="description"
              rows={4}
              placeholder={t("tasks.descriptionPlaceholder")}
              className="min-h-[96px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("tasks.projectLabel")}
              </span>
              <select
                name="project_id"
                className="min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("common.generalTask")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {t("tasks.assignedToLabel")}
              </span>
              <select
                name="assigned_to"
                className="min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("common.unassigned")}</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name}
                  </option>
                ))}
              </select>
              {workers.length === 0 ? (
                <span className="text-[10px] text-[var(--text-muted)]">
                  {t("tasks.noWorkersAvailable")}
                </span>
              ) : null}
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {t("messages.priority")}
                </span>
                <select
                  name="priority"
                  defaultValue="medium"
                  className="min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                >
                  <option value="low">{t("tasks.priorityLow")}</option>
                  <option value="medium">{t("tasks.priorityMedium")}</option>
                  <option value="high">{t("tasks.priorityHigh")}</option>
                  <option value="urgent">{t("tasks.priorityUrgent")}</option>
                </select>
              </label>
              <DateField
                name="due_date"
                label={t("tasks.dueDateLabel")}
                className="min-h-12 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busyKey === "create-task"}
              className="button-base button-primary"
            >
              {busyKey === "create-task" ? t("common.creating") : t("projectDetail.createTask")}
            </button>
          </form>
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
                const effectiveStatus = getEffectiveTaskStatus(task);
                const accent = PRIORITY_COLORS[task.priority];
                const statusColor = STATUS_COLORS[effectiveStatus];
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
                          {rowAudit.seenByText ? (
                            <>
                              <span>·</span>
                              <span>
                                {t("tasks.rowSeenByLabel")}: {rowAudit.seenByText}
                                {rowAudit.seenAtText ? ` · ${rowAudit.seenAtText}` : ""}
                              </span>
                            </>
                          ) : null}
                          {rowAudit.startedByText ? (
                            <>
                              <span>·</span>
                              <span>
                                {t("tasks.rowStartedByLabel")}: {rowAudit.startedByText}
                                {rowAudit.startedAtText ? ` · ${rowAudit.startedAtText}` : ""}
                              </span>
                            </>
                          ) : null}
                        </div>
                        {effectiveStatus === "done" ? (
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
                                {effectiveStatus === "done" ? (
                                  <span
                                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]"
                                    style={{
                                      background: "rgba(15, 168, 120, 0.16)",
                                      color: "var(--green)",
                                    }}
                                  >
                                    {statusLabel(effectiveStatus)}
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
                          value={effectiveStatus}
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
