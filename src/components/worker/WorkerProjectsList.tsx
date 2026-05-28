"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, MapPin, Navigation, NavigationOff } from "lucide-react";
import { ProjectNavigationActions } from "@/components/shared/ProjectNavigationActions";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { OfflineCacheEmptyState, OfflineCacheNotice } from "@/components/worker/OfflineCacheNotice";
import { useTranslation } from "@/lib/i18n";
import { isDriverTimeProject } from "@/lib/driver-time-projects";
import { isEffectiveOpenTask } from "@/lib/task-status";
import {
  loadOfflineSnapshot,
  type OfflineFieldSnapshot,
} from "@/lib/offline-field-cache";
import { readProjectPublicNotes } from "@/lib/project-public-notes";
import type { WorkerProject } from "@/lib/worker-types";
import type { Project, ProjectStatus, Task } from "@/types/database";

const STATUS_COLORS: Record<ProjectStatus, { bg: string; color: string }> = {
  active: { bg: "rgba(46, 166, 122, 0.14)", color: "var(--green)" },
  paused: { bg: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" },
  completed: { bg: "rgba(107, 114, 128, 0.18)", color: "var(--text-muted)" },
  archived: { bg: "rgba(107, 114, 128, 0.10)", color: "var(--text-muted)" },
};

export function WorkerProjectsList() {
  const { shell, isOnline } = useWorkerShell();
  const { t } = useTranslation();
  const cacheActor = useMemo(
    () => ({ actorId: shell.profile.id, orgId: shell.profile.org_id }),
    [shell.profile.id, shell.profile.org_id],
  );
  const cachedProjectsSnapshot = !isOnline
    ? loadOfflineSnapshot<{ projects: WorkerProject[] }>(cacheActor, "worker-projects")
    : null;
  const [cachedProjectDetail, setCachedProjectDetail] =
    useState<OfflineFieldSnapshot<{
      project: Project;
      tasks: Array<Pick<Task, "id" | "title" | "status" | "priority" | "due_date">>;
      projectMedia: unknown[];
      projectReceipts: unknown[];
    }> | null>(null);
  const [offlineOpenMessage, setOfflineOpenMessage] = useState<string | null>(null);

  const projects =
    !isOnline && shell.projects.length === 0 && cachedProjectsSnapshot?.payload.projects
      ? cachedProjectsSnapshot.payload.projects
      : shell.projects;
  const offlineNoticeSavedAt =
    !isOnline && cachedProjectsSnapshot?.savedAt ? cachedProjectsSnapshot.savedAt : null;

  // Per-project task counts derived once from shell.tasks. shell.tasks is
  // already loaded by getWorkerShellData (personal + project-level), so
  // this is a free aggregation — no extra DB calls.
  const tasksByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of shell.tasks) {
      if (!task.project_id || !isEffectiveOpenTask(task)) continue;
      map.set(task.project_id, (map.get(task.project_id) ?? 0) + 1);
    }
    return map;
  }, [shell.tasks]);

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <h1 className="text-xl font-bold text-[var(--text-primary)]">
          {t("worker.projectsTitle")}
        </h1>
      </section>

      {projects.length === 0 ? (
        <section className="surface-card p-4">
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
            {t("worker.projectsEmpty")}
          </div>
        </section>
      ) : (
        <section className="space-y-2">
          {projects.map((project) => {
            const tone =
              STATUS_COLORS[project.status as ProjectStatus] ?? STATUS_COLORS.active;
            const driverTimeProject = isDriverTimeProject(project);
            const hasFence = project.site !== null;
            const taskCount = tasksByProject.get(project.id) ?? 0;
            const publicNotesCount = readProjectPublicNotes(project.settings).length;
            const clockedInHere =
              shell.clockState.isClockedIn &&
              shell.clockState.currentProjectId === project.id;
            function openCachedProject() {
              const cached = loadOfflineSnapshot<{
                project: Project;
                tasks: Array<Pick<Task, "id" | "title" | "status" | "priority" | "due_date">>;
                projectMedia: unknown[];
                projectReceipts: unknown[];
              }>(cacheActor, "worker-project-detail", project.id);
              if (cached) {
                setCachedProjectDetail(cached);
                setOfflineOpenMessage(null);
                return;
              }
              setCachedProjectDetail(null);
              setOfflineOpenMessage(t("worker.offlineCacheEmpty"));
            }
            return (
              <article
                key={project.id}
                data-testid="worker-project-card"
                className="relative block touch-manipulation rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-3 transition hover:border-[var(--brand-yellow)]"
              >
                <Link
                  href={`/project/${project.id}`}
                  data-testid="worker-project-card-main-link"
                  aria-label={`${t("worker.openProject")}: ${project.name}`}
                  className="absolute inset-0 z-[1] rounded-[var(--radius-md)] outline-none focus:ring-2 focus:ring-[var(--brand-yellow)]"
                  onClick={(event) => {
                    if (isOnline) return;
                    event.preventDefault();
                    openCachedProject();
                  }}
                >
                  <span className="sr-only">{project.name}</span>
                </Link>
                <div className="pointer-events-none relative z-[2] flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">
                        {project.name}
                      </span>
                      <span
                        className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        {project.status}
                      </span>
                      {clockedInHere ? (
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                          style={{
                            background: "rgba(191, 162, 52, 0.16)",
                            color: "var(--brand-yellow)",
                          }}
                        >
                          {t("workerProject.activeShiftHere")}
                        </span>
                      ) : null}
                      <span
                        className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                        style={{
                          background: hasFence
                            ? "rgba(46, 166, 122, 0.14)"
                            : driverTimeProject
                              ? "rgba(46, 166, 122, 0.14)"
                            : "rgba(107, 114, 128, 0.18)",
                          color: hasFence || driverTimeProject ? "var(--green)" : "var(--text-muted)",
                        }}
                        title={
                          driverTimeProject
                            ? t("projects.driverTimeGpsNotRequired")
                            : hasFence
                              ? t("worker.projectFenceOn")
                              : t("worker.projectFenceOff")
                        }
                      >
                        {hasFence || driverTimeProject ? (
                          <Navigation size={9} />
                        ) : (
                          <NavigationOff size={9} />
                        )}
                        {driverTimeProject
                          ? t("projects.driverTimeProject")
                          : hasFence
                            ? t("worker.projectFenceOn")
                            : t("worker.projectFenceOff")}
                      </span>
                    </div>
                    {project.address ? (
                      <div
                        className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]"
                      >
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">{project.address}</span>
                      </div>
                    ) : null}
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <ClipboardList size={11} className="shrink-0" />
                      <span>
                        {taskCount} {t("worker.projectTasks")}
                      </span>
                    </div>
                    {publicNotesCount > 0 ? (
                      <div className="mt-1.5 text-[11px] font-semibold text-[var(--brand-yellow)]">
                        {t("projectNotes.newBadge")} · {publicNotesCount}
                      </div>
                    ) : null}
                  </div>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-semibold"
                    style={{
                      borderColor: "rgba(191, 162, 52, 0.4)",
                      color: "var(--brand-yellow)",
                    }}
                  >
                    {t("worker.openProject")}
                    <ArrowRight size={11} />
                  </span>
                </div>
                <div className="relative z-[3] mt-3" data-project-card-action="navigation">
                  <ProjectNavigationActions
                    projectName={project.name}
                    address={project.address}
                    siteCoordinates={project.site}
                    compact
                  />
                </div>
              </article>
            );
          })}
        </section>
      )}

      {offlineNoticeSavedAt ? (
        <OfflineCacheNotice savedAt={offlineNoticeSavedAt} />
      ) : !isOnline && projects.length === 0 ? (
        <OfflineCacheEmptyState />
      ) : null}

      {offlineOpenMessage ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border px-3 py-3 text-sm text-[var(--text-secondary)]"
          style={{
            background: "rgba(245, 158, 11, 0.08)",
            borderColor: "rgba(245, 158, 11, 0.22)",
          }}
        >
          {offlineOpenMessage}
        </div>
      ) : null}

      {cachedProjectDetail ? (
        <section className="surface-card space-y-3 p-4" data-testid="offline-cached-project-detail">
          <OfflineCacheNotice savedAt={cachedProjectDetail.savedAt} />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t("worker.offlineCachedProjectTitle")}
              </p>
              <h2 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                {cachedProjectDetail.payload.project.name}
              </h2>
              {cachedProjectDetail.payload.project.address ? (
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {cachedProjectDetail.payload.project.address}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setCachedProjectDetail(null)}
              className="button-base button-secondary px-2 py-1 text-xs"
            >
              {t("common.close")}
            </button>
          </div>
          <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-3">
            <div className="surface-panel p-2">{cachedProjectDetail.payload.tasks.length} {t("tasks.items")}</div>
            <div className="surface-panel p-2">{cachedProjectDetail.payload.projectMedia.length} {t("common.media")}</div>
            <div className="surface-panel p-2">{cachedProjectDetail.payload.projectReceipts.length} {t("workerProject.receiptsTitle")}</div>
          </div>
          {cachedProjectDetail.payload.tasks.length > 0 ? (
            <div className="space-y-2">
              {cachedProjectDetail.payload.tasks.slice(0, 8).map((task) => (
                <div key={task.id} className="surface-panel p-2 text-sm">
                  <div className="font-semibold text-[var(--text-primary)]">{task.title}</div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {task.status} · {task.priority}
                    {task.due_date ? ` · ${task.due_date.slice(0, 10)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
