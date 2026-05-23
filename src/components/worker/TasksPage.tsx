"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, Play } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { WorkerTaskDetailModal } from "@/components/worker/WorkerTaskDetailModal";
import {
  applyClaimedTaskAssignment,
  classifyTaskForWorker,
  groupWorkerTasksByProject,
} from "@/lib/task-notifications";
import { canUseDriverMaterialView } from "@/lib/material-driver-permissions";
import {
  getMaterialTaskMaterialName,
  getMaterialTaskNeededDate,
  getMaterialTaskUrgency,
  isMaterialTask,
} from "@/lib/material-tasks";
import {
  getEffectiveTaskStatus,
  isEffectiveCompletedTask,
  isEffectiveOpenTask,
} from "@/lib/task-status";
import {
  openWorkerTaskCompletion,
  submitWorkerTaskCompletion,
  type WorkerTaskModalMode,
} from "@/lib/worker-task-ui";
import type { WorkerTaskItem } from "@/lib/worker-types";

type TaskFilter = "all" | "mine" | "urgent" | "today";
// "" = all projects, "__current__" = the project the worker is clocked in
// to right now (resolves at render time so a switch updates it),
// otherwise a literal project_id. Stored as string for trivial <select>
// binding.
type ProjectFilter = string;

export function TasksPage() {
  const { shell, busyAction, updateTaskStatus, markTasksSeen } = useWorkerShell();
  const { t } = useTranslation();
  const [bumpedTaskId, setBumpedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  // "" = all projects, "__current__" = follow the live clock-in, else a project id.
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>("");
  const [selectedTask, setSelectedTask] = useState<WorkerTaskItem | null>(null);
  const [selectedTaskMode, setSelectedTaskMode] = useState<WorkerTaskModalMode>("details");
  const [claimedTaskAssignees, setClaimedTaskAssignees] = useState<Map<string, string | null>>(
    () => new Map(),
  );
  const [claimedTaskMetadata, setClaimedTaskMetadata] = useState<
    Map<string, Record<string, unknown> | null>
  >(() => new Map());
  // Tasks the worker just completed via the modal that returned ok=true.
  // We override their status to "done" in the rendered list so the card
  // moves into «Завершено» without waiting for the WorkerShell context
  // re-render or an F5. Mirrors the claimedTaskAssignees / Metadata
  // override-Map pattern already used here, and parallels
  // WorkerProjectView's markLocalTask. Only populated AFTER
  // updateTaskStatus resolves true — a failed mutation never lands here,
  // so the UI never lies about completion.
  const [locallyCompletedTaskIds, setLocallyCompletedTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openError, setOpenError] = useState<string | null>(null);
  const [claimBusyTaskId, setClaimBusyTaskId] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const todayIsoRef = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const currentProjectId = shell.clockState.currentProjectId;
  const driverMaterialView = canUseDriverMaterialView(shell.profile);

  // Visiting /my-tasks acknowledges all currently-pending task
  // notifications. Stored in localStorage by markTasksSeen so future
  // renders only flag genuinely-new tasks. Run once per mount —
  // re-renders during the visit must not push the marker forward
  // before the worker has a chance to look at the list.
  useEffect(() => {
    markTasksSeen();
  }, [markTasksSeen]);

  // Open the modal with the task object directly. Storing the object
  // (not just the id) means clicks always render a visible modal even
  // if the live task list churns mid-interaction.
  function openDetails(
    task: WorkerTaskItem | null | undefined,
    mode: WorkerTaskModalMode = "details",
  ) {
    if (!task) {
      setOpenError(t("tasks.openDetailsFailed"));
      return;
    }
    setOpenError(null);
    setSelectedTaskMode(mode);
    setSelectedTask(task);
  }

  function closeDetails() {
    setSelectedTask(null);
    setSelectedTaskMode("details");
    setOpenError(null);
  }

  function openCompletion(task: WorkerTaskItem) {
    openWorkerTaskCompletion(task, openDetails);
  }

  // Claim a project-level (assigned_to=null) task from /my-tasks. The
  // /api/worker/claim-task route does the RLS-bypassing UPDATE through
  // the admin client (see WorkerProjectView for the same pattern). On
  // success we mirror the new assigned_to into the local shell so the
  // detail modal re-renders with isMine=true and the Start/Done
  // buttons appear.
  async function handleClaimTask(taskId: string) {
    setClaimBusyTaskId(taskId);
    setClaimMessage(null);
    try {
      const response = await fetch("/api/worker/claim-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        task?: {
          id: string;
          assigned_to: string | null;
          metadata?: Record<string, unknown> | null;
        };
      };
      if (!response.ok) {
        const fallback =
          response.status === 409
            ? t("tasks.claimAlreadyAssigned")
            : t("tasks.claimFailed");
        setClaimMessage({ kind: "err", text: payload.error ?? fallback });
        return;
      }
      const claimed = payload.task;
      if (!claimed) {
        setClaimMessage({ kind: "err", text: t("tasks.claimFailed") });
        return;
      }
      // Update the modal's task object too — the live lookup against
      // shell.tasks will pick up the new assignment on the next
      // render, but the snapshot needs to flip immediately so the
      // Claim button hides without flicker.
      setSelectedTask((current) =>
        current && current.id === claimed.id
          ? {
              ...current,
              assigned_to: claimed.assigned_to,
              metadata: claimed.metadata ?? current.metadata,
            }
          : current,
      );
      setClaimedTaskAssignees((current) => {
        const next = new Map(current);
        next.set(claimed.id, claimed.assigned_to);
        return next;
      });
      setClaimedTaskMetadata((current) => {
        const next = new Map(current);
        next.set(claimed.id, claimed.metadata ?? null);
        return next;
      });
      setClaimMessage({ kind: "ok", text: t("tasks.claimed") });
    } catch {
      setClaimMessage({ kind: "err", text: t("tasks.claimFailed") });
    } finally {
      setClaimBusyTaskId(null);
    }
  }

  // Resolve the project filter into a concrete project_id (or null = all).
  // "__current__" follows the live clock-in so the filter "tracks" as the
  // worker switches projects.
  const resolvedProjectId =
    projectFilter === ""
      ? null
      : projectFilter === "__current__"
        ? currentProjectId
        : projectFilter;

  function filterMatch(task: WorkerTaskItem): boolean {
    if (resolvedProjectId && task.project_id !== resolvedProjectId) return false;
    if (filter === "all") return true;
    if (filter === "mine") return task.assigned_to === shell.profile.id;
    if (filter === "urgent") return task.priority === "urgent" || task.priority === "high";
    if (filter === "today") {
      return Boolean(task.due_date && task.due_date.slice(0, 10) === todayIsoRef);
    }
    return true;
  }

  const taskList = useMemo(() => {
    if (
      claimedTaskAssignees.size === 0 &&
      claimedTaskMetadata.size === 0 &&
      locallyCompletedTaskIds.size === 0
    ) {
      return shell.tasks;
    }
    let next = shell.tasks;
    for (const [taskId, assignedTo] of claimedTaskAssignees.entries()) {
      next = applyClaimedTaskAssignment(next, taskId, assignedTo);
    }
    if (claimedTaskMetadata.size > 0) {
      next = next.map((task) =>
        claimedTaskMetadata.has(task.id)
          ? { ...task, metadata: claimedTaskMetadata.get(task.id) ?? task.metadata }
          : task,
      );
    }
    if (locallyCompletedTaskIds.size > 0) {
      // Override status (and the canonical completed_* columns) for any
      // task the worker just finished via the modal. We keep whatever
      // shell.tasks already has if those columns are filled — they will
      // be once the WorkerShell setShell propagates — and only synthesize
      // a value when the row hasn't caught up yet. completed_by uses the
      // current worker since this override only runs on success and the
      // mutator stamped the same id.
      const nowIso = new Date().toISOString();
      next = next.map((task) =>
        locallyCompletedTaskIds.has(task.id)
          ? {
              ...task,
              status: "done",
              completed_at: task.completed_at ?? nowIso,
              completed_by: task.completed_by ?? shell.profile.id,
            }
          : task,
      );
    }
    return next;
  }, [
    shell.tasks,
    claimedTaskAssignees,
    claimedTaskMetadata,
    locallyCompletedTaskIds,
    shell.profile.id,
  ]);

  const activeTasks = taskList
    .filter(isEffectiveOpenTask)
    .filter(filterMatch);
  const doneTasks = taskList
    .filter(isEffectiveCompletedTask)
    .filter((task) =>
      resolvedProjectId ? task.project_id === resolvedProjectId : true,
    );
  // Refresh from the live shell.tasks list when we can, so status/attachment
  // edits made while the modal is open are reflected. Fall back to the
  // stored snapshot if the task has been removed from the list.
  const liveSelectedTask = selectedTask
    ? taskList.find((task) => task.id === selectedTask.id) ?? selectedTask
    : null;

  // Done-counts per project across ALL tasks (filter-independent) so the
  // progress bar's denominator reflects total project scope, not the
  // currently-visible slice.
  const projectCounts = useMemo(() => {
    const counts = new Map<string, { done: number; total: number }>();
    for (const task of taskList) {
      const key = task.project_id ?? "__noproject__";
      const entry = counts.get(key) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (isEffectiveCompletedTask(task)) entry.done += 1;
      counts.set(key, entry);
    }
    return counts;
  }, [taskList]);

  const activeByProject = useMemo(
    () =>
      groupWorkerTasksByProject(activeTasks, {
        currentProjectId,
        generalLabel: t("common.general"),
      }),
    [activeTasks, currentProjectId, t],
  );
  const doneByProject = useMemo(
    () =>
      groupWorkerTasksByProject(doneTasks, {
        currentProjectId,
        generalLabel: t("common.general"),
      }),
    [doneTasks, currentProjectId, t],
  );

  function bumpTask(taskId: string) {
    setBumpedTaskId(taskId);
    window.setTimeout(() => {
      setBumpedTaskId((current) => (current === taskId ? null : current));
    }, 180);
  }

  function getPriorityAccent(priority: string) {
    if (priority === "urgent" || priority === "high") {
      return "#ef4444";
    }

    if (priority === "medium") {
      return "#f59e0b";
    }

    return "#22c55e";
  }

  function renderActiveCard(task: WorkerTaskItem) {
    const updating = busyAction === `task-${task.id}`;
    const accent = getPriorityAccent(task.priority);
    const ownership = classifyTaskForWorker(task, shell.profile.id);
    const effectiveStatus = getEffectiveTaskStatus(task);
    const isMine = task.assigned_to === shell.profile.id;
    const isClaimable = task.assigned_to === null;
    const materialTask = isMaterialTask(task);
    const materialUrgency = getMaterialTaskUrgency(task);
    const materialNeededDate = getMaterialTaskNeededDate(task);
    const materialName = getMaterialTaskMaterialName(task);

    return (
      <div
        key={task.id}
        data-bump={bumpedTaskId === task.id}
        className="task-card surface-panel p-3"
        style={
          {
            "--task-accent": accent,
            background:
              task.status === "in_progress"
                ? "linear-gradient(180deg, rgba(191, 162, 52, 0.06), rgba(15, 17, 23, 0.96))"
                : "rgba(15, 17, 23, 0.82)",
          } as CSSProperties
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => openDetails(task)}
              data-testid="worker-task-open-details"
              className="task-title text-left text-sm font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline focus:underline"
            >
              {task.title}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              {ownership === "personal" ? (
                <span
                  className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ background: "rgba(191, 162, 52, 0.14)", color: "var(--brand-yellow)" }}
                >
                  {t("tasks.labelMyTask")}
                </span>
              ) : ownership === "project" ? (
                <span
                  className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{ background: "rgba(59, 130, 246, 0.14)", color: "#3b82f6" }}
                >
                  {t("tasks.labelProjectTask")}
                </span>
              ) : null}
              {materialTask ? (
                <span
                  className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                  style={{
                    background:
                      materialUrgency === "urgent"
                        ? "rgba(239, 68, 68, 0.14)"
                        : "rgba(191, 162, 52, 0.14)",
                    color:
                      materialUrgency === "urgent"
                        ? "var(--red)"
                        : "var(--brand-yellow)",
                  }}
                >
                  {materialUrgency === "urgent"
                    ? t("materials.projectBadgeUrgent")
                    : t("materials.materialTask")}
                </span>
              ) : null}
              <span>{task.projectName ?? t("common.general")} • {effectiveStatus.replace("_", " ")}</span>
              {task.due_date ? (() => {
                const dueIso = task.due_date.slice(0, 10);
                const overdue = dueIso < todayIsoRef && effectiveStatus !== "done";
                return (
                  <span
                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: overdue ? "rgba(212, 81, 94, 0.14)" : "rgba(148, 163, 184, 0.12)",
                      color: overdue ? "var(--red)" : "var(--text-muted)",
                    }}
                    title={t("tasks.dueDate")}
                  >
                    {overdue ? "⚠ " : "📅 "}
                    {dueIso}
                  </span>
                );
              })() : null}
              {task.attachments && task.attachments.length > 0 ? (
                <span
                  className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "rgba(191, 162, 52, 0.14)", color: "var(--brand-yellow)" }}
                  title={t("tasks.filesShort")}
                >
                  📎 {task.attachments.length}
                </span>
              ) : null}
            </div>
          </div>
          <span
            className="shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ background: `${accent}18`, color: accent }}
          >
            {task.priority}
          </span>
        </div>

        {task.description ? (
          <p className="mt-3 text-sm text-[var(--text-secondary)]">{task.description}</p>
        ) : null}
        {materialTask ? (
          <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(191,162,52,0.28)] bg-[rgba(191,162,52,0.08)] p-2 text-xs text-[var(--text-secondary)]">
            <div className="font-semibold text-[var(--text-primary)]">
              {t("materials.materialTask")}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {materialName ? (
                <span>
                  {t("materials.name")}: {materialName}
                </span>
              ) : null}
              <span>
                {materialUrgency === "urgent" ? t("materials.urgent") : t("materials.notUrgent")}
              </span>
              {materialNeededDate ? (
                <span>
                  {t("materials.neededDate")}: {materialNeededDate}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {task.attachments && task.attachments.length > 0 ? (
          <>
            <div className="mt-2 text-[10px] text-[var(--text-muted)]">
              📎 {task.attachments.length} {t("tasks.filesShort")}
            </div>
            <TaskAttachmentList items={task.attachments} />
          </>
        ) : null}

        {task.project_id ? (
          <div className="mt-3">
            <Link
              href={`/project/${task.project_id}`}
              className="inline-block text-xs font-semibold text-[var(--brand-yellow)]"
            >
              {t("workerProject.openProject")} →
            </Link>
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => openDetails(task)}
            data-testid="worker-task-open-details"
            className="button-base button-secondary flex-1"
          >
            <Eye size={14} />
            {t("tasks.viewDetails")}
          </button>
          {isMine && task.status === "pending" ? (
            <button
              type="button"
              onClick={() => void updateTaskStatus(task.id, "in_progress")}
              disabled={updating}
              className="button-base button-secondary flex-1"
            >
              <Play size={14} />
              {t("common.start")}
            </button>
          ) : null}
          {isMine ? (
            <button
              type="button"
              onClick={() => openCompletion(task)}
              disabled={updating}
              data-testid="worker-task-mark-done-card"
              className="button-base button-primary flex-1"
            >
              <CheckCircle2 size={14} />
              {updating ? t("common.saving") : t("tasks.markDone")}
            </button>
          ) : isClaimable ? (
            <button
              type="button"
              onClick={() => void handleClaimTask(task.id)}
              disabled={claimBusyTaskId === task.id}
              className="button-base button-primary flex-1"
            >
              <Play size={14} />
              {claimBusyTaskId === task.id ? t("common.saving") : t("tasks.claimCta")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderDoneCard(task: WorkerTaskItem) {
    const materialTask = isMaterialTask(task);
    const materialNeededDate = getMaterialTaskNeededDate(task);
    return (
      <button
        type="button"
        onClick={() => openDetails(task)}
        data-testid="worker-task-open-details"
        key={task.id}
        data-complete="true"
        className="task-card surface-panel block w-full p-3 text-left"
        style={{ "--task-accent": "var(--green)" } as CSSProperties}
      >
        <div className="task-title text-sm font-semibold text-[var(--text-primary)]">
          {task.title}
        </div>
        <div className="mt-1 text-xs text-[var(--text-secondary)]">
          {task.projectName ?? t("common.general")} • {t("tasks.done")}
          {materialTask ? ` • ${t("materials.materialTask")}` : ""}
          {materialTask && materialNeededDate ? ` • ${materialNeededDate}` : ""}
        </div>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("tasks.workQueue")}
          </p>
          <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            {t("tasks.scopeGlobalChip")}
          </span>
        </div>
        <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
          {driverMaterialView ? t("tasks.driverMaterialQueueTitle") : t("tasks.assignedTasks")}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {driverMaterialView
            ? t("tasks.driverMaterialQueueDescription")
            : t("tasks.allYourTasksAcrossProjects")}
        </p>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-[var(--text-primary)]">{t("common.open")}</div>
          <div className="text-xs text-[var(--text-muted)]">{activeTasks.length} {t("tasks.items")}</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(["all", "mine", "urgent", "today"] as const).map((key) => {
            const selected = filter === key;
            const label =
              key === "all"
                ? t("tasks.filterAll")
                : key === "mine"
                  ? t("tasks.filterMine")
                  : key === "urgent"
                    ? t("tasks.filterUrgent")
                    : t("tasks.filterToday");
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={selected}
                className="rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                  background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                  color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
                }}
              >
                {label}
              </button>
            );
          })}
          {/* Project filter — narrows the list and the chronology
              grouping in lockstep. "Current project" tracks the live
              clock-in so a worker who switches projects sees the new
              tasks without re-selecting. */}
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            aria-label={t("tasks.projectFilterLabel")}
            className="rounded-[var(--radius-pill)] border border-[var(--border-default)] bg-transparent px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] outline-none"
          >
            <option value="">{t("tasks.projectFilterAll")}</option>
            {currentProjectId ? (
              <option value="__current__">{t("tasks.projectFilterCurrent")}</option>
            ) : null}
            {shell.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 space-y-5">
          {activeTasks.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {filter === "all"
                ? t("tasks.nothingOpen")
                : filter === "mine"
                  ? t("tasks.emptyMine")
                  : filter === "urgent"
                    ? t("tasks.emptyUrgent")
                    : t("tasks.emptyToday")}
            </div>
          ) : (
            activeByProject.map((bucket) => {
              const counts = projectCounts.get(bucket.key) ?? { done: 0, total: 0 };
              const pct = counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0;
              const displayName =
                bucket.key === "__noproject__" ? t("tasks.noProjectSection") : bucket.name;
              return (
                <div key={bucket.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {displayName}{" "}
                      <span className="opacity-60">
                        · {counts.done} / {counts.total} {t("tasks.progressDone")}
                      </span>
                    </div>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(148, 163, 184, 0.18)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--green)" }} />
                  </div>
                  {bucket.tasks.map(renderActiveCard)}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="surface-card surface-card--muted p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-[var(--text-primary)]">{t("tasks.completedSection")}</div>
          <div className="text-xs text-[var(--text-muted)]">{doneTasks.length} {t("tasks.items")}</div>
        </div>
        <div className="mt-4 space-y-5">
          {doneTasks.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {t("tasks.completedWillLand")}
            </div>
          ) : (
            doneByProject.map((bucket) => {
              const displayName =
                bucket.key === "__noproject__" ? t("tasks.noProjectSection") : bucket.name;
              return (
                <div key={bucket.key} className="space-y-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {displayName} <span className="opacity-60">· {bucket.tasks.length}</span>
                  </div>
                  {bucket.tasks.map(renderDoneCard)}
                </div>
              );
            })
          )}
        </div>
      </section>

      {openError ? (
        <div
          role="alert"
          data-testid="worker-task-open-error"
          className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
          style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
        >
          {openError}
        </div>
      ) : null}

      {claimMessage ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
          style={{
            background:
              claimMessage.kind === "ok"
                ? "rgba(15, 168, 120, 0.16)"
                : "rgba(212, 81, 94, 0.12)",
            color: claimMessage.kind === "ok" ? "var(--green)" : "var(--red)",
          }}
        >
          {claimMessage.text}
        </div>
      ) : null}

      <WorkerTaskDetailModal
        task={liveSelectedTask}
        initialMode={selectedTaskMode}
        profileId={shell.profile.id}
        busy={
          liveSelectedTask
            ? busyAction === `task-${liveSelectedTask.id}` ||
              claimBusyTaskId === liveSelectedTask.id
            : false
        }
        onClose={closeDetails}
        onStart={(taskId) => {
          void updateTaskStatus(taskId, "in_progress");
        }}
        onDone={(taskId, payload) => {
          bumpTask(taskId);
          submitWorkerTaskCompletion(
            async (id, status, completionPayload) => {
              const ok = await updateTaskStatus(id, status, {
                ...completionPayload,
                // The completion modal is the only legitimate caller for
                // status="done" — the guard inside updateTaskStatus
                // refuses any done-mutation that lacks this flag.
                submittedFromCompletionModal: true,
                projectId: liveSelectedTask?.project_id ?? null,
                existingMetadata: liveSelectedTask?.metadata ?? null,
              });
              if (ok) {
                // Successful DB write — record the id so the taskList
                // useMemo overrides this row's status to "done" on the
                // very next render. Mirrors WorkerProjectView's
                // markLocalTask(id, "done"), gated on the same ok=true
                // signal so a failed mutation never lies in the UI.
                setLocallyCompletedTaskIds((prev) => {
                  const nextSet = new Set(prev);
                  nextSet.add(id);
                  return nextSet;
                });
              }
            },
            taskId,
            payload,
          );
        }}
        onClaim={(taskId) => void handleClaimTask(taskId)}
      />
    </div>
  );
}
