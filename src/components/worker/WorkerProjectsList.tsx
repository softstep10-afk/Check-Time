"use client";

import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { useTranslation } from "@/lib/i18n";
import type { ProjectStatus } from "@/types/database";

const STATUS_COLORS: Record<ProjectStatus, { bg: string; color: string }> = {
  active: { bg: "rgba(46, 166, 122, 0.14)", color: "var(--green)" },
  paused: { bg: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" },
  completed: { bg: "rgba(107, 114, 128, 0.18)", color: "var(--text-muted)" },
  archived: { bg: "rgba(107, 114, 128, 0.10)", color: "var(--text-muted)" },
};

export function WorkerProjectsList() {
  const { shell } = useWorkerShell();
  const { t } = useTranslation();
  const projects = shell.projects;

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
            return (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
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
                    </div>
                    {project.address ? (
                      <div className="mt-1 flex items-center gap-1 text-xs text-[var(--text-muted)]">
                        <MapPin size={11} className="shrink-0" />
                        <span className="truncate">{project.address}</span>
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
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}
