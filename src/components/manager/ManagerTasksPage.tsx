"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { ACCEPT_ALL_UPLOADS, validateUploadFile } from "@/lib/upload-limits";
import {
  getAttachmentMediaIds,
  linkMediaToTask,
  type TaskAttachmentRef,
  uploadTaskAttachment,
} from "@/lib/task-attachments";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import type {
  ProjectStatus,
  Task,
  TaskPriority,
  TaskStatus,
  UserRole,
} from "@/types/database";

type ProjectOption = { id: string; name: string; status: ProjectStatus };
type WorkerOption = { id: string; name: string; role: UserRole };
type TaskRow = Task & { projectName: string | null; assigneeName: string | null };

const PRIORITY_OPTIONS: TaskPriority[] = ["low", "medium", "high", "urgent"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "done", "cancelled"];

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "#ef4444",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#22c55e",
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "var(--text-muted)",
  in_progress: "var(--blue)",
  done: "var(--green)",
  cancelled: "var(--red)",
};

export function ManagerTasksPage({
  orgId,
  managerId,
  projects,
  workers,
  initialTasks,
  attachmentMedia = [],
}: {
  orgId: string;
  managerId: string;
  projects: ProjectOption[];
  workers: WorkerOption[];
  initialTasks: TaskRow[];
  attachmentMedia?: TaskAttachmentRef[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t } = useTranslation();

  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");

  const [filterProject, setFilterProject] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const workersById = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);
  const attachmentById = useMemo(
    () => new Map(attachmentMedia.map((m) => [m.id, m])),
    [attachmentMedia],
  );

  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (filterProject && task.project_id !== filterProject) return false;
      if (filterStatus && task.status !== filterStatus) return false;
      return true;
    });
  }, [tasks, filterProject, filterStatus]);

  function priorityLabel(priority: TaskPriority): string {
    if (priority === "urgent") return t("tasks.priorityUrgent");
    if (priority === "high") return t("tasks.priorityHigh");
    if (priority === "medium") return t("tasks.priorityMedium");
    return t("tasks.priorityLow");
  }

  function statusLabel(status: TaskStatus): string {
    if (status === "in_progress") return t("tasks.statusInProgress");
    if (status === "done") return t("tasks.statusDone");
    if (status === "cancelled") return t("tasks.statusCancelled");
    return t("tasks.statusPending");
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const title = formData.get("title")?.toString().trim() ?? "";
    if (!title) {
      setMessage(t("projectDetail.taskTitleRequired"));
      setMessageTone("error");
      return;
    }

    const projectId = formData.get("project_id")?.toString() || null;
    const assignedTo = formData.get("assigned_to")?.toString() || null;
    const priority = (formData.get("priority")?.toString() ?? "medium") as TaskPriority;
    const dueDate = formData.get("due_date")?.toString() || null;
    const description = formData.get("description")?.toString().trim() || null;

    setBusyKey("create");
    setMessage("");

    // Attachments require a project (storage path includes projectId).
    if (attachmentFiles.length > 0 && !projectId) {
      setMessage(t("tasks.attachmentNeedsProject"));
      setMessageTone("error");
      setBusyKey(null);
      return;
    }

    console.log("[task-attach] ManagerTasksPage create: file count", attachmentFiles.length);

    const uploadedMediaIds: string[] = [];
    for (const file of attachmentFiles) {
      // Cloud-picker guard: see ProjectDetailPage.handleCreateTask.
      if (!file || file.size === 0 || !file.name) {
        console.error("[task-attach] invalid File detected (likely cloud picker)", {
          name: file?.name,
          size: file?.size,
          type: file?.type,
        });
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        console.error("[task-attach] ManagerTasksPage validation FAIL", validation.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      const result = await uploadTaskAttachment(supabase, {
        orgId,
        projectId: projectId!,
        uploadedBy: managerId,
        file,
      });
      if (!result.ok) {
        console.error("[task-attach] ManagerTasksPage upload FAIL", result.error);
        setMessage(t("tasks.attachmentCloudFallback"));
        setMessageTone("error");
        setBusyKey(null);
        return;
      }
      uploadedMediaIds.push(result.mediaId);
    }

    console.log("[task-attach] ManagerTasksPage task insert begin", {
      hasAttachments: uploadedMediaIds.length > 0,
    });
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        org_id: orgId,
        project_id: projectId,
        assigned_to: assignedTo,
        assigned_by: managerId,
        title,
        description,
        priority,
        status: "pending",
        due_date: dueDate,
        metadata: uploadedMediaIds.length > 0
          ? { attachment_media_ids: uploadedMediaIds }
          : {},
      })
      .select("*")
      .single<Task>();

    setBusyKey(null);

    if (error || !data) {
      console.error("[task-attach] ManagerTasksPage task insert FAIL", error);
      setMessage(`task-insert: ${error?.message ?? "no data"}`);
      setMessageTone("error");
      return;
    }
    console.log("[task-attach] ManagerTasksPage task insert ok", { taskId: data.id });

    if (uploadedMediaIds.length > 0) {
      void linkMediaToTask(supabase, data.id, uploadedMediaIds);
    }

    setTasks((prev) => [
      {
        ...data,
        projectName: projectId ? projectsById.get(projectId)?.name ?? null : null,
        assigneeName: assignedTo ? workersById.get(assignedTo)?.name ?? null : null,
      },
      ...prev,
    ]);
    form.reset();
    setAttachmentFiles([]);
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    setMessage(t("tasks.created"));
    setMessageTone("success");
    router.refresh();
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    setBusyKey(`status-${taskId}`);
    const patch: Record<string, unknown> = { status };
    if (status === "done") {
      patch.completed_at = new Date().toISOString();
      patch.completed_by = managerId;
    } else {
      patch.completed_at = null;
      patch.completed_by = null;
    }
    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status, completed_at: status === "done" ? new Date().toISOString() : null }
          : t,
      ),
    );
  }

  async function handleDelete(taskId: string) {
    if (typeof window !== "undefined" && !window.confirm(t("trash.deleteConfirm"))) return;
    setBusyKey(`delete-${taskId}`);
    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", taskId);
    setBusyKey(null);
    if (error) {
      setMessage(error.message);
      setMessageTone("error");
      return;
    }
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    setMessage(t("tasks.deleted"));
    setMessageTone("success");
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("common.tasks")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("tasks.subtitle")}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("tasks.descriptionLong")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{
            background: messageTone === "error" ? "rgba(212, 81, 94, 0.12)" : "rgba(15, 168, 120, 0.16)",
            color: messageTone === "error" ? "var(--red)" : "var(--green)",
          }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        {/* ── Assign Task ── */}
        <div className="surface-card p-4">
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: "rgba(191, 162, 52, 0.12)" }}
            >
              <Plus size={16} style={{ color: "var(--brand-yellow)" }} />
            </span>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("tasks.assignTask")}
            </h2>
          </div>

          <form className="mt-4 grid gap-3" onSubmit={handleCreate}>
            <TextInputWithVoice
              name="title"
              placeholder={t("tasks.titlePlaceholder")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                name="project_id"
                defaultValue=""
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.projectSelect")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>

              <select
                name="assigned_to"
                defaultValue=""
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.workerSelect")}</option>
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.name} · {worker.role}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <select
                name="priority"
                defaultValue="medium"
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                {PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabel(priority)}
                  </option>
                ))}
              </select>

              <DateField
                name="due_date"
                label={t("tasks.dueDate")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>

            <TextInputWithVoice
              multiline
              name="description"
              placeholder={t("tasks.descriptionPlaceholder")}
              className="min-h-[100px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />

            <div className="space-y-2">
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept={ACCEPT_ALL_UPLOADS}
                onChange={(e) =>
                  setAttachmentFiles(e.target.files ? Array.from(e.target.files) : [])
                }
                className="block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
              />
              {attachmentFiles.length > 0 ? (
                <div className="text-[10px] text-[var(--text-muted)]">
                  {attachmentFiles.length} {t("tasks.attachmentsCount")}
                </div>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={busyKey === "create"}
              className="button-base button-primary"
            >
              {busyKey === "create" ? t("common.creating") : t("tasks.assignTask")}
            </button>
          </form>
        </div>

        {/* ── All Tasks ── */}
        <div className="surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("tasks.allTasks")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={filterProject}
                onChange={(e) => setFilterProject(e.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.allProjects")}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("tasks.allStatuses")}</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 max-h-[600px] space-y-2 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {visibleTasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-center text-sm text-[var(--text-secondary)]">
                {t("tasks.noTasks")}
              </div>
            ) : (
              visibleTasks.map((task) => {
                const accent = PRIORITY_COLORS[task.priority];
                const statusColor = STATUS_COLORS[task.status];
                const updating = busyKey === `status-${task.id}` || busyKey === `delete-${task.id}`;
                return (
                  <article
                    key={task.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">
                            {task.title}
                          </span>
                          <span
                            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                            style={{ background: `${accent}1f`, color: accent }}
                          >
                            {priorityLabel(task.priority)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                          {task.project_id ? (
                            <Link href={`/projects/${task.project_id}`} className="text-[var(--brand-yellow)]">
                              {task.projectName ?? t("tasks.generalTask")}
                            </Link>
                          ) : (
                            <span>{t("tasks.generalTask")}</span>
                          )}
                          <span>·</span>
                          {task.assigned_to ? (
                            <Link
                              href={`/team/${task.assigned_to}`}
                              className="text-[var(--text-primary)]"
                            >
                              {task.assigneeName ?? t("tasks.unassigned")}
                            </Link>
                          ) : (
                            <span>{t("tasks.unassigned")}</span>
                          )}
                          {task.due_date ? (
                            <>
                              <span>·</span>
                              <span className="font-mono">{t("tasks.due")} {task.due_date}</span>
                            </>
                          ) : null}
                        </div>
                        {task.description ? (
                          <p className="mt-2 line-clamp-2 text-xs text-[var(--text-muted)]">
                            {task.description}
                          </p>
                        ) : null}
                        {(() => {
                          const refs = getAttachmentMediaIds(task)
                            .map((id) => attachmentById.get(id))
                            .filter((m): m is TaskAttachmentRef => Boolean(m));
                          return refs.length > 0 ? <TaskAttachmentList items={refs} /> : null;
                        })()}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <select
                          value={task.status}
                          onChange={(e) => void handleStatusChange(task.id, e.target.value as TaskStatus)}
                          disabled={updating}
                          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1 text-[10px] font-semibold uppercase outline-none"
                          style={{ color: statusColor }}
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>
                              {statusLabel(status)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void handleDelete(task.id)}
                          disabled={updating}
                          aria-label={t("team.actionRemove")}
                          title={t("team.actionRemove")}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                          style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
