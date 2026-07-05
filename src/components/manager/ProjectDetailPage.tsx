"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  ExternalLink,
  FileText,
  FileVideo2,
  Film,
  Flag,
  Image as ImageIcon,
  Pencil,
  Play,
  Plus,
  Receipt as ReceiptIcon,
  Trash2,
  X,
} from "lucide-react";
import { ModalBackdrop } from "@/components/shared/ModalBackdrop";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { CollapsibleSection } from "@/components/shared/CollapsibleSection";
import { ProjectNavigationActions } from "@/components/shared/ProjectNavigationActions";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { logAudit } from "@/lib/audit";
import { keepStableListIfUnchanged } from "@/lib/list-stability";
import { buildSafeUploadName } from "@/lib/media-extension";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import {
  ACCEPT_ALL_UPLOADS,
  ACCEPT_DOCUMENT_UPLOADS,
  ACCEPT_IMAGE_UPLOADS,
  ACCEPT_PDF_UPLOADS,
  ACCEPT_VIDEO_UPLOADS,
  inferUploadContentType,
  type UploadKind,
  validateUploadFile,
} from "@/lib/upload-limits";
import {
  getAttachmentMediaIds,
  linkMediaToTask,
  mergeTaskAttachmentRefs,
  normalizeStoragePath,
  type TaskAttachmentRef,
  uploadTaskAttachment,
} from "@/lib/task-attachments";
import {
  buildProfileNameMap,
  getCompletionMediaIds,
  getCompletionNote,
  getFollowUpInfo,
  getTaskCompletionAudit,
} from "@/lib/task-notifications";
import { TaskAttachmentList } from "@/components/shared/TaskAttachmentList";
import { TaskAttachmentUploader } from "@/components/shared/TaskAttachmentUploader";
import { ProjectPlanningSections } from "@/components/manager/ProjectPlanningSections";
import { UploadSourceButtons } from "@/components/shared/UploadSourceButtons";
import {
  MediaViewerModal,
  useMediaViewerOpenGuard,
  type ViewerMediaItem,
} from "@/components/shared/MediaViewerModal";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";
import {
  getMaterialIndicatorState,
  getMaterialTaskLinks,
  getMaterialTaskNeededDate,
  getMaterialTaskUrgency,
  hasDriverSeenMaterialTask,
  isMaterialTask,
  type MaterialTaskUrgency,
} from "@/lib/material-tasks";
import { parseMaterialSpecPaste, type MaterialSpecItem } from "@/lib/material-spec-parser";
import { isDriverTimeProject } from "@/lib/driver-time-projects";
import { filterMaterialTakerProfiles } from "@/lib/material-driver-permissions";
import {
  formatProjectPublicNoteTime,
  readProjectPublicNotes,
  type ProjectPublicNote,
} from "@/lib/project-public-notes";
import {
  countProjectMediaCategories,
  filterProjectMediaByCategory,
  type ProjectMediaCategory,
} from "@/lib/project-media-library";
import { mergeRealtimeTaskRow, removeTaskById } from "@/lib/task-realtime";
import {
  getEffectiveTaskStatus,
  isEffectiveOpenTask,
} from "@/lib/task-status";
import { createClient } from "@/lib/supabase/client";
import { type TranslationKey, useTranslation } from "@/lib/i18n";
import { parsePastedCoordinatePair } from "@/lib/coordinate-paste";
import {
  assessDeviceLocationAccuracy,
  type DeviceLocationAssessment,
  formatDateTime,
  formatDurationCompact,
  isValidGeoPoint,
  parseCoordinateInputPair,
} from "@/lib/worker-utils";
import type { ProjectAddressGeocodeResult } from "@/lib/project-geocoding";
import { GPS_STATUS_COLOR, type WorkerGpsStatus } from "@/lib/gps-status";
import {
  deriveProjectScheduleHealth,
  formatProjectCountdown,
  projectScheduleToneStyle,
} from "@/lib/project-schedule";
import {
  GPS_FRESHNESS_COLOR,
  formatGpsAge,
  type GpsFreshness,
  type GpsFreshnessStatus,
} from "@/lib/gps-freshness";
import {
  SHIFT_REVIEW_COLOR,
  type ShiftReview,
  type ShiftReviewStatus,
} from "@/lib/shift-review";
import { selectMediaPlayback } from "@/lib/media-playback";
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
  UserRole,
} from "@/types/database";

async function readRouteError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return `Request failed (${response.status})`;
}

async function readRouteFailure(response: Response): Promise<{
  error: string;
  code: string | null;
  status: number;
}> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; code?: unknown }
    | null;

  return {
    error:
      payload && typeof payload.error === "string" && payload.error.trim()
        ? payload.error
        : `Request failed (${response.status})`,
    code: payload && typeof payload.code === "string" ? payload.code : null,
    status: response.status,
  };
}

type AddressLookupState = ProjectAddressGeocodeResult & {
  requestedAddress: string;
};

function managerProjectTaskFingerprint(task: Task): string {
  return [
    task.id,
    task.status,
    task.assigned_to ?? "",
    task.completed_at ?? "",
    task.completed_by ?? "",
    task.updated_at ?? "",
    JSON.stringify(task.metadata ?? {}),
  ].join("\u001f");
}

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

function ProjectMediaTypeIcon({
  mediaType,
  className,
}: {
  mediaType: Media["media_type"];
  className?: string;
}) {
  if (mediaType === "photo") return <ImageIcon size={30} className={className} />;
  if (mediaType === "video") return <Film size={30} className={className} />;
  return <FileText size={30} className={className} />;
}

function projectMediaTypeLabel(mediaType: Media["media_type"]) {
  if (mediaType === "photo") return "Photo";
  if (mediaType === "video") return "Video";
  if (mediaType === "pdf") return "PDF";
  if (mediaType === "document") return "Document";
  return "File";
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
  notes: string;
};

type MaterialAssigneeOption = Pick<ManagerProfileSummary, "id" | "name" | "role">;

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
    notes: "",
  };
}

function createClientUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function parseMaterialQuantity(value: string): number | string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numericQuantity = /^[-+]?\d+(?:[,.]\d+)?$/.test(trimmed);
  if (!numericQuantity) return trimmed;
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : trimmed;
}

function draftRowFromSpecItem(item: MaterialSpecItem): MaterialOrderDraftRow {
  const unitText = item.unit?.trim() ?? "";
  const matchedUnit = MATERIAL_UNIT_OPTIONS.find(
    (option) => option.value !== "other" && option.value.toLowerCase() === unitText.toLowerCase(),
  );

  return {
    id: createClientUuid(),
    name: item.name,
    quantity: item.quantity ?? "",
    unit: matchedUnit?.value ?? (unitText ? "other" : "шт"),
    customUnit: matchedUnit ? "" : unitText,
    notes: item.notes ?? "",
  };
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
      hourCycle: "h23",
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

function setInputElementValue(
  input: HTMLInputElement | null,
  value: string,
) {
  if (!input) {
    return;
  }

  input.value = value;
}

function applyPastedCoordinatePair(
  event: React.ClipboardEvent<HTMLInputElement>,
  latInput: HTMLInputElement | null,
  lngInput: HTMLInputElement | null,
  onApplied: () => void,
) {
  const pair = parsePastedCoordinatePair(event.clipboardData.getData("text"));
  if (!pair || !latInput || !lngInput) return;

  event.preventDefault();
  setInputElementValue(latInput, pair.lat);
  setInputElementValue(lngInput, pair.lng);
  onApplied();
}

export function ProjectDetailPage({
  orgId,
  managerId,
  managerName,
  managerRole,
  project,
  assignedProfiles,
  availableProfiles,
  completionProfiles,
  assignments,
  tasks,
  media,
  sessions,
  gpsStatusByProfileId,
  gpsFreshnessByProfileId,
  shiftReviewByProfileId,
  safetyAcksToday,
  hasFinanceAccess,
  canDeleteMedia,
  configuredMaterialDriverIds,
}: {
  orgId: string;
  managerId: string;
  managerName: string;
  managerRole: UserRole;
  project: ManagerProjectSummary;
  assignedProfiles: ManagerProfileSummary[];
  availableProfiles: ManagerProfileSummary[];
  completionProfiles?: ManagerProfileSummary[];
  assignments: ProjectAssignment[];
  tasks: Task[];
  media: Media[];
  sessions: ManagerSession[];
  gpsStatusByProfileId: Record<string, WorkerGpsStatus>;
  gpsFreshnessByProfileId: Record<string, GpsFreshness>;
  shiftReviewByProfileId: Record<string, ShiftReview>;
  safetyAcksToday: number;
  hasFinanceAccess: boolean;
  canDeleteMedia: boolean;
  configuredMaterialDriverIds?: string[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [fetchingAddressFromLocation, setFetchingAddressFromLocation] = useState(false);
  const [coordinatesConfirmed, setCoordinatesConfirmed] = useState(false);
  const [editDriverTimeProject, setEditDriverTimeProject] = useState(isDriverTimeProject(project));
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocationAssessment | null>(null);
  const [addressLookup, setAddressLookup] = useState<AddressLookupState | null>(null);
  const [addressLookupError, setAddressLookupError] = useState("");
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [removeAssignmentId, setRemoveAssignmentId] = useState<string | null>(null);
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null);
  // Local optimistic copy of the task list. Soft-deletes drop the row
  // here immediately so the manager doesn't see a flash before
  // router.refresh repopulates from the server.
  const [taskList, setTaskList] = useState<Task[]>(tasks);
  const [projectNotesSettings, setProjectNotesSettings] = useState(project.settings);
  const [projectPublicNotes, setProjectPublicNotes] = useState<ProjectPublicNote[]>(() =>
    readProjectPublicNotes(project.settings),
  );
  const [projectNoteDraft, setProjectNoteDraft] = useState("");
  const [projectNoteBusy, setProjectNoteBusy] = useState(false);
  const [projectNoteMessage, setProjectNoteMessage] =
    useState<{ kind: "ok" | "err"; text: string } | null>(null);
  useEffect(() => {
    setTaskList((current) =>
      keepStableListIfUnchanged(current, tasks, managerProjectTaskFingerprint),
    );
  }, [tasks]);
  useEffect(() => {
    setProjectNotesSettings(project.settings);
  }, [project.settings]);
  useEffect(() => {
    setProjectPublicNotes(readProjectPublicNotes(projectNotesSettings));
  }, [projectNotesSettings]);
  useEffect(() => {
    const channel = supabase
      .channel(`manager-project-tasks-${project.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as Task | null;
          if (!row) return;
          setTaskList((current) =>
            mergeRealtimeTaskRow(current, row, {
              shouldInclude: (task) => task.project_id === project.id,
            }),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as Task | null;
          if (!row) return;
          setTaskList((current) =>
            mergeRealtimeTaskRow(current, row, {
              shouldInclude: (task) => task.project_id === project.id,
            }),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "tasks",
          filter: `project_id=eq.${project.id}`,
        },
        (payload) => {
          const oldRow = payload.old as { id?: string } | null;
          const taskId = oldRow?.id;
          if (!taskId) return;
          setTaskList((current) => removeTaskById(current, taskId));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${project.id}`,
        },
        (payload) => {
          const row = payload.new as { org_id?: string; settings?: Record<string, unknown> | null } | null;
          if (!row || row.org_id !== project.org_id) return;
          setProjectNotesSettings(row.settings ?? {});
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [project.id, project.org_id, supabase]);
  const [mediaViewerItem, setMediaViewerItem] = useState<ViewerMediaItem | null>(null);
  const {
    canOpenViewerItem: canOpenMediaViewerItem,
    suppressViewerItem: suppressMediaViewerItem,
  } = useMediaViewerOpenGuard();
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const [mediaFilter, setMediaFilter] = useState<ProjectMediaCategory>("all");
  const [taskAttachmentFiles, setTaskAttachmentFiles] = useState<File[]>([]);
  const [inlineTaskAttachmentRefs, setInlineTaskAttachmentRefs] = useState<TaskAttachmentRef[]>([]);
  const taskAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  const editLatRef = useRef<HTMLInputElement | null>(null);
  const editLngRef = useRef<HTMLInputElement | null>(null);
  const mediaById = useMemo(() => {
    const map = new Map<string, Media | TaskAttachmentRef>(media.map((m) => [m.id, m]));
    for (const ref of inlineTaskAttachmentRefs) {
      map.set(ref.id, ref);
    }
    return map;
  }, [inlineTaskAttachmentRefs, media]);
  const profileNameById = useMemo(
    () => buildProfileNameMap([...assignedProfiles, ...availableProfiles, ...(completionProfiles ?? [])]),
    [assignedProfiles, availableProfiles, completionProfiles],
  );
  const taskAssigneeProjectProfiles = useMemo(
    () =>
      assignedProfiles
        .filter((profile) => profile.is_active && !profile.deleted_at)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [assignedProfiles],
  );
  const taskAssigneeOtherProfiles = useMemo(() => {
    const assignedIds = new Set(taskAssigneeProjectProfiles.map((profile) => profile.id));
    return availableProfiles
      .filter((profile) => profile.is_active && !profile.deleted_at && !assignedIds.has(profile.id))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [availableProfiles, taskAssigneeProjectProfiles]);
  const hasTaskAssignees =
    taskAssigneeProjectProfiles.length > 0 || taskAssigneeOtherProfiles.length > 0;
  const materialTakerProfiles = useMemo(
    () =>
      filterMaterialTakerProfiles([
        ...taskAssigneeProjectProfiles,
        ...taskAssigneeOtherProfiles,
      ], {
        configuredDriverProfileIds: configuredMaterialDriverIds,
      }).sort((left, right) => left.name.localeCompare(right.name)),
    [configuredMaterialDriverIds, taskAssigneeOtherProfiles, taskAssigneeProjectProfiles],
  );

  // Project business-file upload (photo / video / PDF / documents). Separate from
  // receipts (no store/amount metadata) and from task attachments
  // (no task linkage). Lands in the same media table + bucket so the
  // existing Recent Media panel + tab counts pick it up automatically.
  const photoMediaInputRef = useRef<HTMLInputElement | null>(null);
  const videoMediaInputRef = useRef<HTMLInputElement | null>(null);
  const pdfMediaInputRef = useRef<HTMLInputElement | null>(null);
  const documentMediaInputRef = useRef<HTMLInputElement | null>(null);
  const quickProjectMediaInputRef = useRef<HTMLInputElement | null>(null);

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

  const filteredMedia = useMemo(
    () => filterProjectMediaByCategory(projectMediaItems, mediaFilter),
    [projectMediaItems, mediaFilter],
  );

  const mediaCounts = useMemo(() => {
    const counts = countProjectMediaCategories(projectMediaItems);
    return {
      photo: counts.photo,
      video: counts.video,
      documents: counts.documents,
      all: counts.all,
    };
  }, [projectMediaItems]);
  const [projectMediaTileUrls, setProjectMediaTileUrls] = useState<Map<string, string>>(new Map());
  const [projectMediaTileFailedIds, setProjectMediaTileFailedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const previewItems = projectMediaItems.filter(
      (item) => item.media_type === "photo" || item.media_type === "video",
    );
    if (previewItems.length === 0) return;

    let cancelled = false;
    void (async () => {
      const previewPaths = previewItems.map((item) => {
        const playback =
          item.media_type === "video"
            ? selectMediaPlayback(item as unknown as {
                storage_path: string;
                mime_type: string | null;
                metadata: Record<string, unknown> | null | undefined;
              })
            : { path: item.storage_path };
        return {
          id: item.id,
          path: normalizeStoragePath(playback.path),
        };
      });
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrls(previewPaths.map((item) => item.path), 3600);
      if (cancelled || !data) return;

      const nextUrls = new Map<string, string>();
      const nextFailedIds = new Set<string>();
      for (let i = 0; i < previewPaths.length; i += 1) {
        const signedUrl = data[i]?.signedUrl;
        if (signedUrl) {
          nextUrls.set(previewPaths[i].id, signedUrl);
        } else {
          nextFailedIds.add(previewPaths[i].id);
        }
      }
      setProjectMediaTileUrls(nextUrls);
      setProjectMediaTileFailedIds(nextFailedIds);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectMediaItems, supabase]);

  function markProjectMediaTileFailed(mediaId: string) {
    setProjectMediaTileFailedIds((current) => {
      if (current.has(mediaId)) return current;
      const next = new Set(current);
      next.add(mediaId);
      return next;
    });
  }

  const checkoutMediaBySessionId = useMemo(() => {
    const bySession = new Map<string, Media[]>();

    for (const session of sessions) {
      if (!session.clockOutTime) {
        continue;
      }

      const clockInMs = new Date(session.clockInTime).getTime();
      const clockOutMs = new Date(session.clockOutTime).getTime();
      // Generous trailing window so a late upload still resolves to
      // its shift. The previous 60-min cap dropped any video the
      // worker uploaded the following morning, leaving the yellow
      // "video missing" banner stuck on a shift whose video was
      // already on disk. 24h is the same horizon the link route
      // uses for its TOCTOU window.
      const fallbackWindowEndMs = clockOutMs + 24 * 60 * 60 * 1000;
      if (!Number.isFinite(clockInMs) || !Number.isFinite(clockOutMs)) {
        continue;
      }

      const items = media
        .filter((item) => {
          if (item.deleted_at) return false;
          if (!item.is_checkout) return false;
          if (item.media_type !== "video") return false;
          if (item.project_id !== session.projectId) return false;
          if (item.uploaded_by !== session.profileId) return false;

          if (
            session.clockOutEventId &&
            item.time_event_id === session.clockOutEventId
          ) {
            return true;
          }

          if (item.time_event_id !== null) return false;
          const createdMs = new Date(item.created_at).getTime();
          if (!Number.isFinite(createdMs)) return false;
          return createdMs >= clockInMs && createdMs <= fallbackWindowEndMs;
        })
        .sort(
          (left, right) =>
            new Date(right.created_at).getTime() -
            new Date(left.created_at).getTime(),
        );

      if (items.length > 0) {
        bySession.set(session.id, items);
      }
    }

    return bySession;
  }, [media, sessions]);

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
  const site = project.siteCoordinates;
  const { t, locale } = useTranslation();
  const taskCounts = useMemo(() => {
    let active = 0;
    let completed = 0;

    for (const task of taskList) {
      const effectiveStatus = getEffectiveTaskStatus(task);
      if (effectiveStatus === "done") {
        completed += 1;
      } else if (effectiveStatus !== "cancelled") {
        active += 1;
      }
    }

    return { active, completed };
  }, [taskList]);
  const materialIndicator = useMemo(
    () => getMaterialIndicatorState(taskList),
    [taskList],
  );
  const tasksFolderSummary = formatSectionCountSummary(t("common.tasks"), [
    { count: taskCounts.active, label: t("projectDetail.tasksSummaryActive") },
    {
      count: taskCounts.completed,
      label: t("projectDetail.tasksSummaryCompleted"),
    },
  ]);
  const mediaFolderSummary = formatSectionCountSummary(
    t("common.media"),
    [
      {
        count: mediaCounts.photo,
        label:
          mediaCounts.photo === 1
            ? t("projectDetail.mediaSummaryPhotoOne")
            : t("projectDetail.mediaSummaryPhotoMany"),
        include: mediaCounts.photo > 0,
      },
      {
        count: mediaCounts.video,
        label:
          mediaCounts.video === 1
            ? t("projectDetail.mediaSummaryVideoOne")
            : t("projectDetail.mediaSummaryVideoMany"),
        include: mediaCounts.video > 0,
      },
      {
        count: mediaCounts.documents,
        label:
          mediaCounts.documents === 1
            ? t("projectDetail.mediaSummaryPdfOne")
            : t("projectDetail.mediaSummaryPdfMany"),
        include: mediaCounts.documents > 0,
      },
    ],
    t("projectDetail.mediaSummaryEmpty"),
  );

  function openEditModal() {
    setCoordinatesConfirmed(false);
    setEditDriverTimeProject(isDriverTimeProject(project));
    setDeviceLocation(null);
    setAddressLookup(null);
    setAddressLookupError("");
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
    setCoordinatesConfirmed(false);
    setEditDriverTimeProject(isDriverTimeProject(project));
    setDeviceLocation(null);
    setAddressLookup(null);
    setAddressLookupError("");
    setGeocodingAddress(false);
  }

  function fillCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setDeviceLocation(null);
      setMessage(t("projects.locationUnavailable"));
      return;
    }

    setPickingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        if (!isValidGeoPoint(point)) {
          setDeviceLocation(null);
          setMessage(t("projects.locationInvalid"));
          setPickingLocation(false);
          return;
        }
        const assessment = assessDeviceLocationAccuracy(position.coords.accuracy);

        if (editLatRef.current) {
          editLatRef.current.value = point.lat.toFixed(6);
        }
        if (editLngRef.current) {
          editLngRef.current.value = point.lng.toFixed(6);
        }
        setDeviceLocation(assessment);
        setCoordinatesConfirmed(false);
        setAddressLookup(null);
        setAddressLookupError("");
        setMessage(assessment.shouldWarn ? t("projects.deviceLocationAccuracyWarning") : "");
        setPickingLocation(false);
      },
      (err: GeolocationPositionError) => {
        const key =
          err.code === err.PERMISSION_DENIED
            ? "projects.locationDenied"
            : err.code === err.TIMEOUT
              ? "projects.locationTimeout"
              : "projects.locationUnavailable";
        setDeviceLocation(null);
        setMessage(t(key));
        setPickingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  function fillAddressFromDeviceLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(t("projects.locationUnavailable"));
      return;
    }
    setFetchingAddressFromLocation(true);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        if (!isValidGeoPoint(point)) {
          setFetchingAddressFromLocation(false);
          setMessage(t("projects.locationInvalid"));
          return;
        }
        setInputElementValue(editLatRef.current, point.lat.toFixed(6));
        setInputElementValue(editLngRef.current, point.lng.toFixed(6));
        setDeviceLocation(assessDeviceLocationAccuracy(position.coords.accuracy));
        setCoordinatesConfirmed(false);
        try {
          const response = await fetch("/api/manager/projects/geocode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: point.lat, lng: point.lng, reverse: true }),
          });
          if (!response.ok) {
            const failure = await readRouteFailure(response);
            setMessage(failure.error);
            return;
          }
          const payload = (await response.json()) as { formattedAddress?: string | null };
          const formatted =
            typeof payload.formattedAddress === "string" && payload.formattedAddress.trim()
              ? payload.formattedAddress
              : "";
          if (formatted) {
            const form = editFormRef.current;
            const addressEl = form?.elements.namedItem("address");
            if (addressEl instanceof HTMLInputElement) {
              addressEl.value = formatted;
            }
          }
        } catch (err) {
          setMessage(err instanceof Error ? err.message : t("projects.locationUnavailable"));
        } finally {
          setFetchingAddressFromLocation(false);
        }
      },
      (err: GeolocationPositionError) => {
        const key =
          err.code === err.PERMISSION_DENIED
            ? "projects.locationDenied"
            : err.code === err.TIMEOUT
              ? "projects.locationTimeout"
              : "projects.locationUnavailable";
        setFetchingAddressFromLocation(false);
        setMessage(t(key));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  async function fillCoordinatesFromAddress() {
    const form = editFormRef.current;
    if (!form) {
      return;
    }

    const formData = new FormData(form);
    const address = formData.get("address")?.toString().trim() ?? "";
    if (!address) {
      setAddressLookup(null);
      setAddressLookupError(t("projects.addressLookupAddressRequired"));
      setMessage(t("projects.addressLookupAddressRequired"));
      return;
    }

    setGeocodingAddress(true);
    setAddressLookupError("");
    setMessage("");

    try {
      const response = await fetch("/api/manager/projects/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        setAddressLookup(null);
        const failure = await readRouteFailure(response);
        setAddressLookupError(failure.error);
        setMessage(failure.error);
        return;
      }

      const payload = (await response.json()) as {
        formattedAddress?: string | null;
        lat?: unknown;
        lng?: unknown;
      };
      const point = {
        lat: typeof payload.lat === "number" ? payload.lat : Number.NaN,
        lng: typeof payload.lng === "number" ? payload.lng : Number.NaN,
      };

      if (!isValidGeoPoint(point)) {
        setAddressLookup(null);
        setAddressLookupError(t("projects.locationInvalid"));
        setMessage(t("projects.locationInvalid"));
        return;
      }

      setInputElementValue(editLatRef.current, point.lat.toFixed(6));
      setInputElementValue(editLngRef.current, point.lng.toFixed(6));
      setDeviceLocation(null);
      setCoordinatesConfirmed(false);
      setAddressLookupError("");
      setAddressLookup({
        requestedAddress: address,
        formattedAddress:
          typeof payload.formattedAddress === "string" && payload.formattedAddress.trim()
            ? payload.formattedAddress
            : null,
        lat: point.lat,
        lng: point.lng,
      });
    } catch (error) {
      setAddressLookup(null);
      const nextError = error instanceof Error ? error.message : t("common.errorTryAgain");
      setAddressLookupError(nextError);
      setMessage(nextError);
    } finally {
      setGeocodingAddress(false);
    }
  }

  async function handleUpdateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = formData.get("name")?.toString().trim() ?? project.name;
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = hasFinanceAccess
      ? Number.parseFloat(formData.get("rate")?.toString() ?? `${project.rate}`)
      : null;
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? `${project.radius_m}`, 10);
    const status = (formData.get("status")?.toString() ?? project.status) as ProjectStatus;
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";
    const driverTimeProject = formData.get("driver_time_project") === "on";
    const coordinates = parseCoordinateInputPair(formData.get("lat"), formData.get("lng"), {
      allowBlank: driverTimeProject || project.hasValidSiteCoordinates,
    });
    if (coordinates.error) {
      setMessage(
        coordinates.error === "invalid"
          ? t("projects.locationInvalid")
          : t("projects.coordsRequired"),
      );
      event.currentTarget.reportValidity();
      return;
    }
    if (!driverTimeProject && !coordinatesConfirmed) {
      setMessage(t("projects.coordsConfirmationRequired"));
      event.currentTarget.reportValidity();
      return;
    }

    setBusyKey("project-update");
    setMessage("");

    const response = await fetch(`/api/manager/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: address || null,
        notes: notes || null,
        ...(hasFinanceAccess
          ? {
              rate:
                typeof rate === "number" && Number.isFinite(rate)
                  ? rate
                  : project.rate,
            }
          : {}),
        radius_m: Number.isFinite(radius) ? radius : project.radius_m,
        status,
        start_date: startDate || null,
        end_date: endDate || null,
        lat: coordinates.point?.lat ?? null,
        lng: coordinates.point?.lng ?? null,
        coordinatesConfirmed,
        driver_time_project: driverTimeProject,
      }),
    });

    if (!response.ok) {
      setMessage(await readRouteError(response));
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    closeEditModal();
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
    setShowAddWorker(false);
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
    setRemoveAssignmentId(null);
    setMessage(t("projectDetail.assignmentRemoved"));
    router.refresh();
  }

  async function handleAddProjectPublicNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = projectNoteDraft.trim();
    if (!text) {
      setProjectNoteMessage({ kind: "err", text: t("projectNotes.required") });
      return;
    }

    setProjectNoteBusy(true);
    setProjectNoteMessage(null);

    try {
      const response = await fetch("/api/worker/project-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project.id, text }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        note?: ProjectPublicNote;
        notes?: ProjectPublicNote[];
      };

      if (!response.ok) {
        setProjectNoteMessage({
          kind: "err",
          text: payload.error ?? t("projectNotes.saveFailed"),
        });
        return;
      }

      if (Array.isArray(payload.notes)) {
        setProjectPublicNotes(payload.notes);
      } else if (payload.note) {
        setProjectPublicNotes((current) => [payload.note as ProjectPublicNote, ...current]);
      }
      setProjectNoteDraft("");
      setProjectNoteMessage({ kind: "ok", text: t("projectNotes.added") });
      router.refresh();
    } catch (error) {
      setProjectNoteMessage({
        kind: "err",
        text: error instanceof Error ? error.message : t("projectNotes.saveFailed"),
      });
    } finally {
      setProjectNoteBusy(false);
    }
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

    // Upload any attachments first; if any one fails, abort before
    // creating the task so we don't end up with orphan task rows.
    const uploadedMediaIds: string[] = [];
    for (const file of taskAttachmentFiles) {
      // Cloud-picker guard: zero-byte File usually means the
      // browser handed back a streaming reference (Google Drive, iCloud)
      // it can't materialize. Nameless but non-empty files are still safe:
      // upload helpers derive a storage filename from MIME/extension.
      if (!file || file.size === 0) {
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

    const response = await fetch("/api/manager/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        projectId: project.id,
        assignedTo: assignedTo || null,
        priority,
        dueDate: dueDate || null,
        attachmentMediaIds: uploadedMediaIds,
        source: "project_detail",
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { task?: { id: string } }
      | { error?: string }
      | null;

    const insertedTaskId =
      payload && "task" in payload && payload.task?.id ? payload.task.id : null;
    if (!response.ok || !insertedTaskId) {
      const errorMessage =
        payload && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
      console.error("[task-attach] task create route FAIL", errorMessage);
      setMessage(errorMessage);
      setBusyKey(null);
      return;
    }

    if (uploadedMediaIds.length > 0) {
      void linkMediaToTask(supabase, insertedTaskId, uploadedMediaIds);
    }

    form.reset();
    setTaskAttachmentFiles([]);
    if (taskAttachmentInputRef.current) taskAttachmentInputRef.current.value = "";
    setTaskComposerOpen(false);
    setBusyKey(null);
    setMessage(t("projectDetail.taskCreated"));
    router.refresh();
  }

  function handleInlineTaskAttachmentsAdded(
    taskId: string,
    metadata: Record<string, unknown> | null,
    attachments: TaskAttachmentRef[],
  ) {
    setInlineTaskAttachmentRefs((current) => mergeTaskAttachmentRefs(current, attachments));
    setTaskList((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, metadata: metadata ?? task.metadata } : task,
      ),
    );
    setMessage(t("tasks.attachmentsAdded").replace("{count}", String(attachments.length)));
  }

  // Click-to-open for the Project Media list. Photos, videos, PDFs,
  // and documents all route through MediaViewerModal, which signs its
  // own URL and renders <img>/<video>/<iframe> for the respective
  // type. The reopen guard suppresses the touchend-then-click double
  // fire that mobile browsers emit when the modal closes.
  function openProjectMediaItem(item: Media) {
    if (!canOpenMediaViewerItem(item.id)) return;
    setMediaViewerItem(item as unknown as ViewerMediaItem);
  }

  async function downloadProjectMediaItem(item: Pick<Media, "storage_path" | "filename">) {
    if (typeof window === "undefined") return;
    const normalized = normalizeStoragePath(item.storage_path);
    const fallbackName = normalized.split("/").pop() ?? "download";
    const downloadAs = (item.filename && item.filename.trim()) || fallbackName;
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(normalized, 3600, { download: downloadAs });

    if (error || !data?.signedUrl) {
      console.error("[project-media] failed to sign download URL", error);
      setMessage(t("projectDetail.mediaOpenFailed"));
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = data.signedUrl;
    anchor.download = downloadAs;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function handleProjectMediaUpload(
    files: FileList | File[] | null,
    kind: UploadKind,
  ) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;

    // Pre-validate all files before any upload starts so a single bad
    // file in a multi-select doesn't leave half the batch in storage.
    for (const file of list) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const attempted = "mime" in validation.error ? validation.error.mime : null;
        console.error("[project-media] validation REJECTED", {
          reason: validation.error.reason,
          attempted,
        });
        if (validation.error.reason === "too_large") {
          const key =
            validation.error.kind === "photo"
              ? "uploads.tooLargePhoto"
              : validation.error.kind === "video"
                ? "uploads.tooLargeVideo"
                : validation.error.kind === "pdf"
                  ? "uploads.tooLargePdf"
                  : "uploads.tooLargeDocument";
          setMessage(t(key));
        } else {
          setMessage(
            t("uploads.unsupportedType").replace("{kind}", attempted ?? file.name),
          );
        }
        return;
      }
      if (validation.kind !== kind) {
        console.error("[project-media] kind mismatch", {
          expectedKind: kind,
          fileKind: validation.kind,
        });
        setMessage(t("projectDetail.mediaWrongKind"));
        return;
      }
    }

    setBusyKey("project-media");
    setMessage("");

    for (const file of list) {
      const safeName = buildSafeUploadName(file, "project-media");
      const displayName = file.name || safeName;
      const path = `${orgId}/${project.id}/project-media/${createClientUuid()}-${safeName}`;
      const contentType = inferUploadContentType(file);

      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, cacheControl: "3600", contentType });
      if (uploadErr) {
        console.error("[project-media] storage upload FAIL", uploadErr);
        setMessage(`storage: ${uploadErr.message}`);
        setBusyKey(null);
        return;
      }
      const metadata = { kind: "project_media" as const };
      const { error: insertErr } = await supabase.from("media").insert({
        org_id: orgId,
        project_id: project.id,
        uploaded_by: managerId,
        media_type: kind,
        storage_path: path,
        filename: displayName,
        file_size: file.size,
        mime_type: contentType,
        caption: null,
        is_checkout: false,
        time_event_id: null,
        metadata,
      });
      if (insertErr) {
        console.error("[project-media] media insert FAIL", insertErr);
        setMessage(`media-insert: ${insertErr.message}`);
        setBusyKey(null);
        return;
      }
    }

    setBusyKey(null);
    setMessage(t("projectDetail.mediaUploaded"));
    router.refresh();
  }

  async function handleQuickProjectMediaUpload(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (list.length === 0) return;

    const grouped: Record<UploadKind, File[]> = {
      photo: [],
      video: [],
      pdf: [],
      document: [],
    };

    for (const file of list) {
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const attempted = "mime" in validation.error ? validation.error.mime : null;
        if (validation.error.reason === "too_large") {
          const key =
            validation.error.kind === "photo"
              ? "uploads.tooLargePhoto"
              : validation.error.kind === "video"
                ? "uploads.tooLargeVideo"
                : validation.error.kind === "pdf"
                  ? "uploads.tooLargePdf"
                  : "uploads.tooLargeDocument";
          setMessage(t(key));
        } else {
          setMessage(
            t("uploads.unsupportedType").replace("{kind}", attempted ?? file.name),
          );
        }
        return;
      }
      grouped[validation.kind].push(file);
    }

    for (const kind of ["photo", "video", "pdf", "document"] as const) {
      if (grouped[kind].length > 0) {
        await handleProjectMediaUpload(grouped[kind], kind);
      }
    }
  }

  async function handleUpdateTask(taskId: string, nextStatus: TaskStatus) {
    setBusyKey(`task-${taskId}-${nextStatus}`);
    setMessage("");
    const previousTask = taskList.find((task) => task.id === taskId) ?? null;

    const completedAt = nextStatus === "done" ? new Date().toISOString() : null;
    const completedBy = nextStatus === "done" ? managerId : null;

    const { error } = await supabase
      .from("tasks")
      .update({
        status: nextStatus,
        completed_at: completedAt,
        completed_by: completedBy,
      })
      .eq("id", taskId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    // Optimistic local update so the buttons re-render against the
    // real status before router.refresh completes — without this the
    // card would still offer "Start" until the next render even though
    // the row in the DB is now done.
    setTaskList((current) =>
      current.map((task) =>
        task.id === taskId
          ? { ...task, status: nextStatus, completed_at: completedAt, completed_by: completedBy }
          : task,
      ),
    );

    setBusyKey(null);
    setMessage(t("projectDetail.taskUpdated"));
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "task_status_changed",
      targetType: "task",
      targetId: taskId,
      beforeData: previousTask
        ? {
            title: previousTask.title,
            project_id: previousTask.project_id,
            assigned_to: previousTask.assigned_to,
            status: previousTask.status,
            effective_status: getEffectiveTaskStatus(previousTask),
            completed_at: previousTask.completed_at,
            completed_by: previousTask.completed_by,
          }
        : null,
      afterData: {
        title: previousTask?.title ?? null,
        project_id: previousTask?.project_id ?? project.id,
        assigned_to: previousTask?.assigned_to ?? null,
        status: nextStatus,
        completed_at: completedAt,
        completed_by: completedBy,
      },
    });
  }

  // Two-step soft-delete for project tasks. First click arms the
  // confirmation; second click writes deleted_at. We never hard-delete
  // — the row stays so /trash and audit_log keep their references.
  async function handleDeleteTask(taskId: string) {
    if (pendingDeleteTaskId !== taskId) {
      setPendingDeleteTaskId(taskId);
      setMessage(t("tasks.deleteSecondClick"));
      return;
    }

    setBusyKey(`task-delete-${taskId}`);
    setMessage("");
    const previousTask = taskList.find((task) => task.id === taskId) ?? null;
    const deletedAt = new Date().toISOString();

    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: deletedAt })
      .eq("id", taskId);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setTaskList((current) => current.filter((task) => task.id !== taskId));
    setPendingDeleteTaskId(null);
    setBusyKey(null);
    setMessage(t("tasks.deleted"));
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "task_deleted",
      targetType: "task",
      targetId: taskId,
      beforeData: previousTask
        ? {
            title: previousTask.title,
            project_id: previousTask.project_id,
            assigned_to: previousTask.assigned_to,
            status: previousTask.status,
            completed_at: previousTask.completed_at,
          }
        : null,
      afterData: {
        deleted_at: deletedAt,
      },
    });
    router.refresh();
  }

  const materialBadgeLabel =
    materialIndicator.primaryLabel === "urgent"
      ? t("materials.projectBadgeUrgent")
      : materialIndicator.primaryLabel === "seen"
        ? t("materials.projectBadgeSeen")
        : materialIndicator.primaryLabel === "assigned"
          ? t("materials.projectBadgeAssigned")
          : materialIndicator.primaryLabel === "needed"
            ? t("materials.projectBadgeNeeded")
            : null;
  const driverTimeProject = isDriverTimeProject(project);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
          {t("projectDetail.backToProjects")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold text-[var(--text-primary)]">{project.name}</h1>
            {project.address ? (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{project.address}</p>
            ) : null}
            <div className="mt-2">
              <ProjectNavigationActions
                projectName={project.name}
                address={project.address}
                siteCoordinates={site}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={
                  driverTimeProject
                    ? {
                        background: "rgba(15, 168, 120, 0.14)",
                        color: "var(--green)",
                      }
                    : site
                    ? {
                        background: "rgba(15, 168, 120, 0.14)",
                        color: "var(--green)",
                      }
                    : {
                        background: "rgba(245, 158, 11, 0.12)",
                        color: "#f59e0b",
                      }
                }
              >
                {driverTimeProject
                  ? t("projects.driverTimeProject")
                  : site
                    ? t("projects.gpsOkBadge")
                    : t("projects.gpsMissingBadge")}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {driverTimeProject
                  ? t("projects.driverTimeGpsNotRequired")
                  : site
                    ? t("projects.gpsOkHint")
                    : t("projects.noSiteCoords")}
              </span>
              {materialBadgeLabel ? (
                <span
                  className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{
                    background:
                      materialIndicator.primaryLabel === "urgent"
                        ? "rgba(239, 68, 68, 0.14)"
                        : "rgba(191, 162, 52, 0.14)",
                    color:
                      materialIndicator.primaryLabel === "urgent"
                        ? "var(--red)"
                        : "var(--brand-yellow)",
                  }}
                >
                  {materialBadgeLabel}
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={openEditModal}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
            style={
              site
                ? { borderColor: "var(--border-default)", color: "var(--text-primary)" }
                : {
                    borderColor: "#f59e0b",
                    color: "#f59e0b",
                    background: "rgba(245, 158, 11, 0.08)",
                  }
            }
          >
            <Pencil size={12} /> {site ? t("common.edit") : t("projects.fixCoordinates")}
          </button>
        </div>
      </section>

      {/* ── Stats (first content after header) ── */}
      <section className="surface-card p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="metric-panel rounded-[var(--radius-md)] p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("common.crew")}
            </div>
            <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
              {assignedProfiles.length}
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
              {taskList.filter(isEffectiveOpenTask).length}
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
              {t("safety.acksToday")}
            </div>
            <div className="mt-1 text-lg font-bold text-[var(--text-primary)]">
              {safetyAcksToday}
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card p-4" data-testid="manager-project-public-notes">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("projectNotes.title")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("projectNotes.subtitle")}
            </p>
          </div>
          <span
            className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{ background: "rgba(191, 162, 52, 0.14)", color: "var(--brand-yellow)" }}
          >
            {t("projectNotes.newBadge")} · {projectPublicNotes.length}
          </span>
        </div>
        {project.status !== "archived" ? (
          <form className="mt-3 space-y-2" onSubmit={(event) => void handleAddProjectPublicNote(event)}>
            <textarea
              value={projectNoteDraft}
              onChange={(event) => setProjectNoteDraft(event.target.value)}
              placeholder={t("projectNotes.placeholder")}
              maxLength={2000}
              disabled={projectNoteBusy}
              className="min-h-[86px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none disabled:opacity-60"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={projectNoteBusy || !projectNoteDraft.trim()}
                className="button-base button-primary px-3 py-2 text-xs disabled:opacity-60"
              >
                {projectNoteBusy ? t("common.saving") : t("projectNotes.add")}
              </button>
              {projectNoteMessage ? (
                <span
                  role={projectNoteMessage.kind === "err" ? "alert" : "status"}
                  className="text-xs font-semibold"
                  style={{
                    color: projectNoteMessage.kind === "ok" ? "var(--green)" : "var(--red)",
                  }}
                >
                  {projectNoteMessage.text}
                </span>
              ) : null}
            </div>
          </form>
        ) : null}
        {projectPublicNotes.length === 0 ? (
          <div className="mt-3 surface-panel p-3 text-sm text-[var(--text-secondary)]">
            {t("projectNotes.empty")}
          </div>
        ) : (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {projectPublicNotes.slice(0, 8).map((note) => (
              <article
                key={note.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.35)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--text-primary)]">
                    {note.authorName}
                  </span>
                  <span>{formatProjectPublicNoteTime(note.createdAt, locale)}</span>
                  <span className="rounded-[var(--radius-pill)] bg-[rgba(191,162,52,0.12)] px-1.5 py-0.5 font-semibold text-[var(--brand-yellow)]">
                    {t("projectNotes.publicBadge")}
                  </span>
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
                  {note.text}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* ── Project Timer ── */}
      <section className="surface-card p-4">
        {project.start_date || project.end_date ? (() => {
          const health = deriveProjectScheduleHealth({
            startDate: project.start_date,
            endDate: project.end_date,
          });
          const style = projectScheduleToneStyle(health.tone);
          const progress = Math.round(health.elapsedPercent ?? 0);
          const stateLabel =
            locale === "ru"
              ? health.state === "not_started"
                ? "Ещё не стартовал"
                : health.state === "half_elapsed"
                  ? "Прошли 50%"
                  : health.state === "almost_due"
                    ? "Осталось 10%"
                    : health.state === "overdue"
                      ? "Просрочен"
                      : "В графике"
              : health.state === "not_started"
                ? "Not started"
                : health.state === "half_elapsed"
                  ? "Past 50%"
                  : health.state === "almost_due"
                    ? "Last 10%"
                    : health.state === "overdue"
                      ? "Overdue"
                      : "On track";

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                {project.start_date ? (
                  <div className="text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{t("projects.startDate")}:</span>{" "}
                    {project.start_date}
                  </div>
                ) : null}
                {project.end_date ? (
                  <div className="text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">{t("schedule.deadline")}:</span>{" "}
                    {project.end_date}
                  </div>
                ) : null}
                <div
                  className="rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-semibold"
                  style={style}
                >
                  {stateLabel} · {formatProjectCountdown(health, locale)}
                </div>
              </div>
              {health.elapsedPercent !== null ? (
                <div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full"
                    style={{ background: "var(--bg-primary)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${progress}%`,
                        background: style.color,
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{project.start_date}</span>
                    <span>{progress}%</span>
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

      <section className="space-y-4">
        <div className="surface-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.assignedCrew")}</h2>
              <div className="flex items-center gap-3">
                <div className="text-xs text-[var(--text-muted)]">{assignedProfiles.length} {t("projectDetail.workers")}</div>
                <button
                  type="button"
                  onClick={() => setShowAddWorker((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-semibold"
                  style={{
                    background: showAddWorker ? "transparent" : "var(--brand-yellow)",
                    color: showAddWorker ? "var(--text-primary)" : "var(--text-inverse)",
                    border: showAddWorker ? "1px solid var(--border-default)" : "none",
                  }}
                >
                  {showAddWorker ? <X size={12} /> : <Plus size={12} />}
                  {showAddWorker ? t("common.cancel") : t("projectDetail.addWorker")}
                </button>
              </div>
            </div>
            {showAddWorker ? (
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
            ) : null}
            <div className="mt-4 space-y-3">
              {assignedProfiles.map((worker) => {
                const assignment = assignments.find((entry) => entry.profile_id === worker.id);
                // weekMinutes on ManagerProfileSummary already scopes to
                // the current Mon-Sun window; not per-project yet, but
                // for a solo-project worker this matches closely.
                const weekHours = worker.weekMinutes / 60;
                const onSiteForThisProject = worker.isOnSite && worker.currentProjectName === project.name;
                const gpsStatus = onSiteForThisProject ? gpsStatusByProfileId[worker.id] ?? null : null;
                const gpsStatusLabel = driverTimeProject && onSiteForThisProject
                  ? t("projects.driverTimeGpsNotRequired")
                  : !gpsStatus
                  ? null
                  : gpsStatus === "on_site"
                    ? t("gpsStatus.onSite")
                    : gpsStatus === "no_gps"
                      ? t("gpsStatus.noGps")
                      : gpsStatus === "off_site"
                        ? t("gpsStatus.offSite")
                        : t("gpsStatus.noFence");
                const freshness = onSiteForThisProject && !driverTimeProject
                  ? gpsFreshnessByProfileId[worker.id] ?? null
                  : null;
                const freshnessLabelMap: Record<GpsFreshnessStatus, string> = {
                  fresh: t("gpsFresh.fresh"),
                  delayed: t("gpsFresh.delayed"),
                  stale: t("gpsFresh.stale"),
                  lost: t("gpsFresh.lost"),
                  needs_review: t("gpsFresh.needsReview"),
                  no_signal: t("gpsFresh.noSignal"),
                };
                const review = onSiteForThisProject
                  ? shiftReviewByProfileId[worker.id] ?? null
                  : null;
                const reviewLabelMap: Record<ShiftReviewStatus, string> = {
                  normal: t("shiftReview.normal"),
                  long_shift: t("shiftReview.longShift"),
                  gps_stale: t("shiftReview.gpsStale"),
                  gps_lost: t("shiftReview.gpsLost"),
                  no_gps: t("shiftReview.noGps"),
                  needs_review: t("shiftReview.needsReview"),
                  video_missing: t("shiftReview.videoMissing"),
                };
                const initial = worker.name.trim().charAt(0).toUpperCase() || "?";
                return (
                  <div
                    key={worker.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <div
                          aria-hidden
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                          style={{
                            background: "rgba(191, 162, 52, 0.18)",
                            color: "var(--brand-yellow)",
                          }}
                        >
                          {initial}
                        </div>
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/team/${worker.id}`} className="text-sm font-semibold text-[var(--text-primary)]">
                              {worker.name}
                            </Link>
                            <span
                              className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em]"
                              style={{ background: "rgba(191, 162, 52, 0.14)", color: "var(--brand-yellow)" }}
                            >
                              {worker.role}
                            </span>
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                              style={{
                                color: driverTimeProject && onSiteForThisProject
                                  ? "var(--green)"
                                  : gpsStatus
                                  ? GPS_STATUS_COLOR[gpsStatus]
                                  : "var(--text-muted)",
                              }}
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{
                                  background: driverTimeProject && onSiteForThisProject
                                    ? "var(--green)"
                                    : gpsStatus
                                    ? GPS_STATUS_COLOR[gpsStatus]
                                    : "var(--text-muted)",
                                }}
                              />
                              {gpsStatusLabel ?? t("common.off")}
                            </span>
                            {freshness ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                                style={{ color: GPS_FRESHNESS_COLOR[freshness.status] }}
                                title={
                                  freshness.lastUpdateAt
                                    ? t("gpsFresh.tooltipUpdated").replace(
                                        "{age}",
                                        formatGpsAge(freshness.ageMs),
                                      )
                                    : t("gpsFresh.tooltipNever")
                                }
                              >
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: GPS_FRESHNESS_COLOR[freshness.status] }}
                                />
                                {freshnessLabelMap[freshness.status]}
                                {freshness.ageMs !== null ? (
                                  <span className="ml-0.5 font-mono text-[9px] text-[var(--text-muted)] normal-case">
                                    {formatGpsAge(freshness.ageMs)}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                            {review && review.status !== "normal" ? (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                                style={{ color: SHIFT_REVIEW_COLOR[review.status] }}
                                title={t("shiftReview.tooltipReasons").replace(
                                  "{list}",
                                  review.reasons.map((r) => reviewLabelMap[r]).join(", "),
                                )}
                              >
                                <span
                                  className="inline-block h-1.5 w-1.5 rounded-full"
                                  style={{ background: SHIFT_REVIEW_COLOR[review.status] }}
                                />
                                {reviewLabelMap[review.status]}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {t("common.week")}: {weekHours.toFixed(1)}h
                          </div>
                        </div>
                      </div>
                      {assignment ? (
                        removeAssignmentId === assignment.id ? (
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold">
                            <span style={{ color: "var(--red)" }}>
                              {t("projectDetail.removeWorkerConfirm").replace("{name}", worker.name)}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleRemoveAssignment(assignment.id)}
                              disabled={busyKey === `remove-${assignment.id}`}
                              className="rounded-[var(--radius-sm)] px-2 py-1"
                              style={{ background: "var(--red)", color: "white" }}
                            >
                              {t("common.yes")}
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemoveAssignmentId(null)}
                              className="rounded-[var(--radius-sm)] border px-2 py-1"
                              style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                            >
                              {t("common.no")}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setRemoveAssignmentId(assignment.id)}
                            disabled={busyKey === `remove-${assignment.id}`}
                            aria-label={t("common.remove")}
                            title={t("common.remove")}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
                            style={{
                              borderColor: "rgba(212, 81, 94, 0.3)",
                              color: "var(--red)",
                            }}
                          >
                            <X size={12} />
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
      </section>

      <section className="flex flex-col gap-5">
        <CollapsibleSection
          id="tasks"
          projectId={project.id}
          defaultOpen={false}
          persistState={false}
          dataTestid="manager-project-tasks-folder"
          className="order-2 p-4"
          summary={
            <>
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {tasksFolderSummary}
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("projectDetail.tasksSubtitle")}
              </p>
            </>
          }
          headerAction={
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setTaskAttachmentFiles([]);
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
            <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.5fr)_minmax(140px,0.7fr)_minmax(150px,0.8fr)]">
              <label className="grid min-w-0 gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                  {t("tasks.assignedToLabel")}
                </span>
                <select
                  name="assigned_to"
                  defaultValue=""
                  aria-label={t("projectDetail.assignToWorkerOptional")}
                  title={t("projectDetail.assignToWorkerOptional")}
                  className="min-h-12 w-full min-w-0 overflow-hidden text-ellipsis rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                >
                  <option value="">{t("common.unassigned")}</option>
                  {taskAssigneeProjectProfiles.length > 0 ? (
                    <optgroup label={t("projectDetail.taskAssigneeProjectCrew")}>
                      {taskAssigneeProjectProfiles.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {taskAssigneeOtherProfiles.length > 0 ? (
                    <optgroup label={t("projectDetail.taskAssigneeAllActive")}>
                      {taskAssigneeOtherProfiles.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
                {!hasTaskAssignees ? (
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {t("projectDetail.noActiveTaskAssignees")}
                  </span>
                ) : null}
              </label>
              <select
                name="priority"
                defaultValue="medium"
                className="min-h-12 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
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
            {taskList.map((task) => {
              const effectiveStatus = getEffectiveTaskStatus(task);
              // Priority drives the LEFT accent stripe + the priority
              // badge color. Status drives a separate badge so "urgent"
              // (red) is never misread as "done" (green) — the bug we
              // had before this fix.
              const prioColor =
                task.priority === "urgent" || task.priority === "high"
                  ? "#ef4444"
                  : task.priority === "medium"
                    ? "#f59e0b"
                    : "#22c55e";
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
              const canStart = effectiveStatus === "pending";
              const canMarkDone = effectiveStatus === "pending" || effectiveStatus === "in_progress";
              const canCancel = effectiveStatus !== "cancelled" && effectiveStatus !== "done";
              const isPendingDelete = pendingDeleteTaskId === task.id;
              const isBusy =
                busyKey?.startsWith(`task-${task.id}-`) || busyKey === `task-delete-${task.id}`;
              const isStartingTask = busyKey === `task-${task.id}-in_progress`;
              const isCompletingTask = busyKey === `task-${task.id}-done`;
              const isDeletingTask = busyKey === `task-delete-${task.id}`;
              const materialTask = isMaterialTask(task);
              const materialUrgency = getMaterialTaskUrgency(task);
              const materialNeededDate = getMaterialTaskNeededDate(task);
              const materialDriverSeen = hasDriverSeenMaterialTask(task);
              const materialLinks = materialTask ? getMaterialTaskLinks(task) : [];
              const rowAudit = getManagerTaskRowAuditText(
                {
                  ...task,
                  assigneeName: task.assigned_to
                    ? profileNameById.get(task.assigned_to) ?? null
                    : null,
                  completedByName: task.completed_by
                    ? profileNameById.get(task.completed_by) ?? null
                    : null,
                },
                profileNameById,
                {
                  unassigned: t("tasks.unassigned"),
                  unknown: t("tasks.unknown"),
                  formatCompletedAt: formatDateTime,
                },
              );
              return (
              <div
                key={task.id}
                className="task-card rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                style={{ "--task-accent": prioColor } as React.CSSProperties}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">
                      {rowAudit.assignedToText}
                    </div>
                    {rowAudit.seenByText ? (
                      <div className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">
                        {t("tasks.rowSeenByLabel")}: {rowAudit.seenByText}
                        {rowAudit.seenAtText ? ` · ${rowAudit.seenAtText}` : ""}
                      </div>
                    ) : null}
                    {rowAudit.startedByText ? (
                      <div className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">
                        {t("tasks.rowStartedByLabel")}: {rowAudit.startedByText}
                        {rowAudit.startedAtText ? ` · ${rowAudit.startedAtText}` : ""}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{ background: `${prioColor}18`, color: prioColor }}
                    >
                      {task.priority}
                    </span>
                    {materialTask ? (
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                        style={{
                          background:
                            materialUrgency === "urgent"
                              ? "rgba(239, 68, 68, 0.14)"
                              : "rgba(191, 162, 52, 0.14)",
                          color:
                            materialUrgency === "urgent"
                              ? "var(--red)"
                              : "var(--brand-yellow)",
                        }}
                      >
                        {materialUrgency === "urgent"
                          ? t("materials.projectBadgeUrgent")
                          : t("materials.materialTask")}
                      </span>
                    ) : null}
                    <span
                      className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{
                        background: "rgba(148, 163, 184, 0.10)",
                        color: statusColor,
                      }}
                    >
                      {statusLabelText}
                    </span>
                  </div>
                </div>
                {task.description ? (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">{task.description}</p>
                ) : null}
                {materialLinks.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {materialLinks.map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-[var(--brand-yellow)]"
                      >
                        {t("materials.orderLinkLabel")}
                      </a>
                    ))}
                  </div>
                ) : null}
                {materialTask ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-[var(--text-muted)]">
                    {materialNeededDate ? (
                      <span>
                        {t("materials.neededDate")}: {materialNeededDate}
                      </span>
                    ) : null}
                    {materialDriverSeen ? <span>{t("materials.driverSeen")}</span> : null}
                  </div>
                ) : null}
                {effectiveStatus === "done" ? (
                  <div
                    className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-[var(--text-primary)]"
                    data-testid="manager-project-task-row-completion-audit"
                  >
                    <span>
                      {t("tasks.rowAssignedLabel")}: {rowAudit.assignedToText}
                    </span>
                    <span>
                      {t("tasks.rowCompletedByLabel")}: {rowAudit.completedByText}
                    </span>
                    <span>
                      {t("tasks.rowCompletedAtLabel")}: {rowAudit.completedAtText}
                    </span>
                  </div>
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
                  if (refs.length === 0) return null;
                  return (
                    <>
                      <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                        📎 {refs.length} {t("tasks.filesShort")}
                      </div>
                      <TaskAttachmentList items={refs} />
                    </>
                  );
                })()}
                <TaskAttachmentUploader
                  taskId={task.id}
                  orgId={orgId}
                  projectId={task.project_id}
                  uploadedBy={managerId}
                  disabled={isBusy}
                  compact
                  onAttached={({ taskId, metadata, attachments }) =>
                    handleInlineTaskAttachmentsAdded(taskId, metadata, attachments)
                  }
                />
                {(() => {
                  // Worker completion evidence — note, follow-up flag,
                  // and any media the worker uploaded via the
                  // completion modal. Drawn from tasks.metadata so an
                  // archived task still surfaces the same panel after a
                  // refresh — no separate fetch needed.
                  const completionNote = getCompletionNote(task);
                  const followUp = getFollowUpInfo(task);
                  const audit = getTaskCompletionAudit(
                    {
                      ...task,
                      completedByName: task.completed_by
                        ? profileNameById.get(task.completed_by) ?? null
                        : null,
                    },
                    profileNameById,
                  );
                  const completionRefs = getCompletionMediaIds(task)
                    .map((id) => mediaById.get(id))
                    .filter((m): m is NonNullable<typeof m> => Boolean(m))
                    .map((m) => ({
                      id: m.id,
                      filename: m.filename,
                      mime_type: m.mime_type,
                      media_type: m.media_type,
                      storage_path: m.storage_path,
                    }));
                  const hasAnyEvidence =
                    Boolean(completionNote) ||
                    followUp.required ||
                    completionRefs.length > 0 ||
                    audit.hasAudit;
                  if (!hasAnyEvidence) return null;
                  return (
                    <div
                      className="mt-3 rounded-[var(--radius-md)] border p-3"
                      style={{
                        borderColor: followUp.required
                          ? "rgba(245, 158, 11, 0.35)"
                          : "rgba(15, 168, 120, 0.24)",
                        background: followUp.required
                          ? "rgba(245, 158, 11, 0.06)"
                          : "rgba(15, 168, 120, 0.06)",
                      }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                          {t("tasks.completionEvidenceHeader")}
                        </div>
                        {effectiveStatus === "done" ? (
                          <span
                            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                            style={{
                              background: "rgba(15, 168, 120, 0.16)",
                              color: "var(--green)",
                            }}
                          >
                            {statusLabelText}
                          </span>
                        ) : null}
                        {followUp.required ? (
                          <span
                            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
                            style={{
                              background: "rgba(245, 158, 11, 0.16)",
                              color: "#f59e0b",
                            }}
                          >
                            {t("tasks.followUpBadge")}
                          </span>
                        ) : null}
                      </div>
                      {audit.completedById ? (
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          {t("tasks.completionByLabel")}:{" "}
                          {audit.completedByName ?? audit.completedById}
                        </div>
                      ) : null}
                      {audit.completedAt ? (
                        <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                          {t("tasks.completionAtLabel")}: {formatDateTime(audit.completedAt)}
                        </div>
                      ) : null}
                      {completionNote ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--text-primary)]">
                          {completionNote}
                        </p>
                      ) : null}
                      {followUp.required && followUp.note ? (
                        <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-secondary)]">
                          <span className="font-semibold">{t("tasks.followUpNoteLabel")}: </span>
                          {followUp.note}
                        </div>
                      ) : null}
                      {completionRefs.length > 0 ? (
                        <div className="mt-2">
                          <TaskAttachmentList items={completionRefs} />
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {canStart ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "in_progress")}
                      disabled={isBusy}
                      className="button-base button-secondary min-h-0 px-3 py-2 text-xs"
                    >
                      {isStartingTask ? t("tasks.taking") : t("common.start")}
                    </button>
                  ) : null}
                  {canMarkDone ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "done")}
                      disabled={isBusy}
                      className="button-base button-primary min-h-0 px-3 py-2 text-xs"
                    >
                      {isCompletingTask ? t("tasks.finishing") : t("common.done")}
                    </button>
                  ) : null}
                  {canCancel ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "cancelled")}
                      disabled={isBusy}
                      className="button-base button-danger-ghost min-h-0 px-3 py-2 text-xs"
                    >
                      {t("common.cancel")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void handleDeleteTask(task.id)}
                    disabled={isBusy}
                    aria-label={t("common.remove")}
                    title={t("common.remove")}
                    className="ml-auto inline-flex items-center justify-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-semibold disabled:opacity-50"
                    style={{
                      borderColor: isPendingDelete
                        ? "var(--red)"
                        : "rgba(212, 81, 94, 0.3)",
                      color: "var(--red)",
                      background: isPendingDelete
                        ? "rgba(212, 81, 94, 0.12)"
                        : "transparent",
                    }}
                    >
                    <Trash2 size={12} />
                    {isDeletingTask
                      ? t("common.deleting")
                      : isPendingDelete
                        ? t("common.yes")
                        : null}
                  </button>
                  {isPendingDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingDeleteTaskId(null);
                        setMessage("");
                      }}
                      disabled={isBusy}
                      className="rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-semibold"
                      style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                    >
                      {t("common.no")}
                    </button>
                  ) : null}
                </div>
              </div>
              );
            })}
          </div>
        </CollapsibleSection>

        <div className="contents">
          <CollapsibleSection
            id="media"
            projectId={project.id}
            defaultOpen={false}
            dataTestid="manager-project-media-folder"
            className="order-1 p-4"
            summary={
              <>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {mediaFolderSummary}
                </h2>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {t("projectDetail.projectMediaSubtitle")}
                </p>
              </>
            }
            headerAction={
              <>
                <input
                  ref={quickProjectMediaInputRef}
                  type="file"
                  accept={ACCEPT_ALL_UPLOADS}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleQuickProjectMediaUpload(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    quickProjectMediaInputRef.current?.click();
                  }}
                  disabled={busyKey === "project-media"}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
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
            {/* File-type upload triggers — photo / video / PDF / documents. Local-device only. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                ref={photoMediaInputRef}
                type="file"
                accept={ACCEPT_IMAGE_UPLOADS}
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
                accept={ACCEPT_VIDEO_UPLOADS}
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
                accept={ACCEPT_PDF_UPLOADS}
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleProjectMediaUpload(e.target.files, "pdf");
                  e.target.value = "";
                }}
              />
              <input
                ref={documentMediaInputRef}
                type="file"
                accept={ACCEPT_DOCUMENT_UPLOADS}
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleProjectMediaUpload(e.target.files, "document");
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
              <button
                type="button"
                onClick={() => documentMediaInputRef.current?.click()}
                disabled={busyKey === "project-media"}
                className="rounded-[var(--radius-sm)] border px-2.5 py-1 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                📎 {t("projectDetail.addDocument")}
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
                    { key: "documents", label: t("projectDetail.mediaFilterDocuments"), icon: "📄", count: mediaCounts.documents },
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
            <div className="mt-4">
              {projectMediaItems.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noMedia")}
                </div>
              ) : filteredMedia.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noMediaForFilter")}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {filteredMedia.map((item) => {
                    const previewUrl = projectMediaTileUrls.get(item.id);
                    const previewFailed = projectMediaTileFailedIds.has(item.id);
                    const tileLabel = item.filename ?? item.media_type;
                    const isPreviewMedia = item.media_type === "photo" || item.media_type === "video";
                    const isPreviewLoading = isPreviewMedia && !previewUrl && !previewFailed;

                    return (
                      <div key={item.id} className="min-w-0">
                        <div
                          className="relative aspect-square overflow-hidden rounded-[var(--radius-md)] border"
                          style={{
                            borderColor: "var(--border-default)",
                            background: "var(--bg-primary)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => void openProjectMediaItem(item)}
                            title={tileLabel}
                            aria-label={`${t("messages.openFile")}: ${tileLabel}`}
                            className="absolute inset-0 block w-full text-left"
                          >
                            {item.media_type === "photo" && previewUrl && !previewFailed ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={previewUrl}
                                alt={tileLabel}
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover"
                                onError={() => markProjectMediaTileFailed(item.id)}
                              />
                            ) : item.media_type === "video" && previewUrl && !previewFailed ? (
                              <>
                                <video
                                  src={previewUrl}
                                  preload="metadata"
                                  muted
                                  playsInline
                                  className="absolute inset-0 h-full w-full object-cover"
                                  onError={() => markProjectMediaTileFailed(item.id)}
                                />
                                <span
                                  className="absolute inset-0 flex items-center justify-center"
                                  style={{ color: "white", background: "rgba(0, 0, 0, 0.16)" }}
                                  aria-hidden="true"
                                >
                                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/55">
                                    <Play size={20} fill="currentColor" />
                                  </span>
                                </span>
                              </>
                            ) : isPreviewLoading ? (
                              <div
                                className="absolute inset-0 animate-pulse"
                                style={{
                                  background:
                                    "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(191,162,52,0.14), rgba(255,255,255,0.04))",
                                }}
                              />
                            ) : (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
                                <ProjectMediaTypeIcon
                                  mediaType={item.media_type}
                                  className="text-[var(--brand-yellow)]"
                                />
                                <span className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                                  {projectMediaTypeLabel(item.media_type)}
                                </span>
                              </div>
                            )}
                            {item.caption ? (
                              <span
                                className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-[10px] font-medium text-white"
                                style={{
                                  background:
                                    "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.68) 100%)",
                                }}
                              >
                                <span className="block truncate">{item.caption}</span>
                              </span>
                            ) : null}
                          </button>
                          {item.is_checkout ? (
                            <span
                              className="absolute left-1 top-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                              style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                            >
                              {t("journal.checkout")}
                            </span>
                          ) : null}
                          <div className="absolute right-1 top-1">
                            <MediaFlagButton
                              mediaId={item.id}
                              hasOpenFlag={openFlagIds.has(item.id)}
                              onClick={() => setFlagModalMediaId(item.id)}
                            />
                          </div>
                        </div>
                        <div className="mt-1.5 flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void openProjectMediaItem(item)}
                            title={t("messages.openFile")}
                            aria-label={`${t("messages.openFile")}: ${tileLabel}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{
                              borderColor: "rgba(191, 162, 52, 0.4)",
                              color: "var(--brand-yellow)",
                            }}
                          >
                            <ExternalLink size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void downloadProjectMediaItem(item)}
                            title={t("messages.downloadFile")}
                            aria-label={`${t("messages.downloadFile")}: ${tileLabel}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                          >
                            <Download size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setFlagModalMediaId(item.id)}
                            title={t("flags.flagForReview")}
                            aria-label={`${t("flags.flagForReview")}: ${tileLabel}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border"
                            style={{ borderColor: "rgba(212, 81, 94, 0.3)", color: "var(--red)" }}
                          >
                            <Flag size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id="recent-shifts"
            projectId={project.id}
            defaultOpen={false}
            dataTestid="manager-project-recent-shifts-folder"
            className="order-3 p-4"
            summary={
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("projectDetail.recentShifts")}: {sessions.length}
              </h2>
            }
          >
            <div className="mt-4 space-y-3">
              {sessions.length === 0 ? (
                <div className="surface-panel p-3 text-sm text-[var(--text-secondary)]">
                  {t("projectDetail.noShifts")}
                </div>
              ) : (
                sessions.map((session) => {
                  const checkoutMedia = checkoutMediaBySessionId.get(session.id) ?? [];
                  const shouldShowMissingVideo =
                    session.checkoutStatus === "pending" && checkoutMedia.length === 0;

                  return (
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

                      {checkoutMedia.length > 0 ? (
                        <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(15,168,120,0.28)] bg-[rgba(15,168,120,0.06)] p-2">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--green)]">
                            <FileVideo2 size={12} />
                            {t("projectDetail.checkoutVideoEvidence")}
                          </div>
                          <div className="space-y-2">
                            {checkoutMedia.map((item) => (
                              <div
                                key={item.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[rgba(15,17,23,0.45)] px-2 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                    {item.filename ?? t("journal.checkoutVideo")}
                                  </div>
                                  <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                                    {formatDateTime(item.created_at)}
                                    {item.time_event_id ? "" : ` · ${t("projectDetail.unlinkedCheckoutVideo")}`}
                                  </div>
                                </div>
                                <div className="flex shrink-0 gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void openProjectMediaItem(item)}
                                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                                    style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
                                  >
                                    <ExternalLink size={11} />
                                    {t("messages.openFile")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void downloadProjectMediaItem(item)}
                                    className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] font-semibold"
                                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                  >
                                    <Download size={11} />
                                    {t("messages.downloadFile")}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : shouldShowMissingVideo ? (
                        <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs font-semibold text-[#f59e0b]">
                          {t("projectDetail.checkoutVideoMissing")}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </CollapsibleSection>
        </div>
      </section>

      <ProjectPlanningSections
        orgId={orgId}
        projectId={project.id}
        managerId={managerId}
        projectSettings={project.settings}
        hasFinanceAccess={hasFinanceAccess}
        canDeleteMedia={canDeleteMedia}
      />
      {/* ── Materials & Deliveries ── */}
      <MaterialsSection
        orgId={orgId}
        projectId={project.id}
        managerId={managerId}
        knownProfileNames={profileNameById}
        assigneeProfiles={materialTakerProfiles}
      />
      {/* ── Receipts ── */}
      <ReceiptsSection
        orgId={orgId}
        projectId={project.id}
        managerId={managerId}
        managerName={managerName}
        managerRole={managerRole}
        hasFinanceAccess={hasFinanceAccess}
        canDeleteMedia={canDeleteMedia}
      />
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

      {taskComposerOpen ? (
        <ModalBackdrop
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClose={() => setTaskComposerOpen(false)}
        >
          <div
            className="surface-card w-full max-w-[720px] max-h-[90vh] overflow-y-auto p-4"
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
                <X size={14} />
              </button>
            </div>
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
              <div className="grid gap-3 lg:grid-cols-[minmax(280px,1.5fr)_minmax(140px,0.7fr)_minmax(150px,0.8fr)]">
                <label className="grid min-w-0 gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {t("tasks.assignedToLabel")}
                  </span>
                  <select
                    name="assigned_to"
                    defaultValue=""
                    aria-label={t("projectDetail.assignToWorkerOptional")}
                    title={t("projectDetail.assignToWorkerOptional")}
                    className="min-h-12 w-full min-w-0 overflow-hidden text-ellipsis rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  >
                    <option value="">{t("common.unassigned")}</option>
                    {taskAssigneeProjectProfiles.length > 0 ? (
                      <optgroup label={t("projectDetail.taskAssigneeProjectCrew")}>
                        {taskAssigneeProjectProfiles.map((worker) => (
                          <option key={worker.id} value={worker.id}>
                            {worker.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {taskAssigneeOtherProfiles.length > 0 ? (
                      <optgroup label={t("projectDetail.taskAssigneeAllActive")}>
                        {taskAssigneeOtherProfiles.map((worker) => (
                          <option key={worker.id} value={worker.id}>
                            {worker.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  {!hasTaskAssignees ? (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {t("projectDetail.noActiveTaskAssignees")}
                    </span>
                  ) : null}
                </label>
                <select
                  name="priority"
                  defaultValue="medium"
                  className="min-h-12 w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
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
                  type="file"
                  multiple
                  accept={ACCEPT_ALL_UPLOADS}
                  onChange={(event) =>
                    setTaskAttachmentFiles(event.target.files ? Array.from(event.target.files) : [])
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
          </div>
        </ModalBackdrop>
      ) : null}

      {showEditModal ? (
        <ModalBackdrop
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClose={closeEditModal}
        >
          <div
            className="surface-card w-full max-w-[700px] max-h-[90vh] overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">
                {t("projects.editProject")}
              </h2>
              <button
                type="button"
                onClick={closeEditModal}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                <X size={14} />
              </button>
            </div>
            <form
              ref={editFormRef}
              className="mt-4 grid gap-3"
              onSubmit={handleUpdateProject}
            >
              <TextInputWithVoice
                name="name"
                defaultValue={project.name}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <label className="flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,168,120,0.08)] px-3 py-3 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  name="driver_time_project"
                  checked={editDriverTimeProject}
                  onChange={(event) => {
                    setEditDriverTimeProject(event.target.checked);
                    if (event.target.checked) {
                      setCoordinatesConfirmed(false);
                    }
                  }}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border-default)]"
                />
                <span>
                  <span className="block font-semibold text-[var(--text-primary)]">
                    {t("projects.driverTimeProject")}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                    {t("projects.driverTimeProjectHint")}
                  </span>
                </span>
              </label>
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.2)] p-3">
                <TextInputWithVoice
                  name="address"
                  defaultValue={project.address ?? ""}
                  placeholder={t("common.address")}
                  onChange={() => {
                    setAddressLookup(null);
                    setAddressLookupError("");
                    setCoordinatesConfirmed(false);
                  }}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => fillAddressFromDeviceLocation()}
                    disabled={fetchingAddressFromLocation}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
                  >
                    {fetchingAddressFromLocation
                      ? t("projects.findingLocationAsAddress")
                      : t("projects.useLocationAsAddress")}
                  </button>
                </div>
                {addressLookupError ? (
                  <div
                    className="mt-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm"
                    style={{
                      borderColor: "rgba(212, 81, 94, 0.35)",
                      background: "rgba(212, 81, 94, 0.08)",
                      color: "var(--red)",
                    }}
                  >
                    {addressLookupError}
                  </div>
                ) : null}
                {addressLookup ? (
                  <div
                    className="mt-3 rounded-[var(--radius-md)] border px-3 py-3 text-xs"
                    style={{
                      borderColor: "rgba(15, 168, 120, 0.25)",
                      background: "rgba(15, 168, 120, 0.08)",
                    }}
                  >
                    <div className="font-semibold text-[var(--text-primary)]">
                      {t("projects.addressLookupMatched")}
                    </div>
                    <div className="mt-1 text-sm text-[var(--text-primary)]">
                      {addressLookup.formattedAddress ?? addressLookup.requestedAddress}
                    </div>
                    <div className="mt-2 text-[var(--text-secondary)]">
                      {t("projects.latitude")}: {addressLookup.lat.toFixed(6)} · {t("projects.longitude")}:{" "}
                      {addressLookup.lng.toFixed(6)}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {hasFinanceAccess ? (
                  <input
                    name="rate"
                    type="number"
                    step="0.01"
                    defaultValue={project.rate}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                ) : null}
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
                <div className="flex items-stretch gap-2">
                  <input
                    ref={editLatRef}
                    name="lat"
                    type="text"
                    inputMode="decimal"
                    required={!editDriverTimeProject && !project.hasValidSiteCoordinates}
                    onPaste={(event) =>
                      applyPastedCoordinatePair(event, editLatRef.current, editLngRef.current, () => {
                        setCoordinatesConfirmed(false);
                        setDeviceLocation(null);
                        setAddressLookup(null);
                        setAddressLookupError("");
                      })
                    }
                    onChange={() => {
                      setCoordinatesConfirmed(false);
                      setDeviceLocation(null);
                      setAddressLookup(null);
                      setAddressLookupError("");
                    }}
                    defaultValue={site?.lat ?? ""}
                    placeholder={t("projects.latitude")}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={fillCurrentLocation}
                    disabled={pickingLocation}
                    title={t("projects.useCurrentLocation")}
                    aria-label={t("projects.useCurrentLocation")}
                    className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border px-3 text-xs font-semibold disabled:opacity-50"
                    style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
                  >
                    {pickingLocation ? "..." : t("projects.useCurrentLocation")}
                  </button>
                </div>
                <input
                  ref={editLngRef}
                  name="lng"
                  type="text"
                  inputMode="decimal"
                  required={!editDriverTimeProject && !project.hasValidSiteCoordinates}
                  onPaste={(event) =>
                    applyPastedCoordinatePair(event, editLatRef.current, editLngRef.current, () => {
                      setCoordinatesConfirmed(false);
                      setDeviceLocation(null);
                      setAddressLookup(null);
                      setAddressLookupError("");
                    })
                  }
                  onChange={() => {
                    setCoordinatesConfirmed(false);
                    setDeviceLocation(null);
                    setAddressLookup(null);
                    setAddressLookupError("");
                  }}
                  defaultValue={site?.lng ?? ""}
                  placeholder={t("projects.longitude")}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {editDriverTimeProject ? t("projects.driverTimeGpsHint") : t("projects.deviceLocationHint")}
              </p>
              {deviceLocation ? (
                <div
                  className="rounded-[var(--radius-md)] border px-3 py-3 text-xs"
                  style={{
                    borderColor: deviceLocation.shouldWarn
                      ? "rgba(245, 158, 11, 0.35)"
                      : "var(--border-default)",
                    background: deviceLocation.shouldWarn
                      ? "rgba(245, 158, 11, 0.08)"
                      : "rgba(15, 17, 23, 0.24)",
                  }}
                >
                  <div className="font-semibold text-[var(--text-primary)]">
                    {deviceLocation.accuracyMeters !== null
                      ? t("projects.deviceLocationAccuracy").replace(
                          "{meters}",
                          String(deviceLocation.accuracyMeters),
                        )
                      : t("projects.deviceLocationAccuracyUnavailable")}
                  </div>
                  {deviceLocation.shouldWarn ? (
                    <p className="mt-1 font-semibold" style={{ color: "#f59e0b" }}>
                      {t("projects.deviceLocationAccuracyWarning")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <label
                className="flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm text-[var(--text-secondary)]"
                style={{
                  borderColor: coordinatesConfirmed
                    ? "rgba(15, 168, 120, 0.35)"
                    : "rgba(245, 158, 11, 0.35)",
                  background: coordinatesConfirmed
                    ? "rgba(15, 168, 120, 0.08)"
                    : "rgba(245, 158, 11, 0.08)",
                }}
              >
                <input
                  type="checkbox"
                  required={!editDriverTimeProject}
                  disabled={editDriverTimeProject}
                  checked={coordinatesConfirmed}
                  onChange={(event) => setCoordinatesConfirmed(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 rounded border-[var(--border-default)]"
                />
                <span className="flex-1">
                  <span className="block font-semibold text-[var(--text-primary)]">
                    {t("projects.coordsConfirmationLabel")}
                  </span>
                  <span className="mt-1 block text-xs text-[var(--text-muted)]">
                    {t("projects.coordsConfirmationHint")}
                  </span>
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <DateField
                  name="start_date"
                  label={t("projects.startDate")}
                  defaultValue={project.start_date ?? ""}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <DateField
                  name="end_date"
                  label={t("projects.endDate")}
                  defaultValue={project.end_date ?? ""}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
              <TextInputWithVoice
                multiline
                name="notes"
                defaultValue={project.notes ?? ""}
                className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyKey === "project-update"}
                  className="button-base button-primary"
                >
                  {busyKey === "project-update" ? t("common.saving") : t("projectDetail.saveProject")}
                </button>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </div>
        </ModalBackdrop>
      ) : null}
      <MediaViewerModal
        item={mediaViewerItem}
        onClose={() => {
          const itemId = mediaViewerItem?.id;
          setMediaViewerItem(null);
          suppressMediaViewerItem(itemId);
        }}
      />
    </div>
  );
}

// ── Inline Materials sub-component ──

type MaterialItem = {
  id: string;
  name: string;
  quantity: string;
  unit: string;
  priority: TaskPriority;
  status: TaskStatus;
  color: string;
  delivered: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  assignedToId: string | null;
  driverName: string | null;
  neededDate: string | null;
  urgency: MaterialTaskUrgency;
  driverSeen: boolean;
  assignedById: string | null;
  authorName: string;
  deliveredById: string | null;
  deliveredByName: string | null;
  deliveredAt: string | null;
  receiptId: string | null;
  receiptAttachedById: string | null;
  receiptAttachedByName: string | null;
  receipt: ViewerMediaItem | null;
  links: string[];
};

type MaterialOrderGroup = {
  id: string;
  orderId: string | null;
  authorName: string;
  createdAt: string;
  priority: TaskPriority;
  note: string;
  link: string | null;
  items: MaterialItem[];
};

function MaterialsSection({
  orgId,
  projectId,
  managerId,
  knownProfileNames,
  assigneeProfiles,
}: {
  orgId: string;
  projectId: string;
  managerId: string;
  knownProfileNames: Map<string, string>;
  assigneeProfiles: MaterialAssigneeOption[];
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<MaterialItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addMaterialOpen, setAddMaterialOpen] = useState(false);
  const [orderRows, setOrderRows] = useState<MaterialOrderDraftRow[]>(() => [
    createMaterialOrderRow(),
  ]);
  const [orderAssignedTo, setOrderAssignedTo] = useState("");
  const [orderNeededDate, setOrderNeededDate] = useState("");
  const [orderPriority, setOrderPriority] = useState<TaskPriority>("medium");
  const [orderNote, setOrderNote] = useState("");
  const [orderLink, setOrderLink] = useState("");
  const [orderSpecPasteText, setOrderSpecPasteText] = useState("");
  const [orderSpecFeedback, setOrderSpecFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [orderFiles, setOrderFiles] = useState<File[]>([]);
  const [orderError, setOrderError] = useState("");
  const [savingOrder, setSavingOrder] = useState(false);
  const [deliveryTarget, setDeliveryTarget] = useState<MaterialItem | null>(null);
  const [deliveryFile, setDeliveryFile] = useState<File | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [receiptViewerItem, setReceiptViewerItem] = useState<ViewerMediaItem | null>(null);

  const readMaterialItems = useCallback(async (): Promise<MaterialItem[]> => {
    const { data } = await supabase
      .from("tasks")
      .select("id, title, priority, status, due_date, assigned_to, metadata, created_at, updated_at, assigned_by")
      .eq("project_id", projectId)
      .eq("metadata->>category", "material")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      priority: TaskPriority;
      status: TaskStatus;
      due_date: string | null;
      assigned_to: string | null;
      metadata: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
      assigned_by: string | null;
    }>;

    const profileIds = new Set<string>();
    const receiptIds = new Set<string>();
    for (const row of rows) {
      if (isProfileId(row.assigned_by)) profileIds.add(row.assigned_by);
      if (isProfileId(row.assigned_to)) profileIds.add(row.assigned_to);
      const meta = row.metadata ?? {};
      if (isProfileId(meta.delivered_by)) profileIds.add(meta.delivered_by);
      if (isProfileId(meta.receipt_attached_by)) profileIds.add(meta.receipt_attached_by);
      if (typeof meta.receipt_id === "string") receiptIds.add(meta.receipt_id);
    }
    profileIds.add(managerId);

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
    for (const [id, name] of knownProfileNames) {
      const displayName = normalizeProfileDisplayName(name);
      if (isProfileId(id) && displayName) {
        profileNameById.set(id, displayName);
      }
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

    return rows.map((row) => ({
      id: row.id,
      name: row.title,
      quantity: formatMaterialQuantity(row.metadata?.quantity),
      unit: typeof row.metadata?.unit === "string" ? row.metadata.unit : "",
      priority: row.priority,
      status: row.status,
      color: getMaterialPriorityColor(row.priority),
      delivered: row.status === "done",
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      assignedToId: row.assigned_to,
      driverName: isProfileId(row.assigned_to) ? resolveProfileName(row.assigned_to) : null,
      neededDate: getMaterialTaskNeededDate(row),
      urgency: getMaterialTaskUrgency(row),
      driverSeen: hasDriverSeenMaterialTask(row),
      assignedById: row.assigned_by,
      authorName: isProfileId(row.assigned_by) ? resolveProfileName(row.assigned_by) : fallbackUserName,
      deliveredById:
        isProfileId(row.metadata?.delivered_by) ? row.metadata.delivered_by : null,
      deliveredByName:
        typeof row.metadata?.delivered_by === "string"
          ? resolveProfileName(row.metadata.delivered_by)
          : null,
      deliveredAt:
        typeof row.metadata?.delivered_at === "string" ? row.metadata.delivered_at : null,
      receiptId: typeof row.metadata?.receipt_id === "string" ? row.metadata.receipt_id : null,
      receiptAttachedById:
        isProfileId(row.metadata?.receipt_attached_by)
          ? row.metadata.receipt_attached_by
          : null,
      receiptAttachedByName:
        typeof row.metadata?.receipt_attached_by === "string"
          ? resolveProfileName(row.metadata.receipt_attached_by)
          : null,
      receipt:
        typeof row.metadata?.receipt_id === "string"
          ? receiptById.get(row.metadata.receipt_id) ?? null
          : null,
      links: getMaterialTaskLinks(row),
    }));
  }, [supabase, projectId, managerId, knownProfileNames, t]);

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
    setOrderAssignedTo("");
    setOrderNeededDate("");
    setOrderPriority("medium");
    setOrderNote("");
    setOrderLink("");
    setOrderSpecPasteText("");
    setOrderSpecFeedback(null);
    setOrderFiles([]);
    setOrderError("");
  }

  function openAddMaterialModal() {
    resetOrderDraft();
    setAddMaterialOpen(true);
  }

  function closeAddMaterialModal() {
    if (savingOrder) return;
    setAddMaterialOpen(false);
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

  function handleImportMaterialSpec() {
    const parsed = parseMaterialSpecPaste(orderSpecPasteText);
    if (parsed.items.length === 0) {
      setOrderSpecFeedback({ type: "error", text: t("materials.specParseEmpty") });
      return;
    }

    const parsedRows = parsed.items.map(draftRowFromSpecItem);
    setOrderRows((current) => {
      const onlyEmptyRow =
        current.length === 1 &&
        !current[0]?.name.trim() &&
        !current[0]?.quantity.trim() &&
        !current[0]?.customUnit.trim() &&
        !current[0]?.notes.trim();
      return onlyEmptyRow ? parsedRows : [...current, ...parsedRows];
    });
    setOrderSpecPasteText("");
    const feedbackParts = [
      t("materials.specParsedCount").replace("{count}", String(parsedRows.length)),
    ];
    if (parsed.deduped) {
      feedbackParts.push(t("materials.specDuplicatesCleaned"));
    }
    setOrderSpecFeedback({
      type: "success",
      text: feedbackParts.join(" "),
    });
  }

  async function handleAddOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingOrder) return;
    const materialRows = orderRows
      .map((row) => ({
        name: row.name.trim(),
        quantity: parseMaterialQuantity(row.quantity),
        unit:
          row.unit === "other"
            ? row.customUnit.trim() || MATERIAL_OTHER_UNIT_VALUE
            : row.unit,
        notes: row.notes.trim(),
      }))
      .filter((row) => row.name.length > 0);

    if (materialRows.length === 0) return;

    setSavingOrder(true);
    setOrderError("");
    const uploadedMediaIds: string[] = [];
    for (const file of orderFiles) {
      if (!file || file.size === 0) {
        setSavingOrder(false);
        setOrderError(t("tasks.attachmentCloudFallback"));
        return;
      }
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        setSavingOrder(false);
        setOrderError(t("tasks.attachmentCloudFallback"));
        return;
      }
      const uploadResult = await uploadTaskAttachment(supabase, {
        orgId,
        projectId,
        uploadedBy: managerId,
        file,
      });
      if (!uploadResult.ok) {
        setSavingOrder(false);
        setOrderError(t("tasks.attachmentCloudFallback"));
        return;
      }
      uploadedMediaIds.push(uploadResult.mediaId);
    }
    const orderId = createClientUuid();
    const trimmedOrderNote = orderNote.trim();
    const trimmedOrderLink = orderLink.trim();
    const driverUserId = orderAssignedTo || null;
    const neededDate = orderNeededDate || null;
    const urgency: MaterialTaskUrgency =
      orderPriority === "urgent" || orderPriority === "high" ? "urgent" : "normal";
    const materialItems = materialRows.map((row) => ({
      name: row.name,
      quantity: row.quantity,
      unit: row.unit,
      notes: row.notes || null,
    }));
    const createdTaskIds: string[] = [];
    for (const row of materialRows) {
      const response = await fetch("/api/manager/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: row.name,
          description: row.notes || trimmedOrderNote || null,
          projectId,
          assignedTo: driverUserId,
          priority: orderPriority,
          dueDate: neededDate,
          source: "project_material_order",
          attachmentMediaIds: uploadedMediaIds,
          material: {
            enabled: true,
            materialName: row.name,
            urgency,
            neededDate,
            notes: row.notes || trimmedOrderNote,
            quantity: row.quantity,
            unit: row.unit,
            orderId,
            orderNote: trimmedOrderNote,
            orderLink: trimmedOrderLink,
            orderSize: materialRows.length,
            materialItems,
          },
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { task?: { id?: string }; error?: string }
        | null;
      if (!response.ok) {
        setSavingOrder(false);
        setOrderError(payload?.error ?? `Request failed (${response.status})`);
        await refreshMaterials();
        return;
      }
      if (payload?.task?.id) {
        createdTaskIds.push(payload.task.id);
      }
    }
    if (uploadedMediaIds.length > 0 && createdTaskIds[0]) {
      void linkMediaToTask(supabase, createdTaskIds[0], uploadedMediaIds);
    }
    setSavingOrder(false);

    setAddMaterialOpen(false);
    resetOrderDraft();
    await refreshMaterials();
  }

  const materialGroups = useMemo<MaterialOrderGroup[]>(() => {
    const grouped = new Map<string, MaterialOrderGroup>();
    for (const item of items) {
      const orderId = typeof item.metadata.order_id === "string" ? item.metadata.order_id : null;
      const groupKey = orderId ?? `legacy-${item.id}`;
      const note = typeof item.metadata.order_note === "string" ? item.metadata.order_note : "";
      const link = item.links[0] ?? null;
      const current = grouped.get(groupKey);
      if (current) {
        current.items.push(item);
        if (!current.link && link) current.link = link;
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
          link,
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

    const safeName = buildSafeUploadName(file, "receipt");
    const displayName = file.name || safeName;
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
        uploaded_by: managerId,
        media_type: mediaType,
        storage_path: path,
        filename: displayName,
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
          uploader_name: "Manager",
        },
      })
      .select("id, storage_path, filename, mime_type, media_type, caption, created_at, metadata")
      .single<ViewerMediaItem>();
    if (insertErr || !row) throw new Error(insertErr?.message ?? t("messages.uploadFailed"));
    return row;
  }

  function openDeliveryModal(item: MaterialItem) {
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
          : managerId,
        delivered_at:
          typeof deliveryTarget.metadata.delivered_at === "string"
            ? deliveryTarget.metadata.delivered_at
            : now,
        receipt_id: receipt?.id ?? null,
        receipt_attached_by: receipt ? managerId : null,
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

  async function undoDelivery(item: MaterialItem) {
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
      dataTestid="manager-project-materials-folder"
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
                    {group.link ? (
                      <p className="mt-1 truncate text-xs font-semibold text-[var(--brand-yellow)]">
                        {t("materials.orderLinkLabel")}
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
                {group.link ? (
                  <a
                    href={group.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-3 inline-flex text-xs font-semibold text-[var(--brand-yellow)]"
                  >
                    {t("materials.orderLinkLabel")}
                  </a>
                ) : null}
                <div className="space-y-2">
                  {group.items.map((item) => {
                    const quantityLabel = item.quantity
                      ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
                      : "";
                    const deliveredAt = item.deliveredAt ?? (item.delivered ? item.updatedAt : null);
                    return (
                      <div
                        key={item.id}
                        className="task-card rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                        style={
                          {
                            "--task-accent": item.color,
                            opacity: item.delivered ? 0.7 : 1,
                          } as React.CSSProperties
                        }
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={item.delivered}
                            onChange={(event) => {
                              if (event.target.checked) {
                                openDeliveryModal(item);
                              } else {
                                void undoDelivery(item);
                              }
                            }}
                            className="mt-1 h-4 w-4 shrink-0"
                          />
                          <div className="min-w-0 flex-1">
                            <div>
                              <span
                                className="text-sm font-semibold text-[var(--text-primary)]"
                                style={{ textDecoration: item.delivered ? "line-through" : "none" }}
                              >
                                {item.name}
                              </span>
                            {quantityLabel ? (
                                <span className="ml-2 text-xs text-[var(--text-muted)]">
                                  — {quantityLabel}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                              <span>
                                {item.urgency === "urgent"
                                  ? t("materials.urgent")
                                  : t("materials.notUrgent")}
                              </span>
                              {item.neededDate ? (
                                <span>
                                  {t("materials.neededDate")}: {item.neededDate}
                                </span>
                              ) : null}
                              {item.driverName ? (
                                <span>
                                  {t("materials.assignedTo")}: {item.driverName}
                                </span>
                              ) : (
                                <span>{t("materials.openQueueLabel")}</span>
                              )}
                              {item.driverSeen ? <span>{t("materials.driverSeen")}</span> : null}
                            </div>
                            {item.delivered ? (
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
                                      if (item.receipt) setReceiptViewerItem(item.receipt);
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
    {addMaterialOpen ? (
      <ModalBackdrop
        className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClose={closeAddMaterialModal}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="surface-card flex max-h-[90vh] w-full max-w-[860px] flex-col p-0"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3 px-4 pt-4">
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
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          {orderError ? (
            <div className="mt-3 rounded-[var(--radius-md)] bg-red-500/10 px-3 py-2 text-xs font-semibold text-[var(--red)]">
              {orderError}
            </div>
          ) : null}
          <form className="mt-4 grid gap-4" onSubmit={handleAddOrder}>
            <div className="grid gap-3 sm:grid-cols-[180px_minmax(220px,0.8fr)_minmax(180px,0.7fr)_minmax(0,1fr)]">
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
              <select
                value={orderAssignedTo}
                onChange={(event) => setOrderAssignedTo(event.target.value)}
                aria-label={t("materials.assignMaterialTaker")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("materials.openQueueOption")}</option>
                {assigneeProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              {assigneeProfiles.length === 0 ? (
                <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                  {t("materials.noMaterialTakersAvailable")}
                </div>
              ) : null}
              <DateField
                value={orderNeededDate}
                onChange={(event) => setOrderNeededDate(event.target.value)}
                label={t("materials.neededDate")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
              <TextInputWithVoice
                multiline
                rows={2}
                value={orderNote}
                onChange={(event) => setOrderNote(event.target.value)}
                placeholder={t("materials.orderNote")}
                className="min-h-[82px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
            <input
              type="url"
              value={orderLink}
              onChange={(event) => setOrderLink(event.target.value)}
              placeholder={t("materials.orderLinkPlaceholder")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
            />
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("materials.pasteSpecTitle")}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t("materials.pasteSpecHint")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleImportMaterialSpec}
                  disabled={savingOrder || orderSpecPasteText.trim().length === 0}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  style={{
                    borderColor: "rgba(191, 162, 52, 0.4)",
                    color: "var(--brand-yellow)",
                  }}
                >
                  {t("materials.importSpecRows")}
                </button>
              </div>
              <TextInputWithVoice
                multiline
                rows={5}
                value={orderSpecPasteText}
                onChange={(event) => {
                  setOrderSpecPasteText(event.target.value);
                  setOrderSpecFeedback(null);
                }}
                placeholder={t("materials.pasteSpecPlaceholder")}
                className="min-h-[120px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              />
              {orderSpecFeedback ? (
                <div
                  className={
                    orderSpecFeedback.type === "success"
                      ? "text-xs font-semibold text-emerald-400"
                      : "text-xs font-semibold text-[var(--red)]"
                  }
                >
                  {orderSpecFeedback.text}
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              {orderRows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 sm:grid-cols-[minmax(0,1fr)_120px] lg:grid-cols-[minmax(0,1fr)_120px_minmax(180px,240px)_minmax(0,1fr)_36px]"
                >
                  <TextInputWithVoice
                    value={row.name}
                    onChange={(event) => updateOrderRow(row.id, { name: event.target.value })}
                    placeholder={t("materials.name")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <input
                    type="text"
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
                  <input
                    value={row.notes}
                    onChange={(event) => updateOrderRow(row.id, { notes: event.target.value })}
                    placeholder={t("materials.itemNotes")}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                    style={MATERIAL_INPUT_STYLE}
                  />
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
            <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-primary)]">
              <span className="font-semibold">{t("materials.addFile")}</span>
              <UploadSourceButtons
                onFiles={(files) => setOrderFiles(files ? Array.from(files) : [])}
                dataTestIdPrefix="material-order-upload"
              />
              <span className="text-xs text-[var(--text-muted)]">
                {orderFiles.length > 0
                  ? t("materials.filesSelected").replace("{count}", String(orderFiles.length))
                  : t("materials.addFileHint")}
              </span>
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
                className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
              >
                {savingOrder ? t("materials.savingOrder") : t("materials.saveOrder")}
              </button>
            </div>
          </form>
          </div>
        </div>
      </ModalBackdrop>
    ) : null}
    {deliveryTarget ? (
      <ModalBackdrop
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClose={closeDeliveryModal}
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
                {deliveryTarget.name}
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
      </ModalBackdrop>
    ) : null}
    <MediaViewerModal
      item={receiptViewerItem}
      onClose={() => setReceiptViewerItem(null)}
    />
    </>
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
  managerName,
  managerRole,
  hasFinanceAccess,
  canDeleteMedia,
}: {
  orgId: string;
  projectId: string;
  managerId: string;
  managerName: string;
  managerRole: UserRole;
  hasFinanceAccess: boolean;
  canDeleteMedia: boolean;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const [receipts, setReceipts] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [receiptUploadOpen, setReceiptUploadOpen] = useState(false);
  const [receiptUploadError, setReceiptUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Mobile-first capture: separate hidden input with capture="environment"
  // so tapping the camera button on phone goes straight to the rear camera
  // instead of bouncing through the OS file picker.
  const cameraRef = useRef<HTMLInputElement>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      // Without finance access the user is gated to their own receipts.
      // RLS already enforces this — the client-side .eq() narrows the
      // result set and keeps the UI honest (so the totals/count match
      // what the user is actually entitled to see).
      let query = supabase
        .from("media")
        .select("*")
        .eq("project_id", projectId)
        .eq("metadata->>category", "receipt")
        .is("deleted_at", null);
      if (!hasFinanceAccess) {
        query = query.eq("uploaded_by", managerId);
      }
      const { data } = await query.order("created_at", { ascending: false });

      const rows = (data ?? []) as Array<Media & { metadata: Record<string, unknown> }>;

      // Sign every receipt URL in one batch round-trip. The "media" bucket
      // is Private, so getPublicUrl produces 404'ing URLs — same root cause
      // already fixed in TaskAttachmentList. 1h TTL is plenty for browsing.
      const paths = rows.map((r) => normalizeStoragePath(r.storage_path));
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
          url: signedByPath.get(normalizeStoragePath(r.storage_path)) ?? "",
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
  }, [supabase, projectId, hasFinanceAccess, managerId]);

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
    if (!files || files.length === 0) {
      setReceiptUploadError(t("receipts.selectFiles"));
      return;
    }

    const storeName = fd.get("store")?.toString() ?? "";
    const otherStore = fd.get("store_other")?.toString().trim() ?? "";
    const finalStore = storeName === "__other" ? otherStore : storeName;
    const amount = Number.parseFloat(fd.get("amount")?.toString() ?? "0");
    const purchaseDate = fd.get("purchase_date")?.toString() ?? new Date().toISOString().slice(0, 10);
    const note = fd.get("note")?.toString().trim() ?? "";

    // Receipt photo + amount remain mandatory. Store became optional —
    // many small purchases don't have a clean store identity (street
    // vendor, multi-stop trip, etc.). Empty store is stored as null.
    if (!amount) {
      setReceiptUploadError(t("workerProject.receiptAmountRequired"));
      return;
    }

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
                : error.kind === "pdf"
                  ? "uploads.tooLargePdf"
                  : "uploads.tooLargeDocument";
          const text = t(key);
          setMessage(text);
          setReceiptUploadError(text);
        } else {
          const text = t("uploads.unsupportedType").replace("{kind}", error.mime);
          setMessage(text);
          setReceiptUploadError(text);
        }
        return;
      }
      if (validation.kind === "video" || validation.kind === "document") {
        const text = t("uploads.unsupportedType").replace("{kind}", file.type || file.name);
        setMessage(text);
        setReceiptUploadError(text);
        return;
      }
    }

    setUploading(true);
    setMessage("");
    setReceiptUploadError("");

    for (const file of Array.from(files)) {
      const safeName = buildSafeUploadName(file, "receipt");
      const displayName = file.name || safeName;
      const path = `${orgId}/${projectId}/receipts/${createClientUuid()}-${safeName}`;
      const mimeType = inferUploadContentType(file);

      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, cacheControl: "3600", contentType: mimeType });

      if (uploadErr) {
        const text = t("messages.uploadFailed");
        setMessage(text);
        setReceiptUploadError(text);
        setUploading(false);
        return;
      }

      const mediaType = mimeType.startsWith("image/") ? "photo" : "pdf";

      const metadata = {
        kind: "receipt" as const,
        category: "receipt" as const,
        store_name: finalStore || null,
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
          filename: displayName,
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
        const text = t("messages.uploadFailed");
        setMessage(text);
        setReceiptUploadError(text);
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
          filename: displayName,
          storeName: finalStore,
          amount,
          purchaseDate,
          note,
          uploaderName: "Manager",
          isImage: mimeType.startsWith("image/"),
        },
        ...prev,
      ]);
      void logAudit({
        orgId,
        actorId: managerId,
        actorName: managerName,
        actorRole: managerRole,
        action: "receipt_uploaded",
        targetType: "media",
        targetId: row.id,
        beforeData: null,
        afterData: {
          project_id: projectId,
          filename: displayName,
          media_type: mediaType,
          amount,
          store_name: finalStore || null,
          purchase_date: purchaseDate,
        },
      });
    }

    setUploading(false);
    setReceiptUploadOpen(false);
    form.reset();
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    setShowOther(false);
    setReceiptUploadError("");
  }

  async function handleDelete(receipt: ReceiptItem) {
    if (deletingReceiptId) return;
    if (!canDeleteMedia) {
      setMessage("Only Andrey and Sergey can delete media.");
      return;
    }

    setDeletingReceiptId(receipt.id);
    setMessage("");
    const response = await fetch(`/api/media/${receipt.id}`, { method: "DELETE" });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      deletedAt?: string;
    };
    if (!response.ok) {
      setMessage(payload.error ?? `Request failed (${response.status})`);
      setDeletingReceiptId(null);
      return;
    }
    const deletedAt = payload.deletedAt ?? new Date().toISOString();
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
    setMessage(t("receipts.deleted"));
    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "receipt_deleted",
      targetType: "media",
      targetId: receipt.id,
      beforeData: {
        project_id: projectId,
        filename: receipt.filename,
        amount: receipt.amount,
        store_name: receipt.storeName || null,
        purchase_date: receipt.purchaseDate || null,
      },
      afterData: {
        deleted_at: deletedAt,
      },
    });
    setDeletingReceiptId(null);
    setTimeout(() => setMessage(""), 2000);
  }

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const [showOther, setShowOther] = useState(false);
  // Project-wide totals are only meaningful when the viewer can see the
  // whole project's receipts. Hide the dollar suffix for non-finance
  // viewers — they'd only be summing their own receipts, which is a
  // misleading line item.
  const receiptsSummary = receipts.length > 0
    ? hasFinanceAccess
      ? `${formatSectionCountSummary(t("receipts.title"), [
          { count: receipts.length, label: t("receipts.items") },
        ])}, ${currency.format(total)}`
      : formatSectionCountSummary(t("receipts.title"), [
          { count: receipts.length, label: t("receipts.items") },
        ])
    : formatSectionCountSummary(t("receipts.title"), [
        { count: 0, label: t("receipts.items") },
      ]);

  return (
    <>
    <CollapsibleSection
      id="receipts"
      projectId={projectId}
      defaultOpen={false}
      dataTestid="manager-project-receipts-folder"
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
            setReceiptUploadError("");
            setReceiptUploadOpen(true);
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
      <p className="mt-1 text-xs text-[var(--text-muted)]">{t("projectDetail.receiptsSubtitle")}</p>
      {!hasFinanceAccess ? (
        <p className="mt-1 text-xs font-semibold" style={{ color: "var(--brand-yellow)" }}>
          {t("projectDetail.receiptsOwnOnly")}
        </p>
      ) : null}

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
            defaultValue=""
            onChange={(e) => setShowOther(e.target.value === "__other")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{t("receipts.store")}</option>
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
                  {canDeleteMedia ? (
                    <button
                      type="button"
                      onClick={() => void handleDelete(r)}
                      disabled={deletingReceiptId === r.id}
                      className="shrink-0 text-[10px] text-[var(--text-muted)] hover:text-[var(--red)]"
                      title={deletingReceiptId === r.id ? t("common.deleting") : t("common.delete")}
                    >
                      {deletingReceiptId === r.id ? t("common.deleting") : "✕"}
                    </button>
                  ) : null}
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
    </CollapsibleSection>
    {receiptUploadOpen ? (
      <ModalBackdrop
        className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
        onClose={() => {
          setReceiptUploadOpen(false);
          setReceiptUploadError("");
        }}
      >
        <div
          className="surface-card max-h-[90vh] w-full max-w-[760px] overflow-y-auto p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {t("receipts.addReceipt")}
            </h2>
            <button
              type="button"
              onClick={() => {
                setReceiptUploadOpen(false);
                setReceiptUploadError("");
              }}
              aria-label={t("common.cancel")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              <X size={14} />
            </button>
          </div>
          {receiptUploadError ? (
            <div className="mt-3 rounded-[var(--radius-md)] bg-red-500/10 px-3 py-2 text-xs font-semibold text-[var(--red)]">
              {receiptUploadError}
            </div>
          ) : null}
          <form className="mt-4 grid gap-3" onSubmit={handleUpload}>
            <div
              className="relative rounded-[var(--radius-md)] border-2 border-dashed p-4 text-center transition-colors"
              style={{
                borderColor: dragging ? "var(--brand-yellow)" : "var(--border-default)",
                background: dragging ? "rgba(191,162,52,0.06)" : "var(--bg-primary)",
              }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (fileRef.current && event.dataTransfer.files.length) {
                  fileRef.current.files = event.dataTransfer.files;
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
                defaultValue=""
                onChange={(event) => setShowOther(event.target.value === "__other")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("receipts.store")}</option>
                {STORES.map((store) => (
                  <option key={store} value={store}>{store}</option>
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
        </div>
      </ModalBackdrop>
    ) : null}
    </>
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
