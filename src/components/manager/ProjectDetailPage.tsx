"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileVideo2, Pencil, Plus, Trash2, X } from "lucide-react";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { MediaFlagButton, MediaFlagModal } from "@/components/shared/MediaFlagModal";
import { fetchOpenFlagMediaIds } from "@/lib/media-flags";
import { ACCEPT_ALL_UPLOADS, validateUploadFile } from "@/lib/upload-limits";
import {
  getAttachmentMediaIds,
  linkMediaToTask,
  normalizeStoragePath,
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
import {
  MediaGalleryDrawer,
  type GalleryItem,
} from "@/components/shared/MediaGalleryDrawer";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import { ProjectSiteMap } from "@/components/maps/ProjectSiteMap";
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
import {
  MediaSignTimeoutError,
  isBrowserUnsafeVideo,
  selectMediaPlayback,
  signWithTimeout,
} from "@/lib/media-playback";
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

function setInputElementValue(
  input: HTMLInputElement | null,
  value: string,
) {
  if (!input) {
    return;
  }

  input.value = value;
}

export function ProjectDetailPage({
  orgId,
  managerId,
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
}: {
  orgId: string;
  managerId: string;
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
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [geocodingAddress, setGeocodingAddress] = useState(false);
  const [fetchingAddressFromLocation, setFetchingAddressFromLocation] = useState(false);
  const [coordinatesConfirmed, setCoordinatesConfirmed] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocationAssessment | null>(null);
  const [addressLookup, setAddressLookup] = useState<AddressLookupState | null>(null);
  const [addressLookupError, setAddressLookupError] = useState("");
  const [showAddWorker, setShowAddWorker] = useState(false);
  const [removeAssignmentId, setRemoveAssignmentId] = useState<string | null>(null);
  const [pendingDeleteTaskId, setPendingDeleteTaskId] = useState<string | null>(null);
  // Drawer that surfaces every media row on this project — receipts,
  // checkout videos, task attachments, journal photos. Filters and
  // pagination live inside the drawer so the page stays light.
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Local optimistic copy of the task list. Soft-deletes drop the row
  // here immediately so the manager doesn't see a flash before
  // router.refresh repopulates from the server.
  const [taskList, setTaskList] = useState<Task[]>(tasks);
  useEffect(() => {
    setTaskList(tasks);
  }, [tasks]);
  const [previewMedia, setPreviewMedia] = useState<{
    item: Media;
    signedUrl: string;
    mimeType: string | null;
    isPlaybackVersion: boolean;
    /** True when the original is HEVC/.mov which most browsers can't decode. */
    browserUnsafe: boolean;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [flagModalMediaId, setFlagModalMediaId] = useState<string | null>(null);
  const [openFlagIds, setOpenFlagIds] = useState<Set<string>>(new Set());
  const [mediaFilter, setMediaFilter] = useState<"all" | "photo" | "video" | "pdf">("all");
  const [taskAttachmentFiles, setTaskAttachmentFiles] = useState<File[]>([]);
  const taskAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const editFormRef = useRef<HTMLFormElement | null>(null);
  const editLatRef = useRef<HTMLInputElement | null>(null);
  const editLngRef = useRef<HTMLInputElement | null>(null);
  const mediaById = useMemo(
    () => new Map(media.map((m) => [m.id, m])),
    [media],
  );
  const profileNameById = useMemo(
    () => buildProfileNameMap([...assignedProfiles, ...availableProfiles, ...(completionProfiles ?? [])]),
    [assignedProfiles, availableProfiles, completionProfiles],
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

  // Gallery feed for the drawer — every media row on this project,
  // including receipts / checkout / task attachments. The drawer
  // filters, the page list above keeps showing only the
  // "project_media" subset to match its existing semantics.
  const galleryItems = useMemo<GalleryItem[]>(() => {
    const profileNameById = new Map<string, string>();
    for (const p of assignedProfiles) profileNameById.set(p.id, p.name);
    for (const p of availableProfiles) profileNameById.set(p.id, p.name);
    return media.map((entry) => ({
      id: entry.id,
      project_id: entry.project_id,
      uploaded_by: entry.uploaded_by ?? null,
      media_type: entry.media_type,
      storage_path: entry.storage_path,
      filename: entry.filename ?? null,
      mime_type: entry.mime_type ?? null,
      caption: entry.caption ?? null,
      is_checkout: Boolean(entry.is_checkout),
      time_event_id: entry.time_event_id ?? null,
      metadata: (entry.metadata ?? null) as Record<string, unknown> | null,
      created_at: entry.created_at,
      projectName: project.name,
      uploaderName: entry.uploaded_by ? profileNameById.get(entry.uploaded_by) ?? null : null,
    }));
  }, [media, assignedProfiles, availableProfiles, project.name]);

  const galleryUploaderOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of galleryItems) {
      if (item.uploaded_by && item.uploaderName && !seen.has(item.uploaded_by)) {
        seen.set(item.uploaded_by, item.uploaderName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [galleryItems]);

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
  const { t } = useTranslation();

  function openEditModal() {
    setCoordinatesConfirmed(false);
    setDeviceLocation(null);
    setAddressLookup(null);
    setAddressLookupError("");
    setShowEditModal(true);
  }

  function closeEditModal() {
    setShowEditModal(false);
    setCoordinatesConfirmed(false);
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
    const rate = Number.parseFloat(formData.get("rate")?.toString() ?? `${project.rate}`);
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? `${project.radius_m}`, 10);
    const status = (formData.get("status")?.toString() ?? project.status) as ProjectStatus;
    const coordinates = parseCoordinateInputPair(formData.get("lat"), formData.get("lng"), {
      allowBlank: project.hasValidSiteCoordinates,
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
    if (!coordinatesConfirmed) {
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
        rate: Number.isFinite(rate) ? rate : project.rate,
        radius_m: Number.isFinite(radius) ? radius : project.radius_m,
        status,
        lat: coordinates.point?.lat ?? null,
        lng: coordinates.point?.lng ?? null,
        coordinatesConfirmed,
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

  // Click-to-open for the Project Media list.
  //
  // Videos and photos open in an in-page preview modal so the manager
  // never has to download a file just to watch it. PDFs continue to
  // open in a new tab — browsers handle PDF rendering natively, and
  // an embedded <iframe> blocks the worker's signed-URL flow on
  // tighter Content-Security-Policy setups.
  //
  // selectMediaPlayback decides what to sign:
  //   • a transcoded H.264 MP4 under metadata.playback_path (when
  //     transcoding_status === "ready"), OR
  //   • the original storage_path otherwise.
  //   • metadata.mux_playback_id is exposed for a future Mux signing
  //     layer; we never feed that string through Supabase Storage.
  async function openProjectMediaItem(item: Media) {
    if (typeof window === "undefined") return;

    const playback = selectMediaPlayback(item as unknown as {
      storage_path: string;
      mime_type: string | null;
      metadata: Record<string, unknown> | null | undefined;
    });

    // Documents/PDFs: external tab path is the safest UX, because a
    // signed URL inside an iframe still has the same auth surface but
    // the browser's PDF chrome (zoom, search, save) is much better
    // than anything we'd build inline.
    if (item.media_type === "pdf" || item.media_type === "document") {
      const tab = window.open("about:blank", "_blank");
      if (!tab) {
        setMessage(t("projectDetail.mediaOpenFailed"));
        return;
      }
      const normalized = normalizeStoragePath(playback.path);
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(normalized, 3600);
      if (error || !data?.signedUrl) {
        tab.close();
        setMessage(t("projectDetail.mediaOpenFailed"));
        return;
      }
      tab.location.href = data.signedUrl;
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewMedia(null);
    setMessage("");

    const normalized = normalizeStoragePath(playback.path);
    // signWithTimeout caps the wait at MEDIA_SIGN_TIMEOUT_MS (9s) so
    // a Supabase request that hangs at the transport layer (DNS stall,
    // dev-server reverse-proxy bug, missing demo seed file) cannot
    // strand the manager on a "Loading…" overlay — try/finally on a
    // raw await wouldn't help, because `finally` only fires once the
    // underlying promise settles.
    try {
      const signed = await signWithTimeout(
        supabase.storage.from("media").createSignedUrl(normalized, 3600),
      );
      const { data, error } = signed;

      if (error || !data?.signedUrl) {
        const isTimeout = error instanceof MediaSignTimeoutError;
        console.error("[project-media] failed to sign URL", error);
        const userMessage = isTimeout
          ? t("projectDetail.mediaOpenTimeout")
          : t("projectDetail.mediaOpenFailed");
        setPreviewError(userMessage);
        setMessage(userMessage);
        return;
      }

      setPreviewMedia({
        item,
        signedUrl: data.signedUrl,
        mimeType: playback.mimeType,
        isPlaybackVersion: playback.isPlaybackVersion,
        browserUnsafe:
          item.media_type === "video" &&
          !playback.isPlaybackVersion &&
          isBrowserUnsafeVideo(item as unknown as {
            storage_path: string;
            mime_type: string | null;
            metadata: Record<string, unknown> | null | undefined;
          }),
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewMedia(null);
    setPreviewError(null);
    setPreviewLoading(false);
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
    kind: "photo" | "video" | "pdf",
  ) {
    const list = files ? Array.from(files) : [];
    console.log("[project-media] start", { kind, fileCount: list.length });
    if (list.length === 0) return;

    // Pre-validate all files before any upload starts so a single bad
    // file in a multi-select doesn't leave half the batch in storage.
    for (const file of list) {
      console.log("[project-media] file metadata", {
        kind,
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        mimeEmpty: file.type === "",
        hasExtension: /\.[A-Za-z0-9]{2,5}$/.test(file.name),
      });
      const validation = validateUploadFile(file);
      if (!validation.ok) {
        const attempted = "mime" in validation.error ? validation.error.mime : null;
        console.error("[project-media] validation REJECTED", {
          reason: validation.error.reason,
          attempted,
        });
        setMessage(`validation: ${validation.error.reason}${attempted ? ` (${attempted})` : ""}`);
        return;
      }
      console.log("[project-media] validation ok", { fileKind: validation.kind });
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
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${orgId}/${project.id}/project-media/${Date.now()}-${safeName}`;
      const contentType =
        file.type ||
        (kind === "pdf" ? "application/pdf" : kind === "photo" ? "image/jpeg" : "video/mp4");

      console.log("[project-media] storage upload begin", {
        path,
        contentType,
        size: file.size,
      });

      const { error: uploadErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: false, cacheControl: "3600", contentType });
      if (uploadErr) {
        console.error("[project-media] storage upload FAIL", uploadErr);
        setMessage(`storage: ${uploadErr.message}`);
        setBusyKey(null);
        return;
      }
      console.log("[project-media] storage upload ok");

      const metadata = { kind: "project_media" as const };
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
        console.error("[project-media] media insert FAIL", insertErr);
        setMessage(`media-insert: ${insertErr.message}`);
        setBusyKey(null);
        return;
      }
      console.log("[project-media] media insert ok");
    }

    setBusyKey(null);
    setMessage(t("projectDetail.mediaUploaded"));
    router.refresh();
  }

  async function handleUpdateTask(taskId: string, nextStatus: TaskStatus) {
    setBusyKey(`task-${taskId}`);
    setMessage("");

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
    router.refresh();
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

    const { error } = await supabase
      .from("tasks")
      .update({ deleted_at: new Date().toISOString() })
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
    router.refresh();
  }

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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={
                  site
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
                {site ? t("projects.gpsOkBadge") : t("projects.gpsMissingBadge")}
              </span>
              <span className="text-xs text-[var(--text-secondary)]">
                {site ? t("projects.gpsOkHint") : t("projects.noSiteCoords")}
              </span>
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
              {taskList.filter((task) => task.status !== "done" && task.status !== "cancelled").length}
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

      <section className="grid gap-5 xl:grid-cols-2">
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
            <div className="surface-panel mt-4 space-y-3 p-4">
              <div
                className="inline-flex items-center rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  color: "#f59e0b",
                }}
              >
                {t("projects.gpsMissingBadge")}
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                {t("projectDetail.addLatLng")}
              </p>
              <button
                type="button"
                onClick={openEditModal}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{
                  borderColor: "#f59e0b",
                  color: "#f59e0b",
                  background: "rgba(245, 158, 11, 0.08)",
                }}
              >
                <Pencil size={12} /> {t("projects.fixCoordinates")}
              </button>
            </div>
          )}
        </div>

        <div className="space-y-4">
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
                const gpsStatusLabel = !gpsStatus
                  ? null
                  : gpsStatus === "on_site"
                    ? t("gpsStatus.onSite")
                    : gpsStatus === "no_gps"
                      ? t("gpsStatus.noGps")
                      : gpsStatus === "off_site"
                        ? t("gpsStatus.offSite")
                        : t("gpsStatus.noFence");
                const freshness = onSiteForThisProject
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
                                color: gpsStatus
                                  ? GPS_STATUS_COLOR[gpsStatus]
                                  : "var(--text-muted)",
                              }}
                            >
                              <span
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{
                                  background: gpsStatus
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
        </div>
      </section>

      <section id="tasks" className="flex scroll-mt-4 flex-col gap-5">
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
                aria-label={t("projectDetail.assignToWorkerOptional")}
                title={t("projectDetail.assignToWorkerOptional")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("projectDetail.assignToWorkerOptional")}</option>
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
            {taskList.map((task) => {
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
                task.status === "done"
                  ? "var(--green)"
                  : task.status === "in_progress"
                    ? "var(--blue)"
                    : task.status === "cancelled"
                      ? "var(--red)"
                      : "var(--text-muted)";
              const statusLabelText =
                task.status === "done"
                  ? t("tasks.statusDone")
                  : task.status === "in_progress"
                    ? t("tasks.statusInProgress")
                    : task.status === "cancelled"
                      ? t("tasks.statusCancelled")
                      : t("tasks.statusPending");
              const canStart = task.status === "pending";
              const canMarkDone = task.status === "pending" || task.status === "in_progress";
              const canCancel = task.status !== "cancelled" && task.status !== "done";
              const isPendingDelete = pendingDeleteTaskId === task.id;
              const isBusy =
                busyKey === `task-${task.id}` || busyKey === `task-delete-${task.id}`;
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
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <span
                      className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
                      style={{ background: `${prioColor}18`, color: prioColor }}
                    >
                      {task.priority}
                    </span>
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
                {task.status === "done" ? (
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
                        {task.status === "done" ? (
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
                      {t("common.start")}
                    </button>
                  ) : null}
                  {canMarkDone ? (
                    <button
                      type="button"
                      onClick={() => void handleUpdateTask(task.id, "done")}
                      disabled={isBusy}
                      className="button-base button-primary min-h-0 px-3 py-2 text-xs"
                    >
                      {t("common.done")}
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
                    {isPendingDelete ? t("common.yes") : null}
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
        </div>

        <div className="contents">
          <div className="surface-card p-4 order-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projectDetail.recentMedia")}</h2>
              <div className="flex items-center gap-3">
                <div className="text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                  📷 {mediaCounts.photo}{"  "}🎥 {mediaCounts.video}{"  "}📄 {mediaCounts.pdf}
                </div>
                {media.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setGalleryOpen(true)}
                    className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                    style={{
                      borderColor: "rgba(191, 162, 52, 0.4)",
                      color: "var(--brand-yellow)",
                    }}
                  >
                    {t("gallery.viewAll")}
                  </button>
                ) : null}
              </div>
            </div>
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
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void openProjectMediaItem(item)}
                            className="text-left text-sm font-semibold text-[var(--text-primary)] underline-offset-2 hover:underline focus:underline"
                          >
                            {item.filename ?? item.media_type}
                          </button>
                          {item.is_checkout ? (
                            <span
                              className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                              style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                            >
                              {t("journal.checkout")}
                            </span>
                          ) : null}
                        </div>
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

      <MediaGalleryDrawer
        open={galleryOpen}
        title={project.name}
        items={galleryItems}
        showUploaderFilter
        uploaderOptions={galleryUploaderOptions}
        onClose={() => setGalleryOpen(false)}
      />

      {previewMedia ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)", zIndex: 1000 }}
          onClick={closePreview}
        >
          <div
            className="surface-card w-full max-w-[900px] max-h-[90vh] overflow-y-auto p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-[var(--text-primary)]">
                  {previewMedia.item.filename ?? previewMedia.item.media_type}
                </h2>
                <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {formatDateTime(previewMedia.item.created_at)}
                  {" · "}
                  {previewMedia.item.media_type}
                  {previewMedia.isPlaybackVersion ? (
                    <span className="ml-2 rounded-[var(--radius-pill)] bg-[rgba(15,168,120,0.16)] px-1.5 py-0.5 font-semibold text-[var(--green)]">
                      {t("projectDetail.mediaPlaybackVersion")}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={closePreview}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-3 flex justify-center rounded-[var(--radius-md)] bg-black p-2">
              {previewMedia.item.media_type === "video" ? (
                <video
                  key={previewMedia.signedUrl}
                  src={previewMedia.signedUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className="max-h-[70vh] w-full"
                >
                  {previewMedia.mimeType ? (
                    <source src={previewMedia.signedUrl} type={previewMedia.mimeType} />
                  ) : null}
                </video>
              ) : previewMedia.item.media_type === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewMedia.signedUrl}
                  alt={previewMedia.item.filename ?? "media"}
                  className="max-h-[70vh] w-auto object-contain"
                />
              ) : null}
            </div>

            {previewMedia.browserUnsafe ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.08)] px-3 py-2 text-xs font-semibold text-[#f59e0b]">
                {t("projectDetail.mediaBrowserUnsafe")}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <a
                href={previewMedia.signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "rgba(191, 162, 52, 0.4)", color: "var(--brand-yellow)" }}
              >
                <ExternalLink size={12} />
                {t("messages.openFile")}
              </a>
              <button
                type="button"
                onClick={() => void downloadProjectMediaItem(previewMedia.item)}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
              >
                <Download size={12} />
                {t("messages.downloadFile")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewLoading && !previewMedia ? (
        // Click-anywhere dismiss is a hard floor: if a future code path
        // fails to clear `previewLoading`, the manager can still escape
        // the overlay by tapping it. Belt-and-braces against the
        // "stuck on Loading" report. Inline numeric z-index sidesteps
        // any Tailwind arbitrary-value compile gap under Turbopack.
        <div
          className="fixed inset-0 flex items-center justify-center p-4 text-sm font-semibold text-white"
          style={{ background: "rgba(0,0,0,0.7)", zIndex: 990 }}
          onClick={closePreview}
        >
          {t("common.loading")}
        </div>
      ) : null}

      {previewError && !previewMedia ? (
        <div
          className="pointer-events-none fixed inset-x-0 top-4 flex justify-center"
          style={{ zIndex: 1010 }}
        >
          <div className="rounded-[var(--radius-md)] bg-[rgba(212,81,94,0.14)] px-3 py-2 text-xs font-semibold text-[var(--red)]">
            {previewError}
          </div>
        </div>
      ) : null}

      {showEditModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={closeEditModal}
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
                <div className="flex items-stretch gap-2">
                  <input
                    ref={editLatRef}
                    name="lat"
                    type="number"
                    step="0.000001"
                    min={-90}
                    max={90}
                    inputMode="decimal"
                    required={!project.hasValidSiteCoordinates}
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
                  type="number"
                  step="0.000001"
                  min={-180}
                  max={180}
                  inputMode="decimal"
                  required={!project.hasValidSiteCoordinates}
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
                {t("projects.deviceLocationHint")}
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
                  required
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
        </div>
      ) : null}
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
    <section id="materials" className="surface-card scroll-mt-4 p-4">
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

    // Receipt photo + amount remain mandatory. Store became optional —
    // many small purchases don't have a clean store identity (street
    // vendor, multi-stop trip, etc.). Empty store is stored as null.
    if (!amount) return;

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
