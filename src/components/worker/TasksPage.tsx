"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Play } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import type { WorkerTaskItem } from "@/lib/worker-types";

type TaskFilter = "all" | "mine" | "urgent" | "today";

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

type ProjectBucket = {
  key: string;
  name: string;
  tasks: WorkerTaskItem[];
};

function groupByProject(
  tasks: WorkerTaskItem[],
  generalLabel: string,
): ProjectBucket[] {
  const map = new Map<string, ProjectBucket>();
  for (const task of tasks) {
    const key = task.project_id ?? "__noproject__";
    const name = task.projectName ?? generalLabel;
    const bucket = map.get(key) ?? { key, name, tasks: [] };
    bucket.tasks.push(task);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.tasks.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }
  const entries = [...map.values()];
  entries.sort((a, b) => {
    if (a.key === "__noproject__") return 1;
    if (b.key === "__noproject__") return -1;
    return 0;
  });
  return entries;
}

export function TasksPage() {
  const { shell, busyAction, updateTaskStatus } = useWorkerShell();
  const { t } = useTranslation();
  const [bumpedTaskId, setBumpedTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");

  const todayIsoRef = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function filterMatch(task: WorkerTaskItem): boolean {
    if (filter === "all") return true;
    if (filter === "mine") return task.assigned_to === shell.profile.id;
    if (filter === "urgent") return task.priority === "urgent" || task.priority === "high";
    if (filter === "today") {
      return Boolean(task.due_date && task.due_date.slice(0, 10) === todayIsoRef);
    }
    return true;
  }

  const activeTasks = shell.tasks
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .filter(filterMatch);
  const doneTasks = shell.tasks.filter((task) => task.status === "done");

  // Done-counts per project across ALL tasks (filter-independent) so the
  // progress bar's denominator reflects total project scope, not the
  // currently-visible slice.
  const projectCounts = useMemo(() => {
    const counts = new Map<string, { done: number; total: number }>();
    for (const task of shell.tasks) {
      const key = task.project_id ?? "__noproject__";
      const entry = counts.get(key) ?? { done: 0, total: 0 };
      entry.total += 1;
      if (task.status === "done") entry.done += 1;
      counts.set(key, entry);
    }
    return counts;
  }, [shell.tasks]);

  const activeByProject = useMemo(
    () => groupByProject(activeTasks, t("common.general")),
    [activeTasks, t],
  );
  const doneByProject = useMemo(
    () => groupByProject(doneTasks, t("common.general")),
    [doneTasks, t],
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
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
              <span>{task.projectName ?? t("common.general")} • {task.status.replace("_", " ")}</span>
              {task.due_date ? (() => {
                const dueIso = task.due_date.slice(0, 10);
                const overdue = dueIso < todayIsoRef && task.status !== "done";
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
        <div className="mt-3 flex flex-wrap gap-1.5">
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
    </div>
  );
}
