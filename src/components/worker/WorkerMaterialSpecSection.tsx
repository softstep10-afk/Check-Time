"use client";

import { ExternalLink } from "lucide-react";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { useTranslation } from "@/lib/i18n";
import { readProjectMaterialSpec } from "@/lib/project-planning";
import type { Project } from "@/types/database";

function materialLinkHref(link: string): string | null {
  const trimmed = link.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return null;
}

export function WorkerMaterialSpecSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const items = readProjectMaterialSpec(project.settings);

  return (
    <CollapsibleSection
      id="material-spec"
      projectId={project.id}
      defaultOpen={items.length > 0}
      dataTestid="worker-project-material-spec"
      className="p-4"
      summary={
        <div>
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {t("projectMaterials.workerTitle")}: {items.length}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("projectMaterials.workerSubtitle")}
          </p>
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
          {t("projectMaterials.emptyWorker")}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => {
            const href = materialLinkHref(item.link);
            return (
              <div
                key={item.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.42)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[var(--text-primary)]">{item.name}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {[item.quantity, item.unit].filter(Boolean).join(" ")}
                      {item.supplier ? ` · ${item.supplier}` : ""}
                    </div>
                  </div>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                    >
                      <ExternalLink size={13} />
                      {t("common.open")}
                    </a>
                  ) : null}
                </div>
                {item.note ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">
                    {item.note}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
