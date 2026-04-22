"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Play } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import type { WorkerTaskItem } from "@/lib/worker-types";

export function TasksPage() {
  const { shell, busyAction, updateTaskStatus } = useWorkerShell();
  const { t } = useTranslation();
  const [bumpedTaskId, setBumpedTaskId] = useState<string | null>(null);
  const activeTasks = shell.tasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  );
  const doneTasks = shell.tasks.filter((task) => task.status === "done");

  // Group by project name so the header above each block makes the
  // global-vs-per-project distinction obvious. Order of insertion is
  // preserved, which matches shell.tasks order (newest first).
  const activeByProject = useMemo(() => {
    const map = new Map<string, WorkerTaskItem[]>();
    for (const task of activeTasks) {
      const key = task.projectName ?? t("common.general");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return map;
  }, [activeTasks, t]);

  const doneByProject = useMemo(() => {
    const map = new Map<string, WorkerTaskItem[]>();
    for (const task of doneTasks) {
      const key = task.projectName ?? t("common.general");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(task);
    }
    return map;
  }, [doneTasks, t]);

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
            <div className="task-title text-sm font-semibold text-[var(--text-primary)]">
              {task.title}
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              {task.projectName ?? t("common.general")} • {task.status.replace("_", " ")}
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
          {task.status === "pending" ? (
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
          <button
            type="button"
            onClick={() => {
              bumpTask(task.id);
              void updateTaskStatus(task.id, "done");
            }}
            disabled={updating}
            className="button-base button-primary flex-1"
          >
            <CheckCircle2 size={14} />
            {updating ? t("common.saving") : t("tasks.markDone")}
          </button>
        </div>
      </div>
    );
  }

  function renderDoneCard(task: WorkerTaskItem) {
    return (
      <div
        key={task.id}
        data-complete="true"
        className="task-card surface-panel p-3"
        style={{ "--task-accent": "var(--green)" } as CSSProperties}
      >
        <div className="task-title text-sm font-semibold text-[var(--text-primary)]">
          {task.title}
        </div>
        <div className="mt-1 text-xs text-[var(--text-secondary)]">
          {task.projectName ?? t("common.general")} • {t("tasks.done")}
        </div>
      </div>
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
          {t("tasks.assignedTasks")}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t("tasks.allYourTasksAcrossProjects")}
        </p>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-[var(--text-primary)]">{t("common.open")}</div>
          <div className="text-xs text-[var(--text-muted)]">{activeTasks.length} {t("tasks.items")}</div>
        </div>
        <div className="mt-4 space-y-5">
          {activeTasks.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {t("tasks.nothingOpen")}
            </div>
          ) : (
            Array.from(activeByProject.entries()).map(([projectName, tasks]) => (
              <div key={projectName} className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {projectName} <span className="opacity-60">· {tasks.length}</span>
                </div>
                {tasks.map(renderActiveCard)}
              </div>
            ))
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
            Array.from(doneByProject.entries()).map(([projectName, tasks]) => (
              <div key={projectName} className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {projectName} <span className="opacity-60">· {tasks.length}</span>
                </div>
                {tasks.map(renderDoneCard)}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
