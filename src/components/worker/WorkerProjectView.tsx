"use client";

import Link from "next/link";
import { useTranslation } from "@/lib/i18n";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import type { TaskAttachmentRef } from "@/lib/task-attachments";
import type { Project, Task } from "@/types/database";

type TaskWithAttachments = Task & { attachments?: TaskAttachmentRef[] };

export function WorkerProjectView({
  project,
  projectMedia,
  tasks,
}: {
  project: Project;
  projectMedia: TaskAttachmentRef[];
  tasks: TaskWithAttachments[];
}) {
  const { t } = useTranslation();

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
        <p className="mt-2 text-[10px] font-semibold text-[var(--text-muted)]">
          {t("workerProject.readOnlyHint")}
        </p>
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

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.tasksTitle")}
        </h2>
        {tasks.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.tasksEmpty")}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              >
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
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
