"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  formatDurationCompact,
  parseGeoPoint,
  toSupabasePoint,
} from "@/lib/worker-utils";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import type { ProjectStatus } from "@/types/database";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function getProjectTone(status: ProjectStatus) {
  if (status === "paused" || status === "archived") {
    return "neutral";
  }

  if (status === "completed") {
    return "success";
  }

  return "warning";
}

export function ProjectsPage({
  orgId,
  initialProjects,
}: {
  orgId: string;
  initialProjects: ManagerProjectSummary[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [openProjectIds, setOpenProjectIds] = useState<Set<string>>(new Set());

  function toggleProject(projectId: string) {
    setOpenProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() ?? "";
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = Number.parseFloat(formData.get("rate")?.toString() ?? "0");
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? "200", 10);
    const lat = Number.parseFloat(formData.get("lat")?.toString() ?? "");
    const lng = Number.parseFloat(formData.get("lng")?.toString() ?? "");
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";

    if (!name) {
      setMessage(t("projects.nameRequired"));
      return;
    }

    setBusyKey("create");
    setMessage("");

    const { error } = await supabase.from("projects").insert({
      org_id: orgId,
      name,
      address: address || null,
      notes: notes || null,
      rate: Number.isFinite(rate) ? rate : 25,
      radius_m: Number.isFinite(radius) ? radius : 200,
      site_point:
        Number.isFinite(lat) && Number.isFinite(lng)
          ? toSupabasePoint({ lat, lng })
          : null,
      status: "active",
      settings: {},
      start_date: startDate || null,
      end_date: endDate || null,
    });

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    form.reset();
    setBusyKey(null);
    setMessage(t("projects.created"));
    router.refresh();
  }

  async function handleUpdateProject(
    event: React.FormEvent<HTMLFormElement>,
    projectId: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? "";
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = Number.parseFloat(formData.get("rate")?.toString() ?? "0");
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? "200", 10);
    const status = (formData.get("status")?.toString() ?? "active") as ProjectStatus;
    const lat = Number.parseFloat(formData.get("lat")?.toString() ?? "");
    const lng = Number.parseFloat(formData.get("lng")?.toString() ?? "");
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";

    if (!name) {
      setMessage(t("projects.nameRequired"));
      return;
    }

    setBusyKey(`update-${projectId}`);
    setMessage("");

    const payload: {
      name: string;
      address: string | null;
      notes: string | null;
      rate: number;
      radius_m: number;
      status: ProjectStatus;
      site_point?: string;
      start_date?: string | null;
      end_date?: string | null;
    } = {
      name,
      address: address || null,
      notes: notes || null,
      rate: Number.isFinite(rate) ? rate : 25,
      radius_m: Number.isFinite(radius) ? radius : 200,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
    };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      payload.site_point = toSupabasePoint({ lat, lng });
    }

    const { error } = await supabase.from("projects").update(payload).eq("id", projectId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projects.updated"));
    router.refresh();
  }

  async function handleArchiveProject(projectId: string) {
    setBusyKey(`archive-${projectId}`);
    setMessage("");

    const { error } = await supabase
      .from("projects")
      .update({
        status: "archived",
        deleted_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projects.archived"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("projects.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("projects.subtitle")}
        </h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("projects.description")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] border px-3 py-3 text-sm"
          style={{
            background: "rgba(191, 162, 52, 0.1)",
            borderColor: "rgba(191, 162, 52, 0.2)",
            color: "var(--brand-yellow)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projects.createProject")}</h2>
        <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={handleCreateProject}>
          <TextInputWithVoice
            name="name"
            placeholder={t("projects.projectName")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <TextInputWithVoice
            name="address"
            placeholder={t("common.address")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="rate"
            type="number"
            step="0.01"
            placeholder={t("projects.hourlyRate")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="radius_m"
            type="number"
            placeholder={t("projects.gpsRadius")}
            defaultValue="200"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="lat"
            type="number"
            step="0.000001"
            placeholder={t("projects.latitude")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="lng"
            type="number"
            step="0.000001"
            placeholder={t("projects.longitude")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="start_date"
            type="date"
            placeholder={t("projects.startDate")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <input
            name="end_date"
            type="date"
            placeholder={t("projects.endDate")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <TextInputWithVoice
            multiline
            name="notes"
            placeholder={t("projects.managerNotes")}
            className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none md:col-span-2"
          />
          <button
            type="submit"
            disabled={busyKey === "create"}
            className="button-base button-primary md:col-span-2"
          >
            {busyKey === "create" ? t("common.creating") : t("projects.createProject")}
          </button>
        </form>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {initialProjects.map((project) => {
          const site = parseGeoPoint(project.site_point);
          const isOpen = openProjectIds.has(project.id);

          return (
            <article key={project.id} className="surface-card p-4">
              <button
                type="button"
                onClick={() => toggleProject(project.id)}
                className="w-full text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-[var(--text-primary)]">
                      {project.name}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {project.address ?? t("common.noAddressSet")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="status-pill" data-tone={getProjectTone(project.status)}>
                      {project.status}
                    </div>
                    <ChevronDown
                      size={18}
                      className="chevron text-[var(--text-secondary)]"
                      data-open={isOpen}
                    />
                  </div>
                </div>
              </button>

              <div className="collapsible-body mt-4" data-open={isOpen}>
                <div className="collapsible-inner space-y-4">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="metric-panel rounded-[var(--radius-md)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {t("common.crew")}
                      </div>
                      <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                        {project.assignedWorkerCount}
                      </div>
                    </div>
                    <div className="metric-panel rounded-[var(--radius-md)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {t("common.onSite")}
                      </div>
                      <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                        {project.onSiteWorkerCount}
                      </div>
                    </div>
                    <div className="metric-panel rounded-[var(--radius-md)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {t("common.tasks")}
                      </div>
                      <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                        {project.openTaskCount}
                      </div>
                    </div>
                    <div className="metric-panel rounded-[var(--radius-md)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {t("common.week")}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                        {formatDurationCompact(project.weekMinutes)}
                      </div>
                    </div>
                    <div className="metric-panel rounded-[var(--radius-md)] p-3">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                        {t("projects.materials")}
                      </div>
                      <div
                        className="mt-1 font-mono text-sm font-bold"
                        style={{ color: project.receiptTotal > 0 ? "var(--brand-yellow)" : "var(--text-muted)" }}
                      >
                        {currencyFormatter.format(project.receiptTotal)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--text-secondary)]">
                      {site ? `${project.radius_m}m ${t("projects.geofenceReady")}` : t("projects.noSiteCoords")}
                    </div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--brand-yellow)]"
                    >
                      {t("projects.openDetail")}
                      <ExternalLink size={14} />
                    </Link>
                  </div>

                  <form
                    className="grid gap-3"
                    onSubmit={(event) => void handleUpdateProject(event, project.id)}
                  >
                    <TextInputWithVoice
                      name="name"
                      defaultValue={project.name}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <TextInputWithVoice
                      name="address"
                      defaultValue={project.address ?? ""}
                      placeholder={t("common.address")}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                      <input
                        name="rate"
                        type="number"
                        step="0.01"
                        defaultValue={project.rate}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <input
                        name="radius_m"
                        type="number"
                        defaultValue={project.radius_m}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <select
                        name="status"
                        defaultValue={project.status}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      >
                        <option value="active">{t("common.active")}</option>
                        <option value="paused">{t("common.paused")}</option>
                        <option value="completed">{t("common.completed")}</option>
                        <option value="archived">{t("common.archived")}</option>
                      </select>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        name="lat"
                        type="number"
                        step="0.000001"
                        defaultValue={site?.lat ?? ""}
                        placeholder={t("projects.latitude")}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <input
                        name="lng"
                        type="number"
                        step="0.000001"
                        defaultValue={site?.lng ?? ""}
                        placeholder={t("projects.longitude")}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        name="start_date"
                        type="date"
                        defaultValue={project.start_date ?? ""}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                      <input
                        name="end_date"
                        type="date"
                        defaultValue={project.end_date ?? ""}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                      />
                    </div>
                    <TextInputWithVoice
                      multiline
                      name="notes"
                      defaultValue={project.notes ?? ""}
                      placeholder={t("projects.managerNotes")}
                      className="min-h-[100px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={busyKey === `update-${project.id}`}
                        className="button-base button-primary"
                      >
                        {busyKey === `update-${project.id}` ? t("common.saving") : t("projects.saveChanges")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleArchiveProject(project.id)}
                        disabled={busyKey === `archive-${project.id}`}
                        className="button-base button-danger-ghost"
                      >
                        {busyKey === `archive-${project.id}` ? t("projects.archiving") : t("projects.archive")}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
