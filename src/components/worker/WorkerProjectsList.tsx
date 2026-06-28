"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ProjectNavigationActions } from "@/components/shared/ProjectNavigationActions";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { WorkerSectionSkeleton } from "@/components/worker/WorkerSectionSkeleton";
import { OfflineCacheEmptyState, OfflineCacheNotice } from "@/components/worker/OfflineCacheNotice";
import { useTranslation } from "@/lib/i18n";
import {
  loadOfflineSnapshot,
  type OfflineFieldSnapshot,
} from "@/lib/offline-field-cache";
import type { WorkerProject } from "@/lib/worker-types";
import type { Project, Task } from "@/types/database";

export function WorkerProjectsList() {
  const { shell, shellDataStatus, isOnline } = useWorkerShell();
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

  if (shellDataStatus === "loading") {
    return <WorkerSectionSkeleton label="Loading worker projects" />;
  }

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
        <section className="space-y-1.5">
          {projects.map((project) => {
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
                className="relative block touch-manipulation rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-2.5 transition hover:border-[var(--brand-yellow)]"
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
                <div className="pointer-events-none relative z-[2] flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                    {project.name}
                  </span>
                  {clockedInHere ? (
                    <span
                      className="shrink-0 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                      style={{
                        background: "rgba(191, 162, 52, 0.16)",
                        color: "var(--brand-yellow)",
                      }}
                    >
                      {t("workerProject.activeShiftHere")}
                    </span>
                  ) : null}
                </div>
                <div className="relative z-[3] mt-2" data-project-card-action="navigation">
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
