"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Plus, Square, Receipt as ReceiptIcon, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { WorkerTaskDetailModal } from "@/components/worker/WorkerTaskDetailModal";
import { WorkerMaterialSpecSection } from "@/components/worker/WorkerMaterialSpecSection";
import {
  ACCEPT_ALL_UPLOADS,
  inferUploadContentType,
  validateUploadFile,
} from "@/lib/upload-limits";
import { useWorkerShell } from "@/components/worker/WorkerShell";
import { CheckoutModal } from "@/components/worker/CheckoutModal";
import { SafetyBriefModal } from "@/components/worker/SafetyBriefModal";
import {
  DEFAULT_SAFETY_VERSION,
  writeSafetyAck,
} from "@/lib/safety-acknowledgements";
import { type TaskAttachmentRef } from "@/lib/task-attachments";
import { splitWorkerProjectTasks } from "@/lib/task-notifications";
import { getEffectiveTaskStatus, isEffectiveOpenTask } from "@/lib/task-status";
import {
  openWorkerProjectTaskDetails,
  submitWorkerTaskCompletion,
  type WorkerTaskModalMode,
} from "@/lib/worker-task-ui";
import {
  MediaViewerModal,
  useMediaViewerOpenGuard,
  type ViewerMediaItem,
} from "@/components/shared/MediaViewerModal";
import type { Project, Task, TaskPriority, TaskStatus } from "@/types/database";

type TaskWithAttachments = Task & {
  attachments?: TaskAttachmentRef[];
  completionAttachments?: TaskAttachmentRef[];
};

type ReceiptItem = {
  id: string;
  filename: string | null;
  mime_type: string | null;
  media_type: string;
  storage_path: string;
  created_at: string;
  store_name: string | null;
  amount: number | null;
};

const STORES = [
  "Home Depot",
  "Lowe's",
  "Floor & Decor",
  "Harbor Freight",
  "Ferguson",
  "Supply Masters",
];

function formatSectionCountSummary(
  title: string,
  parts: Array<{ count: number; label: string; include?: boolean }>,
  emptyLabel = "0",
) {
  const visibleParts = parts.filter((part) => part.include ?? true);
  const body =
    visibleParts.length > 0
      ? visibleParts.map((part) => `${part.count} ${part.label}`).join(", ")
      : emptyLabel;

  return `${title}: ${body}`;
}

type MaterialUnitValue =
  | "шт"
  | "мешок"
  | "упаковка"
  | "м"
  | "м²"
  | "м³"
  | "кг"
  | "л"
  | "лист"
  | "other";

type MaterialOrderDraftRow = {
  id: string;
  name: string;
  quantity: string;
  unit: MaterialUnitValue;
  customUnit: string;
};

const MATERIAL_OTHER_UNIT_VALUE = "другое";

const MATERIAL_UNIT_OPTIONS: Array<{ value: MaterialUnitValue; labelKey: TranslationKey }> = [
  { value: "шт", labelKey: "materials.unitPieces" },
  { value: "мешок", labelKey: "materials.unitBag" },
  { value: "упаковка", labelKey: "materials.unitPack" },
  { value: "м", labelKey: "materials.unitMeter" },
  { value: "м²", labelKey: "materials.unitSquareMeter" },
  { value: "м³", labelKey: "materials.unitCubicMeter" },
  { value: "кг", labelKey: "materials.unitKg" },
  { value: "л", labelKey: "materials.unitLiter" },
  { value: "лист", labelKey: "materials.unitSheet" },
  { value: "other", labelKey: "materials.unitOther" },
];

const MATERIAL_INPUT_STYLE = {
  backgroundColor: "#0f1117",
  color: "#e8eaf0",
} satisfies React.CSSProperties;

const MATERIAL_OPTION_STYLE = {
  backgroundColor: "#0f1117",
  color: "#e8eaf0",
} satisfies React.CSSProperties;

const PROFILE_ROLE_VALUES = new Set([
  "worker",
  "supervisor",
  "driver",
  "subcontractor",
  "manager",
  "admin",
  "owner",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isProfileId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function normalizeProfileDisplayName(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || UUID_PATTERN.test(trimmed) || PROFILE_ROLE_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

function createMaterialOrderRow(): MaterialOrderDraftRow {
  return {
    id: createClientUuid(),
    name: "",
    quantity: "",
    unit: "шт",
    customUnit: "",
  };
}

function createClientUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseMaterialQuantity(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMaterialQuantity(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? value.toString() : String(value);
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function getMaterialPriorityColor(priority: string) {
  if (priority === "urgent" || priority === "high") return "#ef4444";
  if (priority === "medium") return "#f59e0b";
  return "#22c55e";
}

function getMaterialPriorityLabel(priority: string, t: (key: TranslationKey) => string) {
  if (priority === "urgent" || priority === "high") return t("materials.urgent");
  if (priority === "low") return t("materials.notUrgent");
  return t("materials.soon");
}

function formatMaterialDate(value: string | null | undefined) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatMaterialPositionCount(count: number, t: (key: TranslationKey) => string) {
  return t("materials.positionsCount").replace("{count}", String(count));
}

type MaterialStatus = "needed" | "ordered" | "delivered";

type MaterialRow = {
  id: string;
  title: string;
  quantity: string;
  unit: string;
  priority: TaskPriority;
  taskStatus: TaskStatus;
  status: MaterialStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  assignedById: string | null;
  authorName: string;
  deliveredById: string | null;
  deliveredByName: string | null;
  deliveredAt: string | null;
  receiptId: string | null;
  receiptAttachedById: string | null;
  receiptAttachedByName: string | null;
  receipt: ViewerMediaItem | null;
};

type MaterialOrderGroup = {
  id: string;
  orderId: string | null;
  authorName: string;
  createdAt: string;
  priority: TaskPriority;
  note: string;
  items: MaterialRow[];
};

function mapTaskStatusToMaterialStatus(taskStatus: string): MaterialStatus {
  if (taskStatus === "done") return "delivered";
  if (taskStatus === "in_progress") return "ordered";
  return "needed";
}

export function WorkerProjectView({
  project,
  projectMedia,
  projectReceipts,
  tasks,
  orgId,
  profileId,
}: {
  project: Project;
  projectMedia: TaskAttachmentRef[];
  projectReceipts: ReceiptItem[];
  tasks: TaskWithAttachments[];
  orgId: string;
  profileId: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const workerShell = useWorkerShell();
  const { busyAction, updateTaskStatus } = workerShell;
  const supabase = useMemo(() => createClient(), []);
  const [taskList, setTaskList] = useState<TaskWithAttachments[]>(tasks);
  const [projectMediaList, setProjectMediaList] = useState<TaskAttachmentRef[]>(projectMedia);
  const [selectedTask, setSelectedTask] = useState<TaskWithAttachments | null>(null);
  const [selectedTaskMode, setSelectedTaskMode] = useState<WorkerTaskModalMode>("details");
  const [openError, setOpenError] = useState<string | null>(null);
  const [taskCreateBusy, setTaskCreateBusy] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [receiptUploadOpen, setReceiptUploadOpen] = useState(false);
  const [taskCreateMessage, setTaskCreateMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [claimBusyTaskId, setClaimBusyTaskId] = useState<string | null>(null);
  const [claimMessage, setClaimMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const projectMediaInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTaskList(tasks);
  }, [tasks]);

  useEffect(() => {
    setProjectMediaList(projectMedia);
  }, [projectMedia]);

  async function handleClaimTask(taskId: string) {
    setClaimBusyTaskId(taskId);
    setClaimMessage(null);
    try {
      const response = await fetch("/api/worker/claim-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        task?: Task;
      };

      if (!response.ok) {
        const fallback =
          response.status === 409
            ? t("tasks.claimAlreadyAssigned")
            : t("tasks.claimFailed");
        setClaimMessage({ kind: "err", text: payload.error ?? fallback });
        return;
      }

      const claimed = payload.task;
      if (!claimed) {
        setClaimMessage({ kind: "err", text: t("tasks.claimFailed") });
        return;
      }

      // Move the task into "mine" by stamping assigned_to locally —
      // the server already wrote the same row. The Detail Modal will
      // re-render with isMine=true, surfacing Start/Done.
      setTaskList((current) =>
        current.map((task) =>
          task.id === claimed.id
            ? {
                ...task,
                assigned_to: claimed.assigned_to,
                metadata: claimed.metadata ?? task.metadata,
              }
            : task,
        ),
      );
      setClaimMessage({ kind: "ok", text: t("tasks.claimed") });
    } catch {
      setClaimMessage({ kind: "err", text: t("tasks.claimFailed") });
    } finally {
      setClaimBusyTaskId(null);
    }
  }

  // Split tasks into "mine" (assigned to this worker) vs "project-level"
  // (assigned_to IS NULL — visible to the whole crew). Both lists were
  // already loaded by the server route, just split here for display.
  const { mineTasks, projectLevelTasks, completedTasks } = splitWorkerProjectTasks(
    taskList,
    profileId,
  );
  const activeProjectQueue = useMemo(
    () => [...mineTasks, ...projectLevelTasks].filter(isEffectiveOpenTask),
    [mineTasks, projectLevelTasks],
  );
  const personalTasksElsewhere = useMemo(() => {
    return workerShell.shell.tasks
      .filter((task) => task.assigned_to === profileId)
      .filter((task) => task.project_id !== project.id)
      .filter(isEffectiveOpenTask)
      .slice(0, 5);
  }, [profileId, project.id, workerShell.shell.tasks]);
  const activeQueueCount = activeProjectQueue.length + personalTasksElsewhere.length;
  const projectMediaCounts = useMemo(() => {
    let photo = 0;
    let video = 0;
    let pdf = 0;

    for (const item of projectMediaList) {
      if (item.media_type === "photo") photo += 1;
      else if (item.media_type === "video") video += 1;
      else if (item.media_type === "pdf" || item.media_type === "document") {
        pdf += 1;
      }
    }

    return { photo, video, pdf };
  }, [projectMediaList]);
  const tasksFolderSummary = formatSectionCountSummary(t("common.tasks"), [
    { count: mineTasks.length, label: t("workerProject.tasksSummaryMine") },
    { count: projectLevelTasks.length, label: t("workerProject.tasksSummaryProject") },
    {
      count: completedTasks.length,
      label: t("workerProject.tasksSummaryCompleted"),
    },
  ]);
  const mediaFolderSummary = formatSectionCountSummary(
    t("common.media"),
    [
      {
        count: projectMediaCounts.photo,
        label:
          projectMediaCounts.photo === 1
            ? t("projectDetail.mediaSummaryPhotoOne")
            : t("projectDetail.mediaSummaryPhotoMany"),
        include: projectMediaCounts.photo > 0,
      },
      {
        count: projectMediaCounts.video,
        label:
          projectMediaCounts.video === 1
            ? t("projectDetail.mediaSummaryVideoOne")
            : t("projectDetail.mediaSummaryVideoMany"),
        include: projectMediaCounts.video > 0,
      },
      {
        count: projectMediaCounts.pdf,
        label:
          projectMediaCounts.pdf === 1
            ? t("projectDetail.mediaSummaryPdfOne")
            : t("projectDetail.mediaSummaryPdfMany"),
        include: projectMediaCounts.pdf > 0,
      },
    ],
    t("projectDetail.mediaSummaryEmpty"),
  );
  // Refresh from the live taskList when we can so claim/status edits made
  // while the modal is open are reflected. Fall back to the stored snapshot
  // if the task is no longer in the list.
  const liveSelectedTask = selectedTask
    ? taskList.find((task) => task.id === selectedTask.id) ?? selectedTask
    : null;

  function openDetails(
    task: TaskWithAttachments | null | undefined,
    mode: WorkerTaskModalMode = "details",
  ) {
    if (!task) {
      setOpenError(t("tasks.openDetailsFailed"));
      return;
    }
    setOpenError(null);
    setSelectedTaskMode(mode);
    setSelectedTask(task);
  }

  function closeDetails() {
    setSelectedTask(null);
    setSelectedTaskMode("details");
    setOpenError(null);
  }

  async function handleCreateProjectTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = formData.get("title")?.toString().trim() ?? "";
    const description = formData.get("description")?.toString().trim() ?? "";
    const priority = (formData.get("priority")?.toString() || "medium") as TaskPriority;

    if (!title) {
      setTaskCreateMessage({ kind: "err", text: t("projectDetail.taskTitleRequired") });
      return;
    }

    setTaskCreateBusy(true);
    setTaskCreateMessage(null);
    const response = await fetch("/api/worker/project-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        title,
        description: description || null,
        priority,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      task?: Task;
    };
    setTaskCreateBusy(false);

    const createdTask = result.task;
    if (!response.ok || !createdTask) {
      setTaskCreateMessage({
        kind: "err",
        text: result.error ?? t("tasks.createTaskFailed"),
      });
      return;
    }

    setTaskList((current) => [{ ...createdTask, attachments: undefined }, ...current]);
    form.reset();
    setTaskCreateMessage({ kind: "ok", text: t("tasks.workerTaskCreated") });
  }

  async function handleWorkerProjectMediaUpload(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;

    const uploadedItems: TaskAttachmentRef[] = [];
    for (const file of list) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        if (validation.error.reason === "too_large") {
          const key =
            validation.error.kind === "photo"
              ? "uploads.tooLargePhoto"
              : validation.error.kind === "video"
                ? "uploads.tooLargeVideo"
                : validation.error.kind === "pdf"
                  ? "uploads.tooLargePdf"
                  : "uploads.tooLargeDocument";
          setOpenError(t(key));
        } else {
          setOpenError(
            t("uploads.unsupportedType").replace("{kind}", validation.error.mime),
          );
        }
        return;
      }

      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orgId}/${project.id}/project-media/${createClientUuid()}-${safeName}`;
      const mimeType = inferUploadContentType(file);
      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, {
          upsert: false,
          cacheControl: "3600",
          contentType: mimeType,
        });

      if (uploadErr) {
        setOpenError(uploadErr.message);
        return;
      }

      const { data: row, error: insertErr } = await supabase
        .from("media")
        .insert({
          org_id: orgId,
          project_id: project.id,
          uploaded_by: profileId,
          media_type: validation.kind,
          storage_path: path,
          filename: file.name,
          file_size: file.size,
          mime_type: mimeType,
          caption: null,
          is_checkout: false,
          time_event_id: null,
          metadata: {
            kind: "project_media",
            source: "worker_project_view",
          },
        })
        .select("id, filename, mime_type, media_type, storage_path")
        .single<TaskAttachmentRef>();

      if (insertErr || !row) {
        setOpenError(insertErr?.message ?? t("messages.uploadFailed"));
        return;
      }

      uploadedItems.push(row);
    }

    if (uploadedItems.length > 0) {
      setProjectMediaList((current) => [...uploadedItems, ...current]);
      setOpenError(null);
    }
  }

  function markLocalTask(taskId: string, status: TaskStatus) {
    setTaskList((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status,
              completed_at: status === "done" ? new Date().toISOString() : null,
              completed_by: status === "done" ? profileId : null,
            }
          : task,
      ),
    );
  }

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
      </section>

      {/* Clock In / Clock Out for THIS project. Reuses the shell's existing
          clockIn / clockOut from useWorkerShell — the GPS prompt, offline
          queue, and require-video gate all flow through unchanged. */}
      <ProjectClockControls projectId={project.id} projectName={project.name} />

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("workerProject.activeQueueTitle")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("workerProject.activeQueueSubtitle")}
            </p>
          </div>
          <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
            {activeQueueCount}
          </span>
        </div>
        {activeQueueCount === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.activeQueueEmpty")}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {activeProjectQueue.slice(0, 4).map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => openWorkerProjectTaskDetails(task, openDetails)}
                className="block w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.5)] p-3 text-left"
              >
                <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {project.name} · {getEffectiveTaskStatus(task).replace("_", " ")}
                </div>
              </button>
            ))}
            {personalTasksElsewhere.map((task) => (
              <Link
                key={task.id}
                href="/my-tasks"
                className="block rounded-[var(--radius-md)] border border-[rgba(191,162,52,0.26)] bg-[rgba(191,162,52,0.08)] p-3"
              >
                <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {task.projectName ?? t("common.general")} · {t("workerProject.activeQueueOtherProject")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Notes — visible to the whole crew. project.notes is on every Project row. */}
      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.notesTitle")}
        </h2>
        {project.notes ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {project.notes}
          </p>
        ) : (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.notesEmpty")}
          </div>
        )}
      </section>

      <WorkerMaterialSpecSection project={project} />

      <CollapsibleSection
        id="media"
        projectId={project.id}
        defaultOpen={false}
        dataTestid="worker-project-media-folder"
        className="p-4"
        summary={
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {mediaFolderSummary}
          </h2>
        }
        headerAction={
          <>
            <input
              ref={projectMediaInputRef}
              type="file"
              accept={ACCEPT_ALL_UPLOADS}
              multiple
              className="hidden"
              onChange={(event) => {
                void handleWorkerProjectMediaUpload(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                projectMediaInputRef.current?.click();
              }}
              className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
              style={{
                borderColor: "rgba(191, 162, 52, 0.4)",
                color: "var(--brand-yellow)",
              }}
            >
              <Plus size={13} />
              {t("projectDetail.addFiles")}
            </button>
          </>
        }
      >
        {projectMediaList.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("workerProject.projectMediaEmpty")}
          </div>
        ) : (
          <div className="mt-2">
            <TaskAttachmentList items={projectMediaList} />
          </div>
        )}
      </CollapsibleSection>

      <WorkerMaterialsList
        orgId={orgId}
        projectId={project.id}
        profileId={profileId}
        currentUserName={workerShell.shell.profile.name}
      />
      <WorkerReceiptUpload
        orgId={orgId}
        projectId={project.id}
        profileId={profileId}
        open={receiptUploadOpen}
        onClose={() => setReceiptUploadOpen(false)}
        onSaved={() => router.refresh()}
      />

      {/* Existing receipts on this project — list view. Worker can tap to
          open the file in a signed Storage URL. */}
      <ProjectReceiptsList
        projectId={project.id}
        items={projectReceipts}
        onAddReceipt={() => setReceiptUploadOpen(true)}
      />

      <CollapsibleSection
        id="tasks"
        projectId={project.id}
        defaultOpen={false}
        persistState={false}
        dataTestid="worker-project-tasks-folder"
        className="p-4"
        contentClassName="space-y-4"
        summary={
          <h2 className="text-lg font-bold text-[var(--text-primary)]">
            {tasksFolderSummary}
          </h2>
        }
        headerAction={
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setTaskCreateMessage(null);
              setTaskComposerOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
            style={{
              borderColor: "rgba(191, 162, 52, 0.4)",
              color: "var(--brand-yellow)",
            }}
          >
            <Plus size={13} />
            {t("projectDetail.createTask")}
          </button>
        }
      >
        {/* My tasks (assigned_to = me) */}
        <section className="surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("workerProject.tasksMineTitle")}
            </h2>
            <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
              {mineTasks.length}
            </span>
          </div>
          {mineTasks.length === 0 ? (
            <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
              {t("workerProject.tasksEmpty")}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {mineTasks.map((task) => (
                <WorkerTaskCard
                  key={task.id}
                  task={task}
                  t={t}
                  onOpen={() => openWorkerProjectTaskDetails(task, openDetails)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Project-level tasks (assigned_to IS NULL) */}
        <section className="surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("workerProject.tasksProjectTitle")}
            </h2>
            <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
              {projectLevelTasks.length}
            </span>
          </div>
          <form className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3" onSubmit={handleCreateProjectTask}>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              <Plus size={13} />
              {t("tasks.addProjectTask")}
            </div>
            {taskCreateMessage ? (
              <div
                className="mb-2 text-xs font-semibold"
                style={{ color: taskCreateMessage.kind === "ok" ? "var(--green)" : "var(--red)" }}
              >
                {taskCreateMessage.text}
              </div>
            ) : null}
            <div className="grid gap-2">
              <input
                name="title"
                placeholder={t("tasks.titlePlaceholder")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
              <TextInputWithVoice
                multiline
                name="description"
                rows={2}
                placeholder={t("tasks.descriptionPlaceholder")}
                className="min-h-[74px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="flex flex-wrap gap-2">
                <select
                  name="priority"
                  defaultValue="medium"
                  className="min-w-[150px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                >
                  <option value="low">{t("tasks.priorityLow")}</option>
                  <option value="medium">{t("tasks.priorityMedium")}</option>
                  <option value="high">{t("tasks.priorityHigh")}</option>
                  <option value="urgent">{t("tasks.priorityUrgent")}</option>
                </select>
                <button
                  type="submit"
                  disabled={taskCreateBusy}
                  className="inline-flex min-w-[130px] flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
                  style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                >
                  {taskCreateBusy ? t("common.saving") : t("tasks.addProjectTaskCta")}
                </button>
              </div>
            </div>
          </form>

          {projectLevelTasks.length === 0 ? (
            <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
              {t("workerProject.tasksEmpty")}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {projectLevelTasks.map((task) => (
                <WorkerTaskCard
                  key={task.id}
                  task={task}
                  t={t}
                  onOpen={() => openWorkerProjectTaskDetails(task, openDetails)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Completed tasks stay visible for audit and evidence review. */}
        <section className="surface-card surface-card--muted p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("tasks.completedSection")}
            </h2>
            <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
              {completedTasks.length}
            </span>
          </div>
          {completedTasks.length === 0 ? (
            <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
              {t("tasks.completedWillLand")}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {completedTasks.map((task) => (
                <WorkerTaskCard
                  key={task.id}
                  task={task}
                  t={t}
                  onOpen={() => openWorkerProjectTaskDetails(task, openDetails)}
                />
              ))}
            </div>
          )}
        </section>
      </CollapsibleSection>

      {taskComposerOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setTaskComposerOpen(false)}
        >
          <div
            className="surface-card w-full max-w-[640px] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("projectDetail.createTask")}
              </h2>
              <button
                type="button"
                onClick={() => setTaskComposerOpen(false)}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                ×
              </button>
            </div>
            <form className="mt-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3" onSubmit={handleCreateProjectTask}>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                <Plus size={13} />
                {t("tasks.addProjectTask")}
              </div>
              {taskCreateMessage ? (
                <div
                  className="mb-2 text-xs font-semibold"
                  style={{ color: taskCreateMessage.kind === "ok" ? "var(--green)" : "var(--red)" }}
                >
                  {taskCreateMessage.text}
                </div>
              ) : null}
              <div className="grid gap-2">
                <input
                  name="title"
                  placeholder={t("tasks.titlePlaceholder")}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                />
                <TextInputWithVoice
                  multiline
                  name="description"
                  rows={2}
                  placeholder={t("tasks.descriptionPlaceholder")}
                  className="min-h-[74px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                />
                <div className="flex flex-wrap gap-2">
                  <select
                    name="priority"
                    defaultValue="medium"
                    className="min-w-[150px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                  >
                    <option value="low">{t("tasks.priorityLow")}</option>
                    <option value="medium">{t("tasks.priorityMedium")}</option>
                    <option value="high">{t("tasks.priorityHigh")}</option>
                    <option value="urgent">{t("tasks.priorityUrgent")}</option>
                  </select>
                  <button
                    type="submit"
                    disabled={taskCreateBusy}
                    className="inline-flex min-w-[130px] flex-1 items-center justify-center rounded-[var(--radius-sm)] px-3 py-2.5 text-sm font-semibold disabled:opacity-60"
                    style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                  >
                    {taskCreateBusy ? t("common.saving") : t("tasks.addProjectTaskCta")}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {claimMessage ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
          style={{
            background:
              claimMessage.kind === "ok"
                ? "rgba(15, 168, 120, 0.16)"
                : "rgba(212, 81, 94, 0.12)",
            color: claimMessage.kind === "ok" ? "var(--green)" : "var(--red)",
          }}
        >
          {claimMessage.text}
        </div>
      ) : null}

      {openError ? (
        <div
          role="alert"
          data-testid="worker-task-open-error"
          className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-semibold"
          style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}
        >
          {openError}
        </div>
      ) : null}

      <WorkerTaskDetailModal
        task={liveSelectedTask ? { ...liveSelectedTask, projectName: project.name } : null}
        initialMode={selectedTaskMode}
        profileId={profileId}
        busy={
          liveSelectedTask
            ? busyAction === `task-${liveSelectedTask.id}` ||
              claimBusyTaskId === liveSelectedTask.id
            : false
        }
        onClose={closeDetails}
        onStart={(taskId) => {
          void (async () => {
            const ok = await updateTaskStatus(taskId, "in_progress");
            if (ok) {
              markLocalTask(taskId, "in_progress");
            }
          })();
        }}
        onDone={(taskId, payload) => {
          // Defer the optimistic flip to "done" until updateTaskStatus
          // actually returns ok. If the mutation throws (RLS denial,
          // missing flag, network) we leave the card in its current
          // section so the UI doesn't lie. router.refresh() inside
          // updateTaskStatus will re-fetch tasks from SSR for the
          // canonical state on the next render either way.
          submitWorkerTaskCompletion(
            async (id, status, completionPayload) => {
              const ok = await updateTaskStatus(id, status, {
                ...completionPayload,
                // The completion modal is the only legitimate caller
                // for status="done" — the guard inside updateTaskStatus
                // refuses any done-mutation that lacks this flag.
                submittedFromCompletionModal: true,
                projectId: liveSelectedTask?.project_id ?? null,
                existingMetadata: liveSelectedTask?.metadata ?? null,
              });
              if (ok) {
                markLocalTask(id, "done");
              }
            },
            taskId,
            payload,
          );
        }}
        onClaim={(taskId) => void handleClaimTask(taskId)}
      />
    </div>
  );
}

function WorkerTaskCard({
  task,
  t,
  onOpen,
}: {
  task: TaskWithAttachments;
  t: ReturnType<typeof useTranslation>["t"];
  onOpen: () => void;
}) {
  // Priority pill is colored by importance (red/amber/green). Status
  // pill is colored by lifecycle (muted/blue/green/red). Keeping them
  // visually distinct matters because before this fix an urgent (red)
  // task could be misread as a cancelled (red) task at a glance.
  const prioColor =
    task.priority === "urgent" || task.priority === "high"
      ? "#ef4444"
      : task.priority === "medium"
        ? "#f59e0b"
        : "#22c55e";
  const effectiveStatus = getEffectiveTaskStatus(task);
  const statusColor =
    effectiveStatus === "done"
      ? "var(--green)"
      : effectiveStatus === "in_progress"
        ? "var(--blue)"
        : effectiveStatus === "cancelled"
          ? "var(--red)"
          : "var(--text-muted)";
  const statusLabelText =
    effectiveStatus === "done"
      ? t("tasks.statusDone")
      : effectiveStatus === "in_progress"
        ? t("tasks.statusInProgress")
        : effectiveStatus === "cancelled"
          ? t("tasks.statusCancelled")
          : t("tasks.statusPending");
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onOpen();
  }

  function openFromInner(event: MouseEvent) {
    event.stopPropagation();
    onOpen();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      data-testid="worker-project-task-card"
      className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-left outline-none focus:ring-2 focus:ring-[var(--brand-yellow)]"
    >
      <div
        data-testid="worker-task-open-details"
        className="text-left text-sm font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline"
      >
        {task.title}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ background: `${prioColor}1f`, color: prioColor }}
        >
          {task.priority}
        </span>
        <span
          className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ background: "rgba(148, 163, 184, 0.10)", color: statusColor }}
        >
          {statusLabelText}
        </span>
      </div>
      {task.description ? (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{task.description}</p>
      ) : null}
      {task.attachments && task.attachments.length > 0 ? (
        <div onClick={(event) => event.stopPropagation()}>
          <div className="mt-2 text-[10px] text-[var(--text-muted)]">
            📎 {task.attachments.length} {t("tasks.filesShort")}
          </div>
          <TaskAttachmentList items={task.attachments} />
        </div>
      ) : null}
      <button
        type="button"
        onClick={openFromInner}
        data-testid="worker-task-open-details"
        className="mt-3 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
        style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
      >
        {t("tasks.viewDetails")}
      </button>
    </div>
  );
}

function ProjectReceiptsList({
  projectId,
  items,
  onAddReceipt,
}: {
  projectId: string;
  items: ReceiptItem[];
  onAddReceipt: () => void;
}) {
  const { t } = useTranslation();
  const [viewerItem, setViewerItem] = useState<ReceiptItem | null>(null);
  const { canOpenViewerItem, suppressViewerItem } = useMediaViewerOpenGuard();
  const receiptsSummary = formatSectionCountSummary(t("workerProject.receiptsTitle"), [
    { count: items.length, label: t("receipts.items") },
  ]);

  // Primary tap on a receipt opens the shared in-app viewer modal
  // instead of redirecting a new browser tab. Photos render inline,
  // PDFs render in an iframe, and the viewer offers a Download
  // fallback for any preview that the browser cannot decode.
  function open(item: ReceiptItem) {
    if (!canOpenViewerItem(item.id)) return;
    setViewerItem(item);
  }

  function closeViewer() {
    const itemId = viewerItem?.id;
    setViewerItem(null);
    suppressViewerItem(itemId);
  }

  return (
    <CollapsibleSection
      id="receipts"
      projectId={projectId}
      defaultOpen={false}
      dataTestid="worker-project-receipts-folder"
      className="p-4"
      summary={
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {receiptsSummary}
        </h2>
      }
      headerAction={
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onAddReceipt();
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
          style={{
            borderColor: "rgba(191, 162, 52, 0.4)",
            color: "var(--brand-yellow)",
          }}
        >
          <Plus size={13} />
          {t("receipts.addReceipt")}
        </button>
      }
    >
      {items.length === 0 ? (
        <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
          {t("workerProject.receiptsEmpty")}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void open(item)}
              className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3 text-left"
            >
              <div className="flex min-w-0 items-center gap-2">
                <ReceiptIcon size={14} className="shrink-0 text-[var(--brand-yellow)]" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {item.store_name ?? item.filename ?? t("workerProject.receiptsTitle")}
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                    {item.created_at.slice(0, 10)}
                  </div>
                </div>
              </div>
              {item.amount !== null && Number.isFinite(item.amount) ? (
                <span className="shrink-0 font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                  ${item.amount.toFixed(2)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      <MediaViewerModal
        item={
          viewerItem
            ? {
                id: viewerItem.id,
                storage_path: viewerItem.storage_path,
                filename: viewerItem.filename,
                mime_type: viewerItem.mime_type,
                media_type: viewerItem.media_type,
                created_at: viewerItem.created_at,
              }
            : null
        }
        onClose={closeViewer}
      />
    </CollapsibleSection>
  );
}

/**
 * Clock In / Clock Out for THIS project. Routes both actions through the
 * existing WorkerShell.clockIn / clockOut via useWorkerShell — keeping the
 * GPS prompt, offline queue, no-GPS path, and require-video gate intact
 * without duplicating any clock logic.
 *
 * Three render branches:
 *   1. Worker is currently clocked in to THIS project → "End shift" button +
 *      opens the existing CheckoutModal (which gates on require_video).
 *   2. Worker is clocked in to a DIFFERENT project → warning panel with the
 *      conflicting project's name and an explicit "End there and start here"
 *      button. The "switch" calls clockOut() then clockIn(thisProjectId).
 *   3. Worker is not clocked in → plain "Start shift" button → clockIn(thisProjectId).
 */
function ProjectClockControls({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const { shell, busyAction, clockIn } = useWorkerShell();
  const { t } = useTranslation();
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [pendingNoGpsStart, setPendingNoGpsStart] = useState(false);
  const [savingAck, setSavingAck] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const isClockedIn = shell.clockState.isClockedIn;
  const currentProjectId = shell.clockState.currentProjectId;
  const currentProjectName = shell.clockState.currentProjectName;
  const clockedInHere = isClockedIn && currentProjectId === projectId;
  const clockedInElsewhere = isClockedIn && currentProjectId !== projectId;
  const startingShift = busyAction === "clock-in";

  function handleStart(noGps = false) {
    setAckError(null);
    setPendingNoGpsStart(noGps);
    setSafetyOpen(true);
  }

  async function handleSafetyConfirm() {
    // The safety brief is the audit gate: the shift cannot open without
    // a corresponding safety_acknowledgements row. If the insert fails
    // (RLS denial, missing migration, network) we keep the modal open,
    // surface the error, and refuse to clockIn. The worker can retry —
    // tapping Confirm again re-attempts the write.
    setSavingAck(true);
    setAckError(null);
    let ackOk = false;
    try {
      const ackResult = await writeSafetyAck(supabase, {
        orgId: shell.profile.org_id,
        workerId: shell.profile.id,
        projectId,
        safetyVersion: DEFAULT_SAFETY_VERSION,
      });
      if (ackResult.ok) {
        ackOk = true;
      } else {
        setAckError(ackResult.error);
      }
    } catch (err) {
      setAckError(err instanceof Error ? err.message : "Save failed");
    }
    setSavingAck(false);
    if (!ackOk) {
      return;
    }
    setSafetyOpen(false);
    void clockIn(
      projectId,
      pendingNoGpsStart
        ? { skipGps: true, gpsErrorKind: "unavailable" }
        : undefined,
    );
    setPendingNoGpsStart(false);
  }

  async function handleSwitch() {
    setCheckoutOpen(true);
    // Once the worker confirms in CheckoutModal, the modal calls clockOut()
    // and closes itself. The next render will see isClockedIn=false; the
    // worker can tap Start Shift here. We don't auto-chain into clockIn
    // because the require-video / GPS-prompt branches inside clockOut may
    // need worker interaction first.
  }

  return (
    <section className="surface-card p-4">
      <h2 className="text-lg font-bold text-[var(--text-primary)]">
        {t("workerProject.clockSectionTitle")}
      </h2>

      {clockedInHere ? (
        <>
          <p
            className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "rgba(46, 166, 122, 0.14)", color: "var(--green)" }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {t("workerProject.clockedInHere")}
          </p>
          <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold"
            style={{ background: "var(--red)", color: "white" }}
          >
            <Square size={14} />
            {t("clock.endShiftCta")}
          </button>
        </>
      ) : clockedInElsewhere ? (
        <>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {t("workerProject.clockedInElsewhere").replace(
              "{project}",
              currentProjectName ?? "",
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {t("workerProject.switchProjectConfirm")}
          </p>
          <button
            type="button"
            onClick={() => void handleSwitch()}
            disabled={startingShift}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "#f59e0b", color: "var(--text-inverse)" }}
          >
            <Square size={14} />
            {t("workerProject.switchEndAndStart")}
          </button>
        </>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => handleStart(false)}
            disabled={startingShift}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-3 text-sm font-semibold disabled:opacity-50"
            style={{ background: "#f59e0b", color: "var(--text-inverse)" }}
          >
            <Play size={14} />
            {startingShift ? t("clock.checkingLocation") : t("clock.startShiftCta")}
          </button>
          <button
            type="button"
            onClick={() => handleStart(true)}
            disabled={startingShift}
            className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border px-4 py-3 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "rgba(245,158,11,0.45)", color: "#f59e0b" }}
          >
            <Play size={14} />
            {t("worker.gpsPromptStartWithoutGps")}
          </button>
        </div>
      )}

      <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      <SafetyBriefModal
        open={safetyOpen}
        projectName={projectName}
        workerName={shell.profile.name}
        busy={savingAck}
        errorMessage={ackError}
        onConfirm={() => void handleSafetyConfirm()}
        onCancel={() => {
          if (!savingAck) {
            setAckError(null);
            setPendingNoGpsStart(false);
            setSafetyOpen(false);
          }
        }}
      />
    </section>
  );
}

function WorkerMaterialsList({
  orgId,
  projectId,
  profileId,
  currentUserName,
}: {
  orgId: string;
  projectId: string;
  profileId: string;
  currentUserName: string | null;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MaterialRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [orderRows, setOrderRows] = useState<MaterialOrderDraftRow[]>(() => [
    createMaterialOrderRow(),
  ]);
  const [orderPriority, setOrderPriority] = useState<TaskPriority>("medium");
  const [orderNote, setOrderNote] = useState("");
  const [orderError, setOrderError] = useState("");
  const [savingOrder, setSavingOrder] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState<MaterialRow | null>(null);
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [receiptViewerItem, setReceiptViewerItem] = useState<ViewerMediaItem | null>(null);
  const { canOpenViewerItem, suppressViewerItem } = useMediaViewerOpenGuard();

  const readMaterialItems = useCallback(async (): Promise<MaterialRow[]> => {
    const { data } = await supabase
      .from("tasks")
      .select("id, title, priority, status, metadata, created_at, updated_at, assigned_by")
      .eq("project_id", projectId)
      .eq("metadata->>category", "material")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      priority: TaskPriority;
      status: string;
      metadata: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
      assigned_by: string | null;
    }>;

    const profileIds = new Set<string>();
    const receiptIds = new Set<string>();
    for (const row of rows) {
      if (isProfileId(row.assigned_by)) profileIds.add(row.assigned_by);
      const meta = row.metadata ?? {};
      if (isProfileId(meta.delivered_by)) profileIds.add(meta.delivered_by);
      if (isProfileId(meta.receipt_attached_by)) profileIds.add(meta.receipt_attached_by);
      if (typeof meta.receipt_id === "string") receiptIds.add(meta.receipt_id);
    }
    profileIds.add(profileId);

    let profileNameById = new Map<string, string>();
    if (profileIds.size > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name")
        .in("id", [...profileIds]);
      profileNameById = new Map(
        ((profiles ?? []) as Array<{ id: string; name: string }>)
          .map((profile) => [
            profile.id,
            normalizeProfileDisplayName(profile.name),
          ])
          .filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
    }
    const currentDisplayName = normalizeProfileDisplayName(currentUserName);
    if (currentDisplayName) {
      profileNameById.set(profileId, currentDisplayName);
    }
    const fallbackUserName = t("common.user");
    const resolveProfileName = (profileIdValue: unknown) =>
      isProfileId(profileIdValue)
        ? profileNameById.get(profileIdValue) ?? fallbackUserName
        : fallbackUserName;

    let receiptById = new Map<string, ViewerMediaItem>();
    if (receiptIds.size > 0) {
      const { data: receipts } = await supabase
        .from("media")
        .select("id, storage_path, filename, mime_type, media_type, caption, created_at, metadata")
        .in("id", [...receiptIds])
        .is("deleted_at", null);
      receiptById = new Map(
        ((receipts ?? []) as ViewerMediaItem[]).map((receipt) => [receipt.id, receipt]),
      );
    }

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      quantity: formatMaterialQuantity(r.metadata?.quantity),
      unit: typeof r.metadata?.unit === "string" ? r.metadata.unit : "",
      priority: r.priority,
      taskStatus: r.status as TaskStatus,
      status: mapTaskStatusToMaterialStatus(r.status),
      metadata: r.metadata ?? {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      assignedById: r.assigned_by,
      authorName: isProfileId(r.assigned_by) ? resolveProfileName(r.assigned_by) : fallbackUserName,
      deliveredById:
        isProfileId(r.metadata?.delivered_by) ? r.metadata.delivered_by : null,
      deliveredByName:
        typeof r.metadata?.delivered_by === "string"
          ? resolveProfileName(r.metadata.delivered_by)
          : null,
      deliveredAt:
        typeof r.metadata?.delivered_at === "string" ? r.metadata.delivered_at : null,
      receiptId: typeof r.metadata?.receipt_id === "string" ? r.metadata.receipt_id : null,
      receiptAttachedById:
        isProfileId(r.metadata?.receipt_attached_by)
          ? r.metadata.receipt_attached_by
          : null,
      receiptAttachedByName:
        typeof r.metadata?.receipt_attached_by === "string"
          ? resolveProfileName(r.metadata.receipt_attached_by)
          : null,
      receipt:
        typeof r.metadata?.receipt_id === "string"
          ? receiptById.get(r.metadata.receipt_id) ?? null
          : null,
    }));
  }, [supabase, projectId, profileId, currentUserName, t]);

  async function refreshMaterials() {
    setLoading(true);
    setItems(await readMaterialItems());
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const nextItems = await readMaterialItems();
      if (cancelled) return;
      setItems(nextItems);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [readMaterialItems]);

  const hasNamedOrderRow = orderRows.some((row) => row.name.trim().length > 0);

  function resetOrderDraft() {
    setOrderRows([createMaterialOrderRow()]);
    setOrderPriority("medium");
    setOrderNote("");
    setOrderError("");
  }

  function openAddMaterialModal() {
    resetOrderDraft();
    setAddOpen(true);
  }

  function closeAddMaterialModal() {
    if (savingOrder) return;
    setAddOpen(false);
  }

  function updateOrderRow(
    rowId: string,
    patch: Partial<Omit<MaterialOrderDraftRow, "id">>,
  ) {
    setOrderRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  function addOrderRow() {
    setOrderRows((current) => [...current, createMaterialOrderRow()]);
  }

  function removeOrderRow(rowId: string) {
    setOrderRows((current) => {
      const next = current.filter((row) => row.id !== rowId);
      return next.length > 0 ? next : [createMaterialOrderRow()];
    });
  }

  async function handleAddOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const materialRows = orderRows
      .map((row) => ({
        name: row.name.trim(),
        quantity: parseMaterialQuantity(row.quantity),
        unit:
          row.unit === "other"
            ? row.customUnit.trim() || MATERIAL_OTHER_UNIT_VALUE
            : row.unit,
      }))
      .filter((row) => row.name.length > 0);

    if (materialRows.length === 0) return;

    setSavingOrder(true);
    setOrderError("");
    const orderId = createClientUuid();
    const trimmedOrderNote = orderNote.trim();
    const { error } = await supabase
      .from("tasks")
      .insert(materialRows.map((row) => ({
        org_id: orgId,
        project_id: projectId,
        assigned_to: null,
        assigned_by: profileId,
        title: row.name,
        description: null,
        priority: orderPriority,
        status: "pending",
        due_date: null,
        metadata: {
          category: "material",
          quantity: row.quantity,
          unit: row.unit,
          order_id: orderId,
          order_note: trimmedOrderNote || null,
          order_size: materialRows.length,
        },
      })));
    setSavingOrder(false);

    if (error) {
      setOrderError(error.message);
      return;
    }

    setAddOpen(false);
    resetOrderDraft();
    await refreshMaterials();
  }

  const materialGroups = useMemo<MaterialOrderGroup[]>(() => {
    const grouped = new Map<string, MaterialOrderGroup>();
    for (const item of items) {
      const orderId = typeof item.metadata.order_id === "string" ? item.metadata.order_id : null;
      const groupKey = orderId ?? `legacy-${item.id}`;
      const note = typeof item.metadata.order_note === "string" ? item.metadata.order_note : "";
      const current = grouped.get(groupKey);
      if (current) {
        current.items.push(item);
        if (new Date(item.createdAt).getTime() < new Date(current.createdAt).getTime()) {
          current.createdAt = item.createdAt;
        }
      } else {
        grouped.set(groupKey, {
          id: groupKey,
          orderId,
          authorName: item.authorName,
          createdAt: item.createdAt,
          priority: item.priority,
          note,
          items: [item],
        });
      }
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        items: [...group.items].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        ),
      }))
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );
  }, [items]);

  async function createDeliveryReceipt(file: File): Promise<ViewerMediaItem> {
    const validation = validateUploadFile(file);
    if (!validation.ok || validation.kind === "video" || validation.kind === "document") {
      throw new Error(t("messages.uploadFailed"));
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${orgId}/${projectId}/receipts/${createClientUuid()}-${safeName}`;
    const mimeType = inferUploadContentType(file);
    const { error: uploadErr } = await supabase.storage
      .from("media")
      .upload(path, file, { upsert: false, cacheControl: "3600", contentType: mimeType });
    if (uploadErr) throw new Error(uploadErr.message);

    const mediaType = validation.kind === "photo" ? "photo" : "pdf";
    const { data: row, error: insertErr } = await supabase
      .from("media")
      .insert({
        org_id: orgId,
        project_id: projectId,
        uploaded_by: profileId,
        media_type: mediaType,
        storage_path: path,
        filename: file.name,
        file_size: file.size,
        mime_type: mimeType,
        caption: null,
        is_checkout: false,
        time_event_id: null,
        metadata: {
          kind: "receipt",
          category: "receipt",
          store_name: null,
          amount: 0,
          purchase_date: new Date().toISOString().slice(0, 10),
          uploader_name: "Worker",
        },
      })
      .select("id, storage_path, filename, mime_type, media_type, caption, created_at, metadata")
      .single<ViewerMediaItem>();
    if (insertErr || !row) throw new Error(insertErr?.message ?? t("messages.uploadFailed"));
    return row;
  }

  function openDeliveryModal(item: MaterialRow) {
    setDeliveryTarget(item);
    setDeliveryFile(null);
    setDeliveryError("");
  }

  function closeDeliveryModal() {
    if (deliveryBusy) return;
    setDeliveryTarget(null);
    setDeliveryFile(null);
    setDeliveryError("");
  }

  function openReceiptViewer(item: ViewerMediaItem | null) {
    if (!item || !canOpenViewerItem(item.id)) return;
    setReceiptViewerItem(item);
  }

  function closeReceiptViewer() {
    const itemId = receiptViewerItem?.id;
    setReceiptViewerItem(null);
    suppressViewerItem(itemId);
  }

  async function confirmDelivery() {
    if (!deliveryTarget) return;
    setDeliveryBusy(true);
    setDeliveryError("");
    try {
      const now = new Date().toISOString();
      const receipt = deliveryFile ? await createDeliveryReceipt(deliveryFile) : null;
      const metadata = {
        ...deliveryTarget.metadata,
        delivered_by: isProfileId(deliveryTarget.metadata.delivered_by)
          ? deliveryTarget.metadata.delivered_by
          : profileId,
        delivered_at:
          typeof deliveryTarget.metadata.delivered_at === "string"
            ? deliveryTarget.metadata.delivered_at
            : now,
        receipt_id: receipt?.id ?? null,
        receipt_attached_by: receipt ? profileId : null,
      };
      const { error } = await supabase
        .from("tasks")
        .update({ status: "done", completed_at: now, metadata })
        .eq("id", deliveryTarget.id);
      if (error) throw new Error(error.message);
      setDeliveryTarget(null);
      setDeliveryFile(null);
      await refreshMaterials();
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : t("common.errorTryAgain"));
    } finally {
      setDeliveryBusy(false);
    }
  }

  async function undoDelivery(item: MaterialRow) {
    if (typeof window !== "undefined" && !window.confirm(t("materials.cancelDeliveryConfirm"))) {
      return;
    }
    const metadata = { ...item.metadata };
    delete metadata.delivered_by;
    delete metadata.delivered_at;
    delete metadata.receipt_id;
    delete metadata.receipt_attached_by;
    const { error } = await supabase
      .from("tasks")
      .update({ status: "pending", completed_at: null, metadata })
      .eq("id", item.id);
    if (error) {
      setOrderError(error.message);
      return;
    }
    await refreshMaterials();
  }

  const materialsSummary = formatSectionCountSummary(t("materials.title"), [
    { count: items.length, label: t("projectDetail.summaryItems") },
  ]);

  return (
    <>
    <CollapsibleSection
      id="materials"
      projectId={projectId}
      defaultOpen={false}
      dataTestid="worker-project-materials-folder"
      className="p-4"
      summary={
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {materialsSummary}
        </h2>
      }
      headerAction={
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            openAddMaterialModal();
          }}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
          style={{
            borderColor: "rgba(191, 162, 52, 0.4)",
            color: "var(--brand-yellow)",
          }}
        >
          <Plus size={13} />
          {t("materials.addItem")}
        </button>
      }
    >
      <div className="mt-3 space-y-3">
        {loading ? (
          <div className="text-sm text-[var(--text-secondary)]">{t("common.loading")}</div>
        ) : materialGroups.length === 0 ? (
          <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("materials.empty")}
          </div>
        ) : (
          materialGroups.map((group) => {
            const priorityColor = getMaterialPriorityColor(group.priority);
            return (
              <CollapsibleSection
                key={group.id}
                id={`materials-${group.id}`}
                projectId={projectId}
                defaultOpen={false}
                className="border-[var(--border-default)] bg-[var(--bg-primary)] p-3"
                contentClassName="mt-3"
                summary={
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-[var(--text-primary)]">
                        {group.authorName}
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">
                        {formatMaterialDate(group.createdAt)}
                      </span>
                      <span className="rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                        {formatMaterialPositionCount(group.items.length, t)}
                      </span>
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                        style={{ background: `${priorityColor}1f`, color: priorityColor }}
                      >
                        {getMaterialPriorityLabel(group.priority, t)}
                      </span>
                    </div>
                    {group.note ? (
                      <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
                        {group.note}
                      </p>
                    ) : null}
                  </div>
                }
              >
                {group.note ? (
                  <p className="mb-3 whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--bg-card)] p-3 text-xs text-[var(--text-secondary)]">
                    {group.note}
                  </p>
                ) : null}
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const delivered = item.status === "delivered";
                    const statusColor =
                      item.status === "delivered"
                        ? "var(--green)"
                        : item.status === "ordered"
                          ? "var(--brand-yellow)"
                          : "var(--text-muted)";
                    const statusLabel =
                      item.status === "delivered"
                        ? t("materials.delivered")
                        : item.status === "ordered"
                          ? t("materials.ordered")
                          : t("materials.needed");
                    const quantityLabel = item.quantity
                      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
                      : "";
                    const deliveredAt = item.deliveredAt ?? (delivered ? item.updatedAt : null);
                    return (
                      <div
                        key={item.id}
                        className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                        style={{ opacity: delivered ? 0.7 : 1 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-start gap-3">
                            <input
                              type="checkbox"
                              checked={delivered}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  openDeliveryModal(item);
                                } else {
                                  void undoDelivery(item);
                                }
                              }}
                              className="mt-1 h-4 w-4 shrink-0"
                            />
                            <div className="min-w-0">
                              <span
                                className="text-sm font-semibold text-[var(--text-primary)]"
                                style={{ textDecoration: delivered ? "line-through" : "none" }}
                              >
                                {item.title}
                              </span>
                              {quantityLabel ? (
                                <span className="ml-2 text-xs text-[var(--text-muted)]">
                                  — {quantityLabel}
                                </span>
                              ) : null}
                              {delivered ? (
                                <div className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
                                  <div>
                                    {t("materials.deliveredByLabel")}{" "}
                                    {item.deliveredByName ?? t("tasks.unknown")}
                                    {deliveredAt ? ` · ${formatMaterialDate(deliveredAt)}` : ""}
                                  </div>
                                  {item.receiptId ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        openReceiptViewer(item.receipt);
                                      }}
                                      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-yellow)] disabled:text-[var(--text-muted)]"
                                      disabled={!item.receipt}
                                    >
                                      <ReceiptIcon size={12} />
                                      {t("materials.receiptAttachedByLabel")}{" "}
                                      {item.receiptAttachedByName ?? t("tasks.unknown")}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <span
                            className="shrink-0 rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                            style={{ background: `${statusColor}1f`, color: statusColor }}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            );
          })
        )}
      </div>
    </CollapsibleSection>
    {addOpen ? (
      <div
        className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClick={closeAddMaterialModal}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="surface-card max-h-[90vh] w-full max-w-[860px] overflow-y-auto p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("materials.addItem")}
            </h2>
            <button
              type="button"
              onClick={closeAddMaterialModal}
              aria-label={t("common.cancel")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              disabled={savingOrder}
            >
              <X size={14} />
            </button>
          </div>
          {orderError ? (
            <div className="mt-3 rounded-[var(--radius-md)] bg-red-500/10 px-3 py-2 text-xs font-semibold text-[var(--red)]">
              {orderError}
            </div>
          ) : null}
          <form className="mt-4 grid gap-4" onSubmit={handleAddOrder}>
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <select
                value={orderPriority}
                onChange={(event) => setOrderPriority(event.target.value as TaskPriority)}
                aria-label={t("messages.priority")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="urgent">{t("materials.urgent")}</option>
                <option value="medium">{t("materials.soon")}</option>
                <option value="low">{t("materials.notUrgent")}</option>
              </select>
              <TextInputWithVoice
                multiline
                rows={2}
                value={orderNote}
                onChange={(event) => setOrderNote(event.target.value)}
                placeholder={t("materials.orderNote")}
                className="min-h-[82px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <div className="space-y-2">
              {orderRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 sm:grid-cols-[minmax(0,1fr)_120px_minmax(180px,260px)_36px]"
                >
                  <TextInputWithVoice
                    value={row.name}
                    onChange={(event) => updateOrderRow(row.id, { name: event.target.value })}
                    placeholder={t("materials.name")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(event) => updateOrderRow(row.id, { quantity: event.target.value })}
                    placeholder={t("materials.quantity")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                    style={MATERIAL_INPUT_STYLE}
                  />
                  <div className="flex min-w-0 gap-2">
                    <select
                      value={row.unit}
                      onChange={(event) =>
                        updateOrderRow(row.id, { unit: event.target.value as MaterialUnitValue })
                      }
                      className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                      style={MATERIAL_INPUT_STYLE}
                    >
                      {MATERIAL_UNIT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} style={MATERIAL_OPTION_STYLE}>
                          {t(option.labelKey)}
                        </option>
                      ))}
                    </select>
                    {row.unit === "other" ? (
                      <input
                        value={row.customUnit}
                        onChange={(event) =>
                          updateOrderRow(row.id, { customUnit: event.target.value })
                        }
                        placeholder={t("materials.unitOther")}
                        className="w-28 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                        style={MATERIAL_INPUT_STYLE}
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeOrderRow(row.id)}
                    aria-label={t("common.remove")}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={addOrderRow}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold"
                style={{
                  borderColor: "rgba(191, 162, 52, 0.4)",
                  color: "var(--brand-yellow)",
                }}
              >
                <Plus size={14} />
                {t("materials.addPosition")}
              </button>
              <button
                type="submit"
                disabled={!hasNamedOrderRow || savingOrder}
                className="button-base button-primary disabled:opacity-50"
              >
                {savingOrder ? t("common.saving") : t("materials.saveOrder")}
              </button>
            </div>
          </form>
        </div>
      </div>
    ) : null}
    {deliveryTarget ? (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClick={closeDeliveryModal}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="surface-card w-full max-w-[520px] p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("materials.markDeliveryTitle")}
              </h2>
              <p className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                {deliveryTarget.title}
              </p>
            </div>
            <button
              type="button"
              onClick={closeDeliveryModal}
              aria-label={t("common.cancel")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              disabled={deliveryBusy}
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {t("materials.deliveryReceiptReminder")}
          </p>
          {deliveryError ? (
            <div className="mt-3 rounded-[var(--radius-md)] bg-red-500/10 px-3 py-2 text-xs font-semibold text-[var(--red)]">
              {deliveryError}
            </div>
          ) : null}
          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {t("materials.attachReceiptOptional")}
          </label>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(event) => setDeliveryFile(event.target.files?.[0] ?? null)}
            className="mt-2 block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={closeDeliveryModal}
              disabled={deliveryBusy}
              className="rounded-[var(--radius-sm)] border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelivery()}
              disabled={deliveryBusy}
              className="rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              {deliveryBusy ? t("common.saving") : t("materials.confirmDelivery")}
            </button>
          </div>
        </div>
      </div>
    ) : null}
    <MediaViewerModal
      item={receiptViewerItem}
      onClose={closeReceiptViewer}
    />
    </>
  );
}

function WorkerReceiptUpload({
  orgId,
  projectId,
  profileId,
  open,
  onClose,
  onSaved,
}: {
  orgId: string;
  projectId: string;
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showOther, setShowOther] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fd = new FormData(form);
    const file = fileRef.current?.files?.[0] ?? null;
    const storeName = fd.get("store")?.toString() ?? "";
    const otherStore = fd.get("store_other")?.toString().trim() ?? "";
    const finalStore = storeName === "__other" ? otherStore : storeName;
    const amount = Number.parseFloat(fd.get("amount")?.toString() ?? "0");
    const note = fd.get("note")?.toString().trim() ?? "";

    if (!file) {
      setMessage({ kind: "err", text: t("workerProject.receiptPhotoRequired") });
      return;
    }
    if (!amount || !Number.isFinite(amount) || amount <= 0) {
      setMessage({ kind: "err", text: t("workerProject.receiptAmountRequired") });
      return;
    }

    const validation = validateUploadFile(file);
    if (!validation.ok || validation.kind === "video" || validation.kind === "document") {
      const attempted = validation.ok
        ? file.type || file.name
        : "mime" in validation.error
          ? validation.error.mime
          : "";
      setMessage({
        kind: "err",
        text: t("uploads.unsupportedType").replace("{kind}", attempted),
      });
      return;
    }

    setBusy(true);
    setMessage(null);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${orgId}/${projectId}/receipts/${createClientUuid()}-${safeName}`;
    const mimeType = inferUploadContentType(file);

    const { error: uploadErr } = await supabase.storage
      .from("media")
      .upload(path, file, { upsert: false, cacheControl: "3600", contentType: mimeType });
    if (uploadErr) {
      setBusy(false);
      setMessage({ kind: "err", text: uploadErr.message });
      return;
    }

    const mediaType = validation.kind === "photo" ? "photo" : "pdf";
    const metadata = {
      kind: "receipt" as const,
      category: "receipt" as const,
      store_name: finalStore || null,
      amount,
      purchase_date: new Date().toISOString().slice(0, 10),
      uploader_name: "Worker",
    };

    const { error: insertErr } = await supabase.from("media").insert({
      org_id: orgId,
      project_id: projectId,
      uploaded_by: profileId,
      media_type: mediaType,
      storage_path: path,
      filename: file.name,
      file_size: file.size,
      mime_type: mimeType,
      caption: note || null,
      is_checkout: false,
      time_event_id: null,
      metadata,
    });

    setBusy(false);
    if (insertErr) {
      setMessage({ kind: "err", text: insertErr.message });
      return;
    }
    onClose();
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    setShowOther(false);
    setMessage(null);
    onSaved();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="surface-card max-h-[90vh] w-full max-w-[640px] overflow-y-auto p-4"
        onClick={(event) => event.stopPropagation()}
      >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {t("workerProject.addReceiptTitle")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.cancel")}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
          style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
        >
          ×
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("workerProject.addReceiptHint")}
      </p>
      {message ? (
        <div
          className="mt-3 text-xs font-semibold"
          style={{ color: message.kind === "ok" ? "var(--green)" : "var(--red)" }}
        >
          {message.text}
        </div>
      ) : null}
      <form className="mt-3 grid gap-3" onSubmit={handleSubmit}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="block w-full cursor-pointer rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[var(--brand-yellow)] file:px-2.5 file:py-1 file:text-xs file:font-semibold file:text-[var(--text-inverse)]"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder={t("workerProject.receiptAmount")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
          <select
            name="store"
            defaultValue=""
            onChange={(e) => setShowOther(e.target.value === "__other")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("workerProject.receiptStorePlaceholder")}</option>
            {STORES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value="__other">{t("workerProject.receiptStoreOther")}</option>
          </select>
        </div>
        {showOther ? (
          <input
            name="store_other"
            placeholder={t("workerProject.receiptStoreOtherLabel")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          />
        ) : null}
        <input
          name="note"
          placeholder={t("workerProject.receiptNote")}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        />
        <button
          type="submit"
          disabled={busy}
          className="button-base button-primary"
        >
          {busy ? t("common.saving") : t("workerProject.receiptSaveCta")}
        </button>
      </form>
      </div>
    </div>
  );
}
