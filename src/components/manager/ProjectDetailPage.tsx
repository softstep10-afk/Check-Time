"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import { ACCEPT_ALL_UPLOADS, validateUploadFile } from "@/lib/upload-limits";
import {
  getAttachmentMediaIds,
  linkMediaToTask,
  uploadTaskAttachment,
} from "@/lib/task-attachments";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { ProjectSiteMap } from "@/components/maps/ProjectSiteMap";
import {
  formatDateTime,
  formatDurationCompact,
  parseGeoPoint,
  toSupabasePoint,
} from "@/lib/worker-utils";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
} from "@/lib/manager-types";
import type {
  Media,
  ProjectAssignment,
  ProjectStatus,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/types/database";

export function ProjectDetailPage({
  orgId,
  managerId,
  project,
  assignedProfiles,
  availableProfiles,
  assignments,
  tasks,
  media,
  sessions,
}: {
  orgId: string;
  managerId: string;
  project: ManagerProjectSummary;
  assignedProfiles: ManagerProfileSummary[];
  availableProfiles: ManagerProfileSummary[];
  assignments: ProjectAssignment[];
  tasks: Task[];
  media: Media[];
  sessions: ManagerSession[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const [mediaFilter, setMediaFilter] = useState<"all" | "photo" | "video" | "pdf">("all");
  const [taskAttachmentFiles, setTaskAttachmentFiles] = useState<File[]>([]);
  const taskAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const mediaById = useMemo(
    () => new Map(media.map((m) => [m.id, m])),
    [media],
  );

  // 3-button project media upload (photo / video / pdf). Separate from
  // receipts (no store/amount metadata) and from task attachments
  // (no task linkage). Lands in the same media table + bucket so the
  // existing Recent Media panel + tab counts pick it up automatically.
  const photoMediaInputRef = useRef<HTMLInputElement | null>(null);
  const videoMediaInputRef = useRef<HTMLInputElement | null>(null);
  const pdfMediaInputRef = useRef<HTMLInputElement | null>(null);

  // Strict separation: the Project Media panel must show only rows the
  // 3-button upload created (metadata.kind === "project_media").
  // Receipts (metadata.category === "receipt"), task attachments
  // (metadata.kind === "task_attachment"), worker journal entries, and
  // checkout videos are intentionally excluded so each section's count
  // matches the user's mental model. The full `media` array is still
  // consulted by mediaById (so task attachment lookups resolve) and by
  // mediaIds (so flag indicators cover every project media row).
  const projectMediaItems = useMemo(
    () => media.filter((m) => {
      const meta = m.metadata as Record<string, unknown> | null;
      return meta?.kind === "project_media";
    }),
    [media],
  );

  const filteredMedia = useMemo(() => {
    if (mediaFilter === "all") return projectMediaItems;
    if (mediaFilter === "pdf") {
      // Bucket the legacy 'document' type with PDFs — they're the same UX
      // category from the manager's POV.
      return projectMediaItems.filter(
        (m) => m.media_type === "pdf" || m.media_type === "document",
      );
    }
    return projectMediaItems.filter((m) => m.media_type === mediaFilter);
  }, [projectMediaItems, mediaFilter]);

  const mediaCounts = useMemo(() => {
    let photo = 0;
    let video = 0;
    let pdf = 0;
    for (const m of projectMediaItems) {
      if (m.media_type === "photo") photo += 1;
      else if (m.media_type === "video") video += 1;
      else if (m.media_type === "pdf" || m.media_type === "document") pdf += 1;
    }
    return { photo, video, pdf, all: projectMediaItems.length };
  }, [projectMediaItems]);

  const mediaIds = useMemo(() => media.map((m) => m.id), [media]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ids = await fetchOpenFlagMediaIds(supabase, mediaIds);
      if (!cancelled) setOpenFlagIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, mediaIds]);

  async function refreshOpenFlags() {
    const ids = await fetchOpenFlagMediaIds(supabase, mediaIds);
    setOpenFlagIds(ids);
  }
  const [message, setMessage] = useState("");
  const site = parseGeoPoint(project.site_point);
  const { t } = useTranslation();

  async function handleUpdateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? project.name;
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = Number.parseFloat(formData.get("rate")?.toString() ?? `${project.rate}`);
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? `${project.radius_m}`, 10);
    const status = (formData.get("status")?.toString() ?? project.status) as ProjectStatus;
    const lat = Number.parseFloat(formData.get("lat")?.toString() ?? "");
    const lng = Number.parseFloat(formData.get("lng")?.toString() ?? "");

    setBusyKey("project-update");
    setMessage("");

    const payload: {
      name: string;
      address: string | null;
      notes: string | null;
      rate: number;
      radius_m: number;
      status: ProjectStatus;
      site_point?: string;
    } = {
      name,
      address: address || null,
      notes: notes || null,
      rate: Number.isFinite(rate) ? rate : project.rate,
      radius_m: Number.isFinite(radius) ? radius : project.radius_m,
      status,
    };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      payload.site_point = toSupabasePoint({ lat, lng });
    }

    const { error } = await supabase.from("projects").update(payload).eq("id", project.id);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projects.updated"));
    router.refresh();
  }

  async function handleAssignWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const profileId = formData.get("profile_id")?.toString() ?? "";

    if (!profileId) {
      return;
    }

    setBusyKey("assign-worker");
    setMessage("");

    const { error } = await supabase.from("project_assignments").insert({
      org_id: orgId,
      project_id: project.id,
      profile_id: profileId,
    });

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projectDetail.workerAssigned"));
    router.refresh();
  }

  async function handleRemoveAssignment(assignmentId: string) {
    setBusyKey(`remove-${assignmentId}`);
    setMessage("");

    const { error } = await supabase
      .from("project_assignments")
      .delete()
      .eq("id", assignmentId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projectDetail.assignmentRemoved"));
    router.refresh();
  }

  async function handleCreateTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = formData.get("title")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() ?? "";
    const assignedTo = formData.get("assigned_to")?.toString() ?? "";
    const priority = (formData.get("priority")?.toString() ?? "medium") as TaskPriority;
    const dueDate = formData.get("due_date")?.toString() ?? "";

    if (!title) {
      setMessage(t("projectDetail.taskTitleRequired"));
      return;
    }

    setBusyKey("create-task");
    setMessage("");

    console.log("[task-attach] handleCreateTask: file count", taskAttachmentFiles.length);

    // Upload any attachments first; if any one fails, abort before
    // creating the task so we don't end up with orphan task rows.
    const uploadedMediaIds: string[] = [];
    for (const file of taskAttachmentFiles) {
      // Cloud-picker guard: zero-byte or nameless File usually means the
      // browser handed back a streaming reference (Google Drive, iCloud)
      // it can't materialize. Surface the user-facing fallback rather
      // than letting the validator/storage emit a cryptic error.
      if (!file || file.size === 0 || !file.name) {
        console.error("[task-attach] invalid File detected (likely cloud picker)", {
          name: file?.name,
          size: file?.size,
          type: file?.type,
        });
        setMessage(t("tasks.attachmentCloudFallback"));
        setBusyKey(null);
        return;
      }
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        console.error("[task-attach] handleCreateTask validation FAIL", validation.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setBusyKey(null);
        return;
      }
      const result = await uploadTaskAttachment(supabase, {
        orgId,
        projectId: project.id,
        uploadedBy: managerId,
        file,
      });
      if (!result.ok) {
        console.error("[task-attach] handleCreateTask upload FAIL", result.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setBusyKey(null);
        return;
      }
      uploadedMediaIds.push(result.mediaId);
    }

    console.log("[task-attach] task insert begin", {
      hasAttachments: uploadedMediaIds.length > 0,
      attachmentCount: uploadedMediaIds.length,
    });
    const { data: insertedTask, error } = await supabase
      .from("tasks")
      .insert({
        org_id: orgId,
        project_id: project.id,
        assigned_to: assignedTo || null,
        assigned_by: managerId,
        title,
        description: description || null,
        priority,
        status: "pending",
        due_date: dueDate || null,
        metadata: uploadedMediaIds.length > 0
          ? { attachment_media_ids: uploadedMediaIds }
          : {},
      })
      .select("id")
      .single<{ id: string }>();

    if (error || !insertedTask) {
      console.error("[task-attach] task insert FAIL", error);
      setMessage(`task-insert: ${error?.message ?? "no data"}`);
      setBusyKey(null);
      return;
    }
    console.log("[task-attach] task insert ok", { taskId: insertedTask.id });

    if (uploadedMediaIds.length > 0) {
      void linkMediaToTask(supabase, insertedTask.id, uploadedMediaIds);
    }

    form.reset();
    setTaskAttachmentFiles([]);
    if (taskAttachmentInputRef.current) taskAttachmentInputRef.current.value = "";
    setBusyKey(null);
    setMessage(t("projectDetail.taskCreated"));
    router.refresh();
  }

  // Inline click-to-open for the Project Media list. The list is rendered
  // as bespoke JSX (not via TaskAttachmentList), so it doesn't inherit
  // the shared component's signed-URL open handler — we replicate it
  // here. Same pattern, same TTL, same private-bucket support.
  async function openProjectMediaItem(item: { id: string; storage_path: string }) {
    if (typeof window === "undefined") return;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(item.storage_path, 3600);
    console.log("[project-media] open", {
      id: item.id,
      storage_path: item.storage_path,
      signedUrl: data?.signedUrl,
      error: error?.message,
    });
    if (error || !data?.signedUrl) {
      console.error("[project-media] failed to sign URL", error);
      setMessage(t("projectDetail.mediaOpenFailed"));
      return;
    }
    const popup = window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      console.warn("[project-media] popup blocked");
      setMessage(t("projectDetail.mediaOpenFailed"));
    }
  }

  async function handleProjectMediaUpload(
    files: FileList | File[] | null,
    kind: "photo" | "video" | "pdf",
  ) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;

    // Pre-validate all files before any upload starts so a single bad
    // file in a multi-select doesn't leave half the batch in storage.
    for (const file of list) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        setMessage(t("projectDetail.mediaUploadFailed"));
        return;
      }
      if (validation.kind !== kind) {
        setMessage(t("projectDetail.mediaWrongKind"));
        return;
      }
    }

    setBusyKey("project-media");
    setMessage("");

    for (const file of list) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orgId}/${project.id}/project-media/${Date.now()}-${safeName}`;
      const contentType =
        file.type ||
        (kind === "pdf" ? "application/pdf" : kind === "photo" ? "image/jpeg" : "video/mp4");

      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, cacheControl: "3600", contentType });
      if (uploadErr) {
        setMessage(t("projectDetail.mediaUploadFailed"));
        setBusyKey(null);
        return;
      }

      const metadata = { kind: "project_media" as const };
      if (metadata.kind !== "project_media") {
        console.warn("[upload-guard] expected metadata.kind=project_media, got:", metadata);
      }
      const { error: insertErr } = await supabase.from("media").insert({
        org_id: orgId,
        project_id: project.id,
        uploaded_by: managerId,
        media_type: kind,
        storage_path: path,
        filename: file.name,
        file_size: file.size,
        mime_type: contentType,
        caption: null,
        is_checkout: false,
        time_event_id: null,
        metadata,
      });
      if (insertErr) {
        setMessage(t("projectDetail.mediaUploadFailed"));
        setBusyKey(null);
        return;
      }
    }

    setBusyKey(null);
    setMessage(t("projectDetail.mediaUploaded"));
    router.refresh();
  }

  async function handleUpdateTask(taskId: string, nextStatus: TaskStatus) {
    setBusyKey(`task-${taskId}`);
    setMessage("");

    const { error } = await supabase
      .from("tasks")
      .update({
        status: nextStatus,
        completed_at: nextStatus === "done" ? new Date().toISOString() : null,
        completed_by: nextStatus === "done" ? managerId : null,
      })
      .eq("id", taskId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projectDetail.taskUpdated"));
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
          {t("projectDetail.backToProjects")}
        </Link>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">{project.name}</h1>
        <p className="max-w-[60ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("projectDetail.description")}
        </p>
      </section>

      {/* ── Project Timer ── */}
      <section className="surface-card p-4">
        {project.start_date || project.end_date ? (() => {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const start = project.start_date ? new Date(project.start_date + "T00:00:00") : null;
          const end = project.end_date ? new Date(project.end_date + "T00:00:00") : null;
          const dayMs = 86_400_000;
          const durationDays = start ? Math.floor((today.getTime() - start.getTime()) / dayMs) : null;
          const remainingDays = end ? Math.floor((end.getTime() - today.getTime()) / dayMs) : null;
          const isOverdue = remainingDays !== null && remainingDays < 0;
          const totalSpan = start && end ? Math.max(1, Math.floor((end.getTime() - start.getTime()) / dayMs)) : null;
          const elapsed = start && totalSpan ? Math.max(0, Math.min(totalSpan, Math.floor((today.getTime() - start.getTime()) / dayMs))) : null;
          const progress = elapsed !== null && totalSpan ? Math.min(100, Math.max(0, Math.round((elapsed / totalSpan) * 100))) : null;

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {durationDays !== null && durationDays >= 0 ? (
                  <div className="text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{t("schedule.duration")}:</span>{" "}
                    {durationDays} {t("schedule.days")}
                  </div>
                ) : null}
                {end ? (
                  <div className="text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{t("schedule.deadline")}:</span>{" "}
                    {project.end_date}
                  </div>
                ) : null}
                {remainingDays !== null ? (
                  isOverdue ? (
                    <div className="font-semibold" style={{ color: "#ef4444" }}>
                      {t("schedule.overdueDays")} {Math.abs(remainingDays)} {t("schedule.days")}
                    </div>
                  ) : (
                    <div className="text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--brand-yellow)]">{remainingDays}</span>{" "}
                      {t("schedule.daysRemaining")}
                    </div>
                  )
                ) : null}
              </div>
              {progress !== null ? (
                <div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--bg-primary)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progress}%`,
                        background: isOverdue ? "#ef4444" : "var(--brand-yellow)",
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{project.start_date}</span>
                    <span>{project.end_date}</span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })() : (
          <div className="text-sm text-[var(--text-secondary)]">{t("schedule.noSchedule")}</div>
        )}
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] border px-3 py-3 text-sm"
          style={{
            background: "rgba(191, 162, 52, 0.12)",
            borderColor: "rgba(191, 162, 52, 0.2)",
            color: "var(--brand-yellow)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="surface-card p-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.projectSettings")}</h2>
          <form className="mt-4 grid gap-3" onSubmit={handleUpdateProject}>
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
            <TextInputWithVoice
              multiline
              name="notes"
              defaultValue={project.notes ?? ""}
              className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={busyKey === "project-update"}
              className="button-base button-primary"
            >
              {busyKey === "project-update" ? t("common.saving") : t("projectDetail.saveProject")}
            </button>
          </form>
        </div>

        <div className="space-y-4">
          <div className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.siteMap")}</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.siteMapDesc")}
                </p>
              </div>
              <div className="status-pill" data-tone={site ? "warning" : "neutral"}>
                {site ? `${project.radius_m}${t("clock.radiusM")}` : t("projectDetail.noGps")}
              </div>
            </div>
            {site ? (
              <div className="mt-4 h-[220px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] md:h-[300px]">
                <ProjectSiteMap site={site} radiusMeters={project.radius_m} />
              </div>
            ) : (
              <div className="surface-panel mt-4 p-4 text-sm text-[var(--text-secondary)]">
                {t("projectDetail.addLatLng")}
              </div>
            )}
          </div>

          <div className="surface-card p-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="metric-panel rounded-[var(--radius-md)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.crew")}</div>
                <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">{assignedProfiles.length}</div>
              </div>
              <div className="metric-panel rounded-[var(--radius-md)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.open")}</div>
                <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                  {tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length}
                </div>
              </div>
              <div className="metric-panel rounded-[var(--radius-md)] p-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.week")}</div>
                <div className="mt-1 text-sm font-bold text-[var(--text-primary)]">{formatDurationCompact(project.weekMinutes)}</div>
              </div>
            </div>
          </div>

          <div className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.assignedCrew")}</h2>
              <div className="text-xs text-[var(--text-muted)]">{assignedProfiles.length} {t("projectDetail.workers")}</div>
            </div>
            <form className="mt-4 flex gap-2" onSubmit={handleAssignWorker}>
              <select
                name="profile_id"
                defaultValue=""
                className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="" disabled>
                  {t("projectDetail.assignWorker")}
                </option>
                {availableProfiles.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} • {worker.role}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busyKey === "assign-worker"}
                className="button-base button-primary"
              >
                {t("projectDetail.assign")}
              </button>
            </form>
            <div className="mt-4 space-y-3">
              {assignedProfiles.map((worker) => {
                const assignment = assignments.find((entry) => entry.profile_id === worker.id);
                return (
                  <div
                    key={worker.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/team/${worker.id}`} className="text-sm font-semibold text-[var(--text-primary)]">
                        {worker.name}
                      </Link>
                      {assignment ? (
                        <button
                          type="button"
                          onClick={() => void handleRemoveAssignment(assignment.id)}
                          disabled={busyKey === `remove-${assignment.id}`}
                          className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                        >
                          {t("common.remove")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <div className="surface-card p-4 order-2">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("common.tasks")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("projectDetail.tasksSubtitle")}</p>
          <form className="mt-4 grid gap-3" onSubmit={handleCreateTask}>
            <TextInputWithVoice
              name="title"
              placeholder={t("projectDetail.taskTitle")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <TextInputWithVoice
              multiline
              name="description"
              placeholder={t("projectDetail.taskDescription")}
              className="min-h-[100px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                name="assigned_to"
                defaultValue=""
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("common.unassigned")}</option>
                {assignedProfiles.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name}
                  </option>
                ))}
              </select>
              <select
                name="priority"
                defaultValue="medium"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="low">{t("projectDetail.low")}</option>
                <option value="medium">{t("projectDetail.medium")}</option>
                <option value="high">{t("projectDetail.high")}</option>
                <option value="urgent">{t("projectDetail.urgent")}</option>
              </select>
              <DateField
                name="due_date"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="space-y-2">
              <input
                ref={taskAttachmentInputRef}
                type="file"
                multiple
                accept={ACCEPT_ALL_UPLOADS}
                onChange={(e) =>
                  setTaskAttachmentFiles(e.target.files ? Array.from(e.target.files) : [])
                }
                className="block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
              />
              {taskAttachmentFiles.length > 0 ? (
                <div className="text-[10px] text-[var(--text-muted)]">
                  {taskAttachmentFiles.length} {t("tasks.attachmentsCount")}
                </div>
              ) : null}
              <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                {t("tasks.attachmentInlineLabel")}
              </div>
            </div>

            <button
              type="submit"
              disabled={busyKey === "create-task"}
              className="button-base button-primary"
            >
              {busyKey === "create-task" ? t("common.creating") : t("projectDetail.createTask")}
            </button>
          </form>

          <div className="mt-5 space-y-3">
            {tasks.map((task) => {
              const prioColor =
                task.priority === "urgent" || task.priority === "high"
                  ? "#ef4444"
                  : task.priority === "medium"
                    ? "#f59e0b"
                    : "#22c55e";
              return (
              <div
                key={task.id}
                className="task-card rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                style={{ "--task-accent": prioColor } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {assignedProfiles.find((worker) => worker.id === task.assigned_to)?.name ?? t("common.unassigned")} • {task.status}
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ background: `${prioColor}18`, color: prioColor }}
                  >
                    {task.priority}
                  </span>
                </div>
                {task.description ? (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">{task.description}</p>
                ) : null}
                {(() => {
                  const refs = getAttachmentMediaIds(task)
                    .map((id) => mediaById.get(id))
                    .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    .map((m) => ({
                      id: m.id,
                      filename: m.filename,
                      mime_type: m.mime_type,
                      media_type: m.media_type,
                      storage_path: m.storage_path,
                    }));
                  return refs.length > 0 ? <TaskAttachmentList items={refs} /> : null;
                })()}
                <div className="mt-4 flex flex-wrap gap-2">
                  {task.status !== "in_progress" ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "in_progress")}
                      disabled={busyKey === `task-${task.id}`}
                      className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                    >
                      {t("common.start")}
                    </button>
                  ) : null}
                  {task.status !== "done" ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "done")}
                      disabled={busyKey === `task-${task.id}`}
                      className="button-base button-primary min-h-0 px-3 py-2 text-xs"
                    >
                      {t("common.done")}
                    </button>
                  ) : null}
                  {task.status !== "cancelled" ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "cancelled")}
                      disabled={busyKey === `task-${task.id}`}
                      className="button-base button-danger-ghost min-h-0 px-3 py-2 text-xs"
                    >
                      {t("common.cancel")}
                    </button>
                  ) : null}
                </div>
              </div>
              );
            })}
          </div>
        </div>

        <div className="contents">
          <div className="surface-card p-4 order-1">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.recentMedia")}</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{t("projectDetail.projectMediaSubtitle")}</p>

            {/* 3-button upload triggers — photo / video / pdf. Local-device only. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={photoMediaInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleProjectMediaUpload(e.target.files, "photo");
                  e.target.value = "";
                }}
              />
              <input
                ref={videoMediaInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleProjectMediaUpload(e.target.files, "video");
                  e.target.value = "";
                }}
              />
              <input
                ref={pdfMediaInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleProjectMediaUpload(e.target.files, "pdf");
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => photoMediaInputRef.current?.click()}
                disabled={busyKey === "project-media"}
                className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                📷 {t("projectDetail.addPhoto")}
              </button>
              <button
                type="button"
                onClick={() => videoMediaInputRef.current?.click()}
                disabled={busyKey === "project-media"}
                className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                🎥 {t("projectDetail.addVideo")}
              </button>
              <button
                type="button"
                onClick={() => pdfMediaInputRef.current?.click()}
                disabled={busyKey === "project-media"}
                className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                📄 {t("projectDetail.addPdf")}
              </button>
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">
              {t("projectDetail.mediaUploadHint")}
            </div>
            <div className="mt-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
              {t("projectDetail.projectMediaInlineLabel")}
            </div>

            {projectMediaItems.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(
                  [
                    { key: "all", label: t("projectDetail.mediaFilterAll"), icon: "", count: mediaCounts.all },
                    { key: "photo", label: t("projectDetail.mediaFilterPhoto"), icon: "📷", count: mediaCounts.photo },
                    { key: "video", label: t("projectDetail.mediaFilterVideo"), icon: "🎥", count: mediaCounts.video },
                    { key: "pdf", label: t("projectDetail.mediaFilterPdf"), icon: "📄", count: mediaCounts.pdf },
                  ] as const
                ).map((tab) => {
                  const selected = mediaFilter === tab.key;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setMediaFilter(tab.key)}
                      aria-pressed={selected}
                      className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold transition-colors"
                      style={{
                        borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                        background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                        color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
                      }}
                    >
                      {tab.icon ? `${tab.icon} ` : ""}{tab.label}
                      <span className="ml-1 opacity-60">{tab.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {projectMediaItems.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noMedia")}
                </div>
              ) : filteredMedia.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noMediaForFilter")}
                </div>
              ) : (
                filteredMedia.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => void openProjectMediaItem(item)}
                          className="text-left text-sm font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline focus:underline"
                        >
                          {item.filename ?? item.media_type}
                        </button>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {formatDateTime(item.created_at)} • {item.media_type}
                        </div>
                      </div>
                      <MediaFlagButton
                        mediaId={item.id}
                        hasOpenFlag={openFlagIds.has(item.id)}
                        onClick={() => setFlagModalMediaId(item.id)}
                      />
                    </div>
                    {item.caption ? (
                      <p className="mt-3 text-sm text-[var(--text-secondary)]">{item.caption}</p>
                    ) : null}
                    <div className="mt-3 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void openProjectMediaItem(item)}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                        style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
                      >
                        ↗ {t("messages.openFile")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFlagModalMediaId(item.id)}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                        style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                      >
                        🚩 {t("flags.flagForReview")}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="surface-card p-4 order-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.recentShifts")}</h2>
            <div className="mt-4 space-y-3">
              {sessions.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noShifts")}
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link href={`/team/${session.profileId}`} className="text-sm font-semibold text-[var(--text-primary)]">
                          {session.profileName}
                        </Link>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {formatDateTime(session.clockInTime)}{session.clockOutTime ? ` - ${formatDateTime(session.clockOutTime)}` : ` - ${t("common.live").toLowerCase()}`}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {formatDurationCompact(session.durationMinutes)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
      {/* ── Materials & Deliveries ── */}
      <MaterialsSection orgId={orgId} projectId={project.id} managerId={managerId} />
      {/* ── Receipts ── */}
      <ReceiptsSection orgId={orgId} projectId={project.id} managerId={managerId} />
      {/* ── Store Visits ── */}
      <StoreVisitsSection projectId={project.id} />

      <MediaFlagModal
        open={flagModalMediaId !== null}
        mediaId={flagModalMediaId}
        viewerRole="manager"
        viewerId={managerId}
        onClose={() => setFlagModalMediaId(null)}
        onMutate={() => void refreshOpenFlags()}
      />
    </div>
  );
}

// ── Inline Materials sub-component ──

type MaterialItem = {
  id: string;
  name: string;
  quantity: string;
  color: string;
  delivered: boolean;
};

function MaterialsSection({
  orgId,
  projectId,
  managerId,
}: {
  orgId: string;
  projectId: string;
  managerId: string;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("tasks")
        .select("*")
        .eq("project_id", projectId)
        .eq("metadata->>category", "material")
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      const rows = (data ?? []) as Array<{
        id: string;
        title: string;
        description: string | null;
        priority: string;
        status: string;
        metadata: Record<string, unknown>;
      }>;

      setItems(
        rows.map((row) => ({
          id: row.id,
          name: row.title,
          quantity: (row.metadata?.quantity as string) ?? "",
          color:
            row.priority === "urgent" || row.priority === "high"
              ? "#ef4444"
              : row.priority === "medium"
                ? "#f59e0b"
                : "#22c55e",
          delivered: row.status === "done",
        })),
      );
      setLoading(false);
    }
    void load();
  }, [supabase, projectId]);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const name = fd.get("mat_name")?.toString().trim() ?? "";
    const quantity = fd.get("mat_qty")?.toString().trim() ?? "";
    const priority = fd.get("mat_priority")?.toString() ?? "medium";
    if (!name) return;

    const { data, error } = await supabase
      .from("tasks")
      .insert({
        org_id: orgId,
        project_id: projectId,
        assigned_to: null,
        assigned_by: managerId,
        title: name,
        description: quantity ? `Qty: ${quantity}` : null,
        priority,
        status: "pending",
        due_date: null,
        metadata: { category: "material", quantity },
      })
      .select("id")
      .single();

    if (error || !data) return;

    const color =
      priority === "urgent" || priority === "high"
        ? "#ef4444"
        : priority === "medium"
          ? "#f59e0b"
          : "#22c55e";

    setItems((prev) => [
      ...prev,
      { id: data.id, name, quantity, color, delivered: false },
    ]);
    form.reset();
  }

  async function toggleDelivered(itemId: string, delivered: boolean) {
    await supabase
      .from("tasks")
      .update({ status: delivered ? "done" : "pending", completed_at: delivered ? new Date().toISOString() : null })
      .eq("id", itemId);
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, delivered } : it)),
    );
  }

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("materials.title")}</h2>

      <form className="mt-4 flex flex-wrap gap-2" onSubmit={handleAdd}>
        <TextInputWithVoice
          name="mat_name"
          placeholder={t("materials.name")}
          className="min-w-[180px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        />
        <input
          name="mat_qty"
          placeholder={t("materials.quantity")}
          className="w-20 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        />
        <select
          name="mat_priority"
          defaultValue="medium"
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          <option value="urgent">{t("materials.urgent")}</option>
          <option value="medium">{t("materials.soon")}</option>
          <option value="low">{t("materials.notUrgent")}</option>
        </select>
        <button
          type="submit"
          className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold"
          style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
        >
          {t("materials.addItem")}
        </button>
      </form>

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : items.length === 0 ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("materials.empty")}
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="task-card flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              style={{ "--task-accent": item.color, opacity: item.delivered ? 0.55 : 1 } as React.CSSProperties}
            >
              <input
                type="checkbox"
                checked={item.delivered}
                onChange={(e) => void toggleDelivered(item.id, e.target.checked)}
                className="h-4 w-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <span
                  className="text-sm font-semibold text-[var(--text-primary)]"
                  style={{ textDecoration: item.delivered ? "line-through" : "none" }}
                >
                  {item.name}
                </span>
                {item.quantity ? (
                  <span className="ml-2 text-xs text-[var(--text-muted)]">×{item.quantity}</span>
                ) : null}
              </div>
              <span
                className="shrink-0 rounded-full"
                style={{ width: 8, height: 8, background: item.color }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// ── Receipts sub-component ──

const STORES = [
  "Home Depot",
  "Lowe's",
  "Floor & Decor",
  "Harbor Freight",
  "Ferguson",
  "Supply Masters",
];

type ReceiptItem = {
  id: string;
  storagePath: string;
  url: string;
  filename: string;
  storeName: string;
  amount: number;
  purchaseDate: string;
  note: string;
  uploaderName: string;
  isImage: boolean;
};

function ReceiptsSection({
  orgId,
  projectId,
  managerId,
}: {
  orgId: string;
  projectId: string;
  managerId: string;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Mobile-first capture: separate hidden input with capture="environment"
  // so tapping the camera button on phone goes straight to the rear camera
  // instead of bouncing through the OS file picker.
  const cameraRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("media")
        .select("*")
        .eq("project_id", projectId)
        .eq("metadata->>category", "receipt")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      const rows = (data ?? []) as Array<Media & { metadata: Record<string, unknown> }>;

      // Sign every receipt URL in one batch round-trip. The "media" bucket
      // is Private, so getPublicUrl produces 404'ing URLs — same root cause
      // already fixed in TaskAttachmentList. 1h TTL is plenty for browsing.
      const paths = rows.map((r) => r.storage_path);
      let signedByPath = new Map<string, string>();
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage
          .from("media")
          .createSignedUrls(paths, 3600);
        signedByPath = new Map(
          (signed ?? [])
            .filter((s): s is { path: string; signedUrl: string; error: null } =>
              Boolean(s.signedUrl && s.path),
            )
            .map((s) => [s.path, s.signedUrl]),
        );
      }

      setReceipts(
        rows.map((r) => ({
          id: r.id,
          storagePath: r.storage_path,
          url: signedByPath.get(r.storage_path) ?? "",
          filename: r.filename ?? "receipt",
          storeName: (r.metadata?.store_name as string) ?? "",
          amount: (r.metadata?.amount as number) ?? 0,
          purchaseDate: (r.metadata?.purchase_date as string) ?? "",
          note: r.caption ?? "",
          uploaderName: (r.metadata?.uploader_name as string) ?? "",
          isImage: r.mime_type?.startsWith("image/") ?? false,
        })),
      );
      setLoading(false);
    }
    void load();
  }, [supabase, projectId]);

  const total = receipts.reduce((sum, r) => sum + r.amount, 0);

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    // Either ref may hold the user's selection — dropzone (file picker /
    // drag-drop) or the new mobile camera button. Whichever has files
    // wins; if both have files (rare), the dropzone takes precedence.
    const files =
      fileRef.current?.files && fileRef.current.files.length > 0
        ? fileRef.current.files
        : cameraRef.current?.files;
    if (!files || files.length === 0) return;

    const storeName = fd.get("store")?.toString() ?? "";
    const otherStore = fd.get("store_other")?.toString().trim() ?? "";
    const finalStore = storeName === "__other" ? otherStore : storeName;
    const amount = Number.parseFloat(fd.get("amount")?.toString() ?? "0");
    const purchaseDate = fd.get("purchase_date")?.toString() ?? new Date().toISOString().slice(0, 10);
    const note = fd.get("note")?.toString().trim() ?? "";

    if (!finalStore || !amount) return;

    // Wave 8 client validation against STORAGE_LIMITS_MB.
    for (const file of Array.from(files)) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const error = validation.error;
        if (error.reason === "too_large") {
          const key =
            error.kind === "photo"
              ? "uploads.tooLargePhoto"
              : error.kind === "video"
                ? "uploads.tooLargeVideo"
                : "uploads.tooLargePdf";
          setMessage(t(key));
        } else {
          setMessage(t("uploads.unsupportedType").replace("{kind}", error.mime));
        }
        return;
      }
    }

    setUploading(true);
    setMessage("");

    for (const file of Array.from(files)) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orgId}/${projectId}/receipts/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, cacheControl: "3600" });

      if (uploadErr) {
        setMessage(t("messages.uploadFailed"));
        setUploading(false);
        return;
      }

      const mimeType = file.type || "application/octet-stream";
      const mediaType = mimeType.startsWith("image/") ? "photo" : "pdf";

      const metadata = {
        kind: "receipt" as const,
        category: "receipt" as const,
        store_name: finalStore,
        amount,
        purchase_date: purchaseDate,
        uploader_name: "Manager",
      };
      if (metadata.kind !== "receipt") {
        console.warn("[upload-guard] expected metadata.kind=receipt, got:", metadata);
      }
      const { data: row, error: insertErr } = await supabase
        .from("media")
        .insert({
          org_id: orgId,
          project_id: projectId,
          uploaded_by: managerId,
          media_type: mediaType,
          storage_path: path,
          filename: file.name,
          file_size: file.size,
          mime_type: mimeType,
          caption: note || null,
          is_checkout: false,
          time_event_id: null,
          metadata,
        })
        .select("id")
        .single();

      if (insertErr || !row) {
        setMessage(t("messages.uploadFailed"));
        setUploading(false);
        return;
      }

      const { data: signedData } = await supabase.storage
        .from("media")
        .createSignedUrl(path, 3600);
      setReceipts((prev) => [
        {
          id: row.id,
          storagePath: path,
          url: signedData?.signedUrl ?? "",
          filename: file.name,
          storeName: finalStore,
          amount,
          purchaseDate,
          note,
          uploaderName: "Manager",
          isImage: mimeType.startsWith("image/"),
        },
        ...prev,
      ]);
    }

    setUploading(false);
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }

  async function handleDelete(receipt: ReceiptItem) {
    await supabase
      .from("media")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", receipt.id);
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    setMessage(t("receipts.deleted"));
    setTimeout(() => setMessage(""), 2000);
  }

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const [showOther, setShowOther] = useState(false);

  return (
    <section className="surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("receipts.title")}</h2>
        {receipts.length > 0 ? (
          <div className="text-sm text-[var(--text-secondary)]">
            {t("receipts.total")}: <span className="font-semibold text-[var(--brand-yellow)]">{currency.format(total)}</span>
            {" "}<span className="text-[var(--text-muted)]">({receipts.length} {t("receipts.items")})</span>
          </div>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{t("projectDetail.receiptsSubtitle")}</p>

      {message ? (
        <div className="mt-3 text-xs font-semibold" style={{ color: "var(--green)" }}>{message}</div>
      ) : null}

      <form className="mt-4 grid gap-3" onSubmit={handleUpload}>
        {/* Drop zone */}
        <div
          className="relative rounded-[var(--radius-md)] border-2 border-dashed p-4 text-center transition-colors"
          style={{
            borderColor: dragging ? "var(--brand-yellow)" : "var(--border-default)",
            background: dragging ? "rgba(191,162,52,0.06)" : "var(--bg-primary)",
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (fileRef.current && e.dataTransfer.files.length) {
              fileRef.current.files = e.dataTransfer.files;
            }
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,application/pdf"
            multiple
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={() => {/* just for re-render */}}
          />
          <div className="text-sm text-[var(--text-secondary)]">{t("receipts.selectFiles")}</div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">JPG, PNG, HEIC, PDF</div>
          <div className="mt-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
            {t("receipts.inlineLabel")}
          </div>
        </div>

        {/* Mobile camera shortcut. capture="environment" hints rear cam;
            on desktop the button just opens the native file picker. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={() => {/* just for re-render */}}
        />
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm font-semibold text-[var(--text-secondary)]"
        >
          {t("receipts.takePhoto")}
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <select
            name="store"
            required
            defaultValue=""
            onChange={(e) => setShowOther(e.target.value === "__other")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="" disabled>{t("receipts.store")}</option>
            {STORES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="__other">{t("receipts.other")}</option>
          </select>
          {showOther ? (
            <TextInputWithVoice
              name="store_other"
              placeholder={t("receipts.store")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
            />
          ) : (
            <input
              name="amount"
              type="number"
              step="0.01"
              required
              placeholder={t("receipts.amount")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
            />
          )}
        </div>

        {showOther ? (
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            placeholder={t("receipts.amount")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            name="purchase_date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
          <TextInputWithVoice
            name="note"
            placeholder={t("receipts.note")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={uploading}
          className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold"
          style={{
            background: uploading ? "var(--border-default)" : "var(--brand-yellow)",
            color: uploading ? "var(--text-muted)" : "var(--text-inverse)",
          }}
        >
          {uploading ? t("receipts.uploading") : t("receipts.upload")}
        </button>
      </form>

      {/* Receipt grid */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading ? (
          <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : receipts.length === 0 ? (
          <div className="col-span-full rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
            {t("receipts.empty")}
          </div>
        ) : (
          receipts.map((r) => (
            <div
              key={r.id}
              className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-default)]"
              style={{ background: "var(--bg-primary)" }}
            >
              {/* Thumbnail / PDF icon */}
              {r.isImage ? (
                <button
                  type="button"
                  onClick={() => setLightboxUrl(r.url)}
                  className="block h-32 w-full overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.url} alt={r.filename} className="h-full w-full object-cover" />
                </button>
              ) : (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-32 w-full items-center justify-center"
                  style={{ background: "var(--bg-card)" }}
                >
                  <div className="text-center">
                    <div className="text-2xl">📄</div>
                    <div className="mt-1 text-[10px] text-[var(--text-muted)]">PDF</div>
                  </div>
                </a>
              )}
              <div className="p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{r.storeName}</div>
                    <div className="text-lg font-bold text-[var(--brand-yellow)]">{currency.format(r.amount)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDelete(r)}
                    className="shrink-0 text-[10px] text-[var(--text-muted)] hover:text-[var(--red)]"
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {r.purchaseDate} • {r.uploaderName}
                </div>
                {r.note ? (
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">{r.note}</div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Lightbox */}
      {lightboxUrl ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Receipt"
            className="max-h-[85vh] max-w-[90vw] rounded-[var(--radius-lg)] object-contain"
          />
        </div>
      ) : null}
    </section>
  );
}

// ── Store Visits sub-component ──

function StoreVisitsSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [visits, setVisits] = useState<Array<{
    id: string;
    workerName: string;
    storeName: string;
    storeChain: string;
    enteredAt: string;
    durationMin: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      // In production, query store_visits joined with supply_stores and profiles
      // For preview, show mock data
      const { data } = await supabase
        .from("store_visits")
        .select("*")
        .eq("source_project_id", projectId)
        .order("entered_at", { ascending: false })
        .limit(20);

      if (data && data.length > 0) {
        setVisits(
          (data as Array<{
            id: string;
            worker_name: string;
            store_name: string;
            store_chain: string;
            entered_at: string;
            duration_seconds: number;
          }>).map((v) => ({
            id: v.id,
            workerName: v.worker_name ?? "Unknown",
            storeName: v.store_name ?? "Unknown",
            storeChain: v.store_chain ?? "",
            enteredAt: v.entered_at,
            durationMin: Math.round((v.duration_seconds ?? 0) / 60),
          })),
        );
      }
      setLoading(false);
    }
    void load();
  }, [supabase, projectId]);

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("stores.visits")}</h2>
      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : visits.length === 0 ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("stores.noVisits")}
          </div>
        ) : (
          visits.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
            >
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {v.workerName} → {v.storeName}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {formatDateTime(v.enteredAt)}
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-[var(--brand-yellow)]">
                {v.durationMin} {t("stores.visitDuration")}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
