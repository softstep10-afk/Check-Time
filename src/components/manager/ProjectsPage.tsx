"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Copy, Check, Plus, Pencil, Trash2, X, FileText, Play } from "lucide-react";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import {
  GpsRadiusSlider,
  GPS_RADIUS_DEFAULT,
  clampRadius,
} from "@/components/manager/GpsRadiusSlider";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  assessDeviceLocationAccuracy,
  type DeviceLocationAssessment,
  formatDurationCompact,
  isValidGeoPoint,
  parseCoordinateInputPair,
} from "@/lib/worker-utils";
import type { ProjectAddressGeocodeResult } from "@/lib/project-geocoding";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import { normalizeStoragePath } from "@/lib/task-attachments";
import {
  deriveProjectScheduleHealth,
  formatProjectCountdown,
  projectScheduleToneStyle,
} from "@/lib/project-schedule";
import type {
  ProjectBudgetStatus,
  ProjectStatus,
  ProjectTimelineStatus,
} from "@/types/database";

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

type ActivityState = "live" | "open" | "stale" | "inactive";
type ClientTone = "green" | "yellow" | "red";

function activityState(project: ManagerProjectSummary): ActivityState {
  if (project.status !== "active") return "inactive";
  if (project.onSiteWorkerCount > 0) return "live";
  if (!project.lastActivityTime) return "stale";
  const ageMs = Date.now() - new Date(project.lastActivityTime).getTime();
  return ageMs > STALE_THRESHOLD_MS ? "stale" : "open";
}

const TIMELINE_COLOR: Record<ProjectTimelineStatus, string> = {
  on_track: "#84cc16",
  at_risk: "#f59e0b",
  delayed: "#ef4444",
};

const BUDGET_COLOR: Record<ProjectBudgetStatus, string> = {
  on_budget: "#84cc16",
  over_budget: "#f59e0b",
  critical: "#ef4444",
};

const TIMELINE_NEXT: Record<ProjectTimelineStatus, ProjectTimelineStatus> = {
  on_track: "at_risk",
  at_risk: "delayed",
  delayed: "on_track",
};

const BUDGET_NEXT: Record<ProjectBudgetStatus, ProjectBudgetStatus> = {
  on_budget: "over_budget",
  over_budget: "critical",
  critical: "on_budget",
};

const CLIENT_TONE_COLOR: Record<ClientTone, string> = {
  green: "#0fa878",
  yellow: "#f59e0b",
  red: "#ef4444",
};

const CLIENT_TONE_NEXT: Record<ClientTone, ClientTone> = {
  green: "yellow",
  yellow: "red",
  red: "green",
};

type TFn = (key: import("@/lib/i18n").TranslationKey) => string;

type AddressLookupState = ProjectAddressGeocodeResult & {
  requestedAddress: string;
};

function timelineLabel(t: TFn, status: string | null): string {
  if (status === "at_risk") return t("projects.timeline.at_risk");
  if (status === "delayed") return t("projects.timeline.delayed");
  return t("projects.timeline.on_track");
}

function budgetLabel(t: TFn, status: string | null): string {
  if (status === "over_budget") return t("projects.budget.over_budget");
  if (status === "critical") return t("projects.budget.critical");
  return t("projects.budget.on_budget");
}

function getClientTone(project: ManagerProjectSummary): ClientTone {
  const value = project.settings?.client_tone;
  if (value === "yellow" || value === "red" || value === "green") return value;
  return "green";
}

function clientToneLabel(locale: "en" | "ru", tone: ClientTone): string {
  if (locale === "ru") {
    if (tone === "green") return "Клиент: лояльный";
    if (tone === "yellow") return "Клиент: средний";
    return "Клиент: сложный";
  }

  if (tone === "green") return "Client: loyal";
  if (tone === "yellow") return "Client: medium";
  return "Client: sensitive";
}

function scheduleHealthLabel(
  locale: "en" | "ru",
  state: ReturnType<typeof deriveProjectScheduleHealth>["state"],
): string {
  if (locale === "ru") {
    if (state === "not_started") return "ещё не стартовал";
    if (state === "half_elapsed") return "прошли 50%";
    if (state === "almost_due") return "осталось 10%";
    if (state === "overdue") return "просрочен";
    return "в графике";
  }

  if (state === "not_started") return "not started";
  if (state === "half_elapsed") return "past 50%";
  if (state === "almost_due") return "last 10%";
  if (state === "overdue") return "overdue";
  return "on track";
}

function indicatorFieldLabel(locale: "en" | "ru", key: "client" | "timeline" | "budget"): string {
  if (locale === "ru") {
    if (key === "client") return "Клиент";
    if (key === "timeline") return "План";
    return "Бюджет";
  }

  if (key === "client") return "Client";
  if (key === "timeline") return "Plan";
  return "Budget";
}

function indicatorChoiceLabel(locale: "en" | "ru", color: ClientTone): string {
  if (locale === "ru") {
    if (color === "green") return "Зелёный";
    if (color === "yellow") return "Жёлтый";
    return "Красный";
  }

  if (color === "green") return "Green";
  if (color === "yellow") return "Yellow";
  return "Red";
}

function IndicatorSelects({
  locale,
  clientTone,
  timelineStatus,
  budgetStatus,
}: {
  locale: "en" | "ru";
  clientTone: ClientTone;
  timelineStatus: ProjectTimelineStatus;
  budgetStatus: ProjectBudgetStatus;
}) {
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.2)] p-3 sm:grid-cols-3">
      <label className="grid gap-1 text-xs text-[var(--text-muted)]">
        <span className="uppercase tracking-[0.14em]">{indicatorFieldLabel(locale, "client")}</span>
        <select
          name="client_tone"
          defaultValue={clientTone}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          <option value="green">{indicatorChoiceLabel(locale, "green")}</option>
          <option value="yellow">{indicatorChoiceLabel(locale, "yellow")}</option>
          <option value="red">{indicatorChoiceLabel(locale, "red")}</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--text-muted)]">
        <span className="uppercase tracking-[0.14em]">{indicatorFieldLabel(locale, "timeline")}</span>
        <select
          name="timeline_status"
          defaultValue={timelineStatus}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          <option value="on_track">{indicatorChoiceLabel(locale, "green")}</option>
          <option value="at_risk">{indicatorChoiceLabel(locale, "yellow")}</option>
          <option value="delayed">{indicatorChoiceLabel(locale, "red")}</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-[var(--text-muted)]">
        <span className="uppercase tracking-[0.14em]">{indicatorFieldLabel(locale, "budget")}</span>
        <select
          name="budget_status"
          defaultValue={budgetStatus}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        >
          <option value="on_budget">{indicatorChoiceLabel(locale, "green")}</option>
          <option value="over_budget">{indicatorChoiceLabel(locale, "yellow")}</option>
          <option value="critical">{indicatorChoiceLabel(locale, "red")}</option>
        </select>
      </label>
    </div>
  );
}

function TrafficLights({
  clientTone,
  timeline,
  budget,
  onClientToneClick,
  onTimelineClick,
  onBudgetClick,
  clientToneLabel,
  timelineLabel,
  budgetLabel,
}: {
  clientTone: ClientTone;
  timeline: ProjectTimelineStatus;
  budget: ProjectBudgetStatus;
  onClientToneClick: () => void;
  onTimelineClick: () => void;
  onBudgetClick: () => void;
  clientToneLabel: string;
  timelineLabel: string;
  budgetLabel: string;
}) {
  const dotClass = "inline-block h-3.5 w-3.5 cursor-pointer rounded-full border-0 p-0";
  const glow = (color: string) => `0 0 0 2px rgba(255,255,255,0.16), 0 0 12px ${color}`;

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClientToneClick();
        }}
        title={clientToneLabel}
        aria-label={clientToneLabel}
        className={dotClass}
        style={{
          background: CLIENT_TONE_COLOR[clientTone],
          boxShadow: glow(CLIENT_TONE_COLOR[clientTone]),
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTimelineClick();
        }}
        title={timelineLabel}
        aria-label={timelineLabel}
        className={dotClass}
        style={{
          background: TIMELINE_COLOR[timeline],
          boxShadow: glow(TIMELINE_COLOR[timeline]),
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBudgetClick();
        }}
        title={budgetLabel}
        aria-label={budgetLabel}
        className={dotClass}
        style={{
          background: BUDGET_COLOR[budget],
          boxShadow: glow(BUDGET_COLOR[budget]),
        }}
      />
    </div>
  );
}

function useThumbnailUrl(storagePath: string): string | null {
  const supabase = useMemo(() => createClient(), []);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const normalized = normalizeStoragePath(storagePath);
      const { data } = await supabase.storage
        .from("media")
        .createSignedUrl(normalized, 3600);
      if (!cancelled) setUrl(data?.signedUrl ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, storagePath]);
  return url;
}

function ProjectThumb({
  item,
  onClick,
}: {
  item: ManagerProjectSummary["recentMedia"][number];
  onClick: (e: React.MouseEvent) => void;
}) {
  const isPhoto = item.media_type === "photo";
  const isVideo = item.media_type === "video";
  const url = useThumbnailUrl(isPhoto ? item.storage_path : "");
  return (
    <button
      type="button"
      onClick={onClick}
      title={item.filename ?? item.media_type}
      aria-label={item.filename ?? item.media_type}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border"
      style={{
        borderColor: "var(--border-default)",
        background: isPhoto && url ? "transparent" : "rgba(15, 17, 23, 0.9)",
        color: "var(--text-muted)",
      }}
    >
      {isPhoto ? (
        url ? (
          // Signed URL is time-limited; plain <img> lazy-loaded is correct
          // here — next/image would require a loader + domain allowlist.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={item.filename ?? "thumbnail"}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full animate-pulse" style={{ background: "rgba(148, 163, 184, 0.12)" }} />
        )
      ) : isVideo ? (
        <Play size={16} style={{ color: "white" }} />
      ) : (
        <FileText size={16} style={{ color: "white" }} />
      )}
    </button>
  );
}

function ProjectThumbStrip({
  projectId,
  items,
  total,
}: {
  projectId: string;
  items: ManagerProjectSummary["recentMedia"];
  total: number;
}) {
  const router = useRouter();
  const visible = items.slice(0, 6);
  const overflow = Math.max(0, total - visible.length);
  function goToProject(e: React.MouseEvent) {
    e.stopPropagation();
    router.push(`/projects/${projectId}`);
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
      {visible.map((item) => (
        <ProjectThumb key={item.id} item={item} onClick={goToProject} />
      ))}
      {overflow > 0 ? (
        <button
          type="button"
          onClick={goToProject}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border text-[10px] font-semibold"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--text-muted)",
            background: "rgba(15, 17, 23, 0.9)",
          }}
        >
          +{overflow}
        </button>
      ) : null}
    </div>
  );
}

function InlineNotesEditor({
  projectId,
  initialNotes,
  placeholder,
}: {
  projectId: string;
  initialNotes: string | null;
  placeholder: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [notes, setNotes] = useState<string>(initialNotes ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(notes);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hide the "Saved ✓" flash after 2s without parking a timer in state.
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(null), 2000);
    return () => clearTimeout(id);
  }, [savedAt]);

  // Sync with the initial prop — if the card re-renders from a server
  // refresh with a newer value, pick it up unless the user is actively
  // editing. Deferred so the setState doesn't fire synchronously inside
  // the effect body.
  useEffect(() => {
    if (editing) return;
    const id = setTimeout(() => setNotes(initialNotes ?? ""), 0);
    return () => clearTimeout(id);
  }, [initialNotes, editing]);

  function openEditor(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(notes);
    setEditing(true);
    // Focus after the textarea mounts.
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function commit(next: string) {
    setEditing(false);
    if (next === notes) return;
    const previous = notes;
    setNotes(next); // optimistic
    const { error } = await supabase
      .from("projects")
      .update({ notes: next || null })
      .eq("id", projectId);
    if (error) {
      // Roll back on failure so the UI doesn't drift from the DB.
      setNotes(previous);
      console.warn("notes save failed:", error.message);
      return;
    }
    setSavedAt(Date.now());
  }

  const preview = notes
    ? notes.length > 80
      ? notes.slice(0, 80) + "…"
      : notes
    : null;

  if (editing) {
    return (
      <div onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(notes);
            }
          }}
          placeholder={placeholder}
          className="min-h-[60px] w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={openEditor}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setDraft(notes);
          setEditing(true);
          setTimeout(() => textareaRef.current?.focus(), 0);
        }
      }}
      className="cursor-text text-xs italic"
      style={{ color: preview ? "var(--text-secondary)" : "var(--text-muted)" }}
    >
      {preview ?? placeholder}
      {savedAt ? (
        <span className="ml-2 not-italic" style={{ color: "var(--green)" }}>
          ✓ saved
        </span>
      ) : null}
    </div>
  );
}

function CopyAddressButton({ address }: { address: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        navigator.clipboard
          .writeText(address)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{
        background: copied ? "rgba(15, 168, 120, 0.16)" : "rgba(191, 162, 52, 0.12)",
        color: copied ? "var(--green)" : "var(--brand-yellow)",
      }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? t("projects.copied") : t("projects.copyAddress")}
    </button>
  );
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// 00008_project_gps_radius.sql may not be applied yet — strip the column
// from the payload and retry once if Postgres rejects it.
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

function setInputElementValue(
  input: HTMLInputElement | null,
  value: string,
) {
  if (!input) {
    return;
  }

  input.value = value;
}

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
  initialProjects,
  hasFinanceAccess,
}: {
  initialProjects: ManagerProjectSummary[];
  hasFinanceAccess: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { t, locale } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
  const [geocodingTarget, setGeocodingTarget] = useState<"create" | "edit" | null>(null);
  const [reverseLookupTarget, setReverseLookupTarget] = useState<"create" | "edit" | null>(null);
  const [createCoordinatesConfirmed, setCreateCoordinatesConfirmed] = useState(false);
  const [editCoordinatesConfirmed, setEditCoordinatesConfirmed] = useState(false);
  const [createDeviceLocation, setCreateDeviceLocation] = useState<DeviceLocationAssessment | null>(null);
  const [editDeviceLocation, setEditDeviceLocation] = useState<DeviceLocationAssessment | null>(null);
  const [createAddressLookup, setCreateAddressLookup] = useState<AddressLookupState | null>(null);
  const [editAddressLookup, setEditAddressLookup] = useState<AddressLookupState | null>(null);
  const [createAddressLookupError, setCreateAddressLookupError] = useState("");
  const [editAddressLookupError, setEditAddressLookupError] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused" | "completed">("active");
  const [sortBy, setSortBy] = useState<"activity" | "name" | "week" | "cost">("activity");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Debounce the live search 300ms so typing doesn't thrash the filter.
  useEffect(() => {
    const id = setTimeout(() => setSearchQuery(searchInput.trim().toLowerCase()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  const visibleProjects = useMemo(() => {
    let list = initialProjects;
    if (statusFilter !== "all") list = list.filter((p) => p.status === statusFilter);
    if (searchQuery) {
      list = list.filter((p) => {
        return (
          p.name.toLowerCase().includes(searchQuery) ||
          (p.address ?? "").toLowerCase().includes(searchQuery)
        );
      });
    }
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "week") {
      sorted.sort((a, b) => b.weekMinutes - a.weekMinutes);
    } else if (sortBy === "cost" && hasFinanceAccess) {
      sorted.sort((a, b) => b.receiptTotal - a.receiptTotal);
    } else {
      // activity: live (on-site now) first, then most-recent, then stale.
      sorted.sort((a, b) => {
        const aScore =
          a.onSiteWorkerCount > 0 ? 2 : a.lastActivityTime ? 1 : 0;
        const bScore =
          b.onSiteWorkerCount > 0 ? 2 : b.lastActivityTime ? 1 : 0;
        if (aScore !== bScore) return bScore - aScore;
        if (a.lastActivityTime && b.lastActivityTime) {
          return (
            new Date(b.lastActivityTime).getTime() -
            new Date(a.lastActivityTime).getTime()
          );
        }
        return a.name.localeCompare(b.name);
      });
    }
    return sorted;
  }, [initialProjects, statusFilter, sortBy, searchQuery, hasFinanceAccess]);
  const projectsMissingCoordinatesCount = useMemo(() => {
    return initialProjects.filter((project) => !project.hasValidSiteCoordinates).length;
  }, [initialProjects]);
  const createFormRef = useRef<HTMLFormElement>(null);
  const createLatRef = useRef<HTMLInputElement>(null);
  const createLngRef = useRef<HTMLInputElement>(null);
  const editFormRef = useRef<HTMLFormElement>(null);
  const editLatRef = useRef<HTMLInputElement>(null);
  const editLngRef = useRef<HTMLInputElement>(null);
  const editingProject =
    initialProjects.find((p) => p.id === editingProjectId) ?? null;
  const editingSite = editingProject?.siteCoordinates ?? null;

  function openCreateProjectPanel() {
    setCreateCoordinatesConfirmed(false);
    setCreateDeviceLocation(null);
    setCreateAddressLookup(null);
    setCreateAddressLookupError("");
    setShowCreatePanel(true);
  }

  function closeCreateProjectPanel() {
    setShowCreatePanel(false);
    setCreateCoordinatesConfirmed(false);
    setCreateDeviceLocation(null);
    setCreateAddressLookup(null);
    setCreateAddressLookupError("");
    setGeocodingTarget((current) => (current === "create" ? null : current));
  }

  function toggleCreateProjectPanel() {
    if (showCreatePanel) {
      closeCreateProjectPanel();
      return;
    }

    openCreateProjectPanel();
  }

  function openEditProject(projectId: string) {
    setEditCoordinatesConfirmed(false);
    setEditDeviceLocation(null);
    setEditAddressLookup(null);
    setEditAddressLookupError("");
    setEditingProjectId(projectId);
  }

  function closeEditProject() {
    setEditingProjectId(null);
    setEditCoordinatesConfirmed(false);
    setEditDeviceLocation(null);
    setEditAddressLookup(null);
    setEditAddressLookupError("");
    setGeocodingTarget((current) => (current === "edit" ? null : current));
  }

  function fillCurrentLocation(
    targetLatRef: React.RefObject<HTMLInputElement | null>,
    targetLngRef: React.RefObject<HTMLInputElement | null>,
    setDeviceLocation: Dispatch<SetStateAction<DeviceLocationAssessment | null>>,
    clearConfirmation: () => void,
    clearAddressLookup: () => void,
    clearAddressLookupError: () => void,
  ) {
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
        if (targetLatRef.current) {
          targetLatRef.current.value = point.lat.toFixed(6);
        }
        if (targetLngRef.current) {
          targetLngRef.current.value = point.lng.toFixed(6);
        }
        setDeviceLocation(assessment);
        clearConfirmation();
        clearAddressLookup();
        clearAddressLookupError();
        setMessage(assessment.shouldWarn ? t("projects.deviceLocationAccuracyWarning") : "");
        setPickingLocation(false);
      },
      (err: GeolocationPositionError) => {
        // Route to a code-specific message so "I didn't get a fix in time"
        // doesn't surface as "you denied permission". Previously every
        // failure landed on the same locationDenied banner.
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
      // 20s timeout (was 10s) — desktop browsers without GPS hardware fall
      // back to Wi-Fi triangulation which routinely takes 10–15s on first
      // call. maximumAge bumped too so a fresh tab-open isn't penalized.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  function fillAddressFromDeviceLocation(
    mode: "create" | "edit",
    formRef: React.RefObject<HTMLFormElement | null>,
    targetLatRef: React.RefObject<HTMLInputElement | null>,
    targetLngRef: React.RefObject<HTMLInputElement | null>,
    setDeviceLocation: Dispatch<SetStateAction<DeviceLocationAssessment | null>>,
    clearConfirmation: () => void,
  ) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(t("projects.locationUnavailable"));
      return;
    }
    setReverseLookupTarget(mode);
    setMessage("");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        if (!isValidGeoPoint(point)) {
          setReverseLookupTarget(null);
          setMessage(t("projects.locationInvalid"));
          return;
        }
        setInputElementValue(targetLatRef.current, point.lat.toFixed(6));
        setInputElementValue(targetLngRef.current, point.lng.toFixed(6));
        setDeviceLocation(assessDeviceLocationAccuracy(position.coords.accuracy));
        clearConfirmation();
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
            const form = formRef.current;
            const addressEl = form?.elements.namedItem("address");
            if (addressEl instanceof HTMLInputElement) {
              addressEl.value = formatted;
            }
          }
        } catch (err) {
          setMessage(err instanceof Error ? err.message : t("projects.locationUnavailable"));
        } finally {
          setReverseLookupTarget(null);
        }
      },
      (err: GeolocationPositionError) => {
        const key =
          err.code === err.PERMISSION_DENIED
            ? "projects.locationDenied"
            : err.code === err.TIMEOUT
              ? "projects.locationTimeout"
              : "projects.locationUnavailable";
        setReverseLookupTarget(null);
        setMessage(t(key));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }

  async function fillCoordinatesFromAddress(
    mode: "create" | "edit",
    formRef: React.RefObject<HTMLFormElement | null>,
    targetLatRef: React.RefObject<HTMLInputElement | null>,
    targetLngRef: React.RefObject<HTMLInputElement | null>,
    setDeviceLocation: Dispatch<SetStateAction<DeviceLocationAssessment | null>>,
    clearConfirmation: () => void,
    setAddressLookup: Dispatch<SetStateAction<AddressLookupState | null>>,
    setAddressLookupError: Dispatch<SetStateAction<string>>,
  ) {
    const form = formRef.current;
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

    setGeocodingTarget(mode);
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

      setInputElementValue(targetLatRef.current, point.lat.toFixed(6));
      setInputElementValue(targetLngRef.current, point.lng.toFixed(6));
      setDeviceLocation(null);
      clearConfirmation();
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
      setGeocodingTarget(null);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = formData.get("name")?.toString().trim() ?? "";
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = hasFinanceAccess
      ? Number.parseFloat(formData.get("rate")?.toString() ?? "0")
      : null;
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? "200", 10);
    const gpsRadius = clampRadius(
      Number.parseInt(formData.get("gps_radius_m")?.toString() ?? `${GPS_RADIUS_DEFAULT}`, 10),
    );
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";
    const clientTone = formData.get("client_tone")?.toString() ?? "green";
    const timelineStatus = formData.get("timeline_status")?.toString() ?? "on_track";
    const budgetStatus = formData.get("budget_status")?.toString() ?? "on_budget";

    if (!name) {
      setMessage(t("projects.nameRequired"));
      return;
    }

    // Coordinates are now required: without them the worker-side
    // geofence has nothing to check against and anyone can clock in
    // from anywhere on this project. Refuse the insert before it
    // reaches Supabase rather than saving a site_point: null row.
    const coordinates = parseCoordinateInputPair(formData.get("lat"), formData.get("lng"));
    if (coordinates.error) {
      setMessage(
        coordinates.error === "invalid"
          ? t("projects.locationInvalid")
          : t("projects.coordsRequired"),
      );
      form.reportValidity();
      return;
    }
    if (!coordinates.point) {
      setMessage(t("projects.coordsRequired"));
      form.reportValidity();
      return;
    }
    if (!createCoordinatesConfirmed) {
      setMessage(t("projects.coordsConfirmationRequired"));
      form.reportValidity();
      return;
    }

    setBusyKey("create");
    setMessage("");

    const response = await fetch("/api/manager/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: address || null,
        notes: notes || null,
        ...(hasFinanceAccess
          ? { rate: typeof rate === "number" && Number.isFinite(rate) ? rate : 25 }
          : {}),
        radius_m: Number.isFinite(radius) ? radius : 200,
        gps_radius_m: gpsRadius,
        lat: coordinates.point.lat,
        lng: coordinates.point.lng,
        coordinatesConfirmed: createCoordinatesConfirmed,
        start_date: startDate || null,
        end_date: endDate || null,
        client_tone: clientTone,
        timeline_status: timelineStatus,
        budget_status: budgetStatus,
      }),
    });

    if (!response.ok) {
      setMessage(await readRouteError(response));
      setBusyKey(null);
      return;
    }

    form.reset();
    setBusyKey(null);
    closeCreateProjectPanel();
    setMessage(t("projects.created"));
    router.refresh();
  }

  async function handleUpdateProject(
    event: React.FormEvent<HTMLFormElement>,
    projectId: string,
  ) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const existingProject = initialProjects.find((project) => project.id === projectId) ?? null;
    const name = formData.get("name")?.toString().trim() ?? "";
    const address = formData.get("address")?.toString().trim() ?? "";
    const notes = formData.get("notes")?.toString().trim() ?? "";
    const rate = hasFinanceAccess
      ? Number.parseFloat(formData.get("rate")?.toString() ?? "0")
      : null;
    const radius = Number.parseInt(formData.get("radius_m")?.toString() ?? "200", 10);
    const gpsRadius = clampRadius(
      Number.parseInt(formData.get("gps_radius_m")?.toString() ?? `${GPS_RADIUS_DEFAULT}`, 10),
    );
    const status = (formData.get("status")?.toString() ?? "active") as ProjectStatus;
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";
    const clientTone = formData.get("client_tone")?.toString() ?? (existingProject ? getClientTone(existingProject) : "green");
    const timelineStatus = formData.get("timeline_status")?.toString() ?? existingProject?.timeline_status ?? "on_track";
    const budgetStatus = formData.get("budget_status")?.toString() ?? existingProject?.budget_status ?? "on_budget";

    if (!name) {
      setMessage(t("projects.nameRequired"));
      return;
    }

    const coordinates = parseCoordinateInputPair(formData.get("lat"), formData.get("lng"), {
      allowBlank: existingProject?.hasValidSiteCoordinates ?? true,
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
    if (!editCoordinatesConfirmed) {
      setMessage(t("projects.coordsConfirmationRequired"));
      event.currentTarget.reportValidity();
      return;
    }

    setBusyKey(`update-${projectId}`);
    setMessage("");

    const response = await fetch(`/api/manager/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address: address || null,
        notes: notes || null,
        ...(hasFinanceAccess
          ? { rate: typeof rate === "number" && Number.isFinite(rate) ? rate : 25 }
          : {}),
        radius_m: Number.isFinite(radius) ? radius : 200,
        gps_radius_m: gpsRadius,
        status,
        lat: coordinates.point?.lat ?? null,
        lng: coordinates.point?.lng ?? null,
        coordinatesConfirmed: editCoordinatesConfirmed,
        start_date: startDate || null,
        end_date: endDate || null,
        client_tone: clientTone,
        timeline_status: timelineStatus,
        budget_status: budgetStatus,
      }),
    });

    if (!response.ok) {
      setMessage(await readRouteError(response));
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    closeEditProject();
    setMessage(t("projects.updated"));
    router.refresh();
  }

  async function handleCycleTimeline(project: ManagerProjectSummary) {
    const current = (project.timeline_status ?? "on_track") as ProjectTimelineStatus;
    const next = TIMELINE_NEXT[current];
    const { error } = await supabase
      .from("projects")
      .update({ timeline_status: next })
      .eq("id", project.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.refresh();
  }

  async function handleCycleClientTone(project: ManagerProjectSummary) {
    const current = getClientTone(project);
    const next = CLIENT_TONE_NEXT[current];
    const { error } = await supabase
      .from("projects")
      .update({
        settings: {
          ...(project.settings ?? {}),
          client_tone: next,
        },
      })
      .eq("id", project.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.refresh();
  }

  async function handleCycleBudget(project: ManagerProjectSummary) {
    const current = (project.budget_status ?? "on_budget") as ProjectBudgetStatus;
    const next = BUDGET_NEXT[current];
    const { error } = await supabase
      .from("projects")
      .update({ budget_status: next })
      .eq("id", project.id);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.refresh();
  }

  async function handleArchiveProject(projectId: string) {
    setBusyKey(`archive-${projectId}`);
    setMessage("");

    const response = await fetch(`/api/manager/projects/${projectId}/archive`, {
      method: "POST",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      const errorMessage =
        payload && typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : `Request failed (${response.status})`;
      setMessage(errorMessage);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projects.archived"));
    router.refresh();
  }

  async function handleDeleteProject(projectId: string) {
    setBusyKey(`delete-${projectId}`);
    setMessage("");

    const response = await fetch(`/api/manager/projects/${projectId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: unknown }
        | null;
      const errorMessage =
        payload && typeof payload.error === "string" && payload.error.trim()
          ? payload.error
          : `Request failed (${response.status})`;
      setMessage(errorMessage);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setMessage(t("projects.deleted"));
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

      {projectsMissingCoordinatesCount > 0 ? (
        <section
          className="rounded-[var(--radius-lg)] border px-4 py-3"
          style={{
            borderColor: "rgba(245, 158, 11, 0.35)",
            background: "rgba(245, 158, 11, 0.08)",
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
              style={{
                background: "rgba(15, 17, 23, 0.4)",
                color: "var(--brand-yellow)",
              }}
            >
              {t("projects.gpsMissingBadge")}
            </span>
            <div className="text-sm font-semibold text-[var(--text-primary)]">
              {t("projects.gpsMissingSummary").replace(
                "{count}",
                String(projectsMissingCoordinatesCount),
              )}
            </div>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t("projects.fixCoordinatesHint")}
          </p>
        </section>
      ) : null}

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projects.createProject")}</h2>
          <button
            type="button"
            onClick={toggleCreateProjectPanel}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
            style={{
              background: showCreatePanel ? "transparent" : "var(--brand-yellow)",
              color: showCreatePanel ? "var(--text-primary)" : "var(--text-inverse)",
              border: showCreatePanel ? "1px solid var(--border-default)" : "none",
            }}
          >
            {showCreatePanel ? (
              <>
                <X size={14} /> {t("common.cancel")}
              </>
            ) : (
              <>
                <Plus size={14} /> {t("projects.addProject")}
              </>
            )}
          </button>
        </div>
        {showCreatePanel ? (
        <form
          ref={createFormRef}
          className="mt-4 grid gap-3 md:grid-cols-2"
          onSubmit={handleCreateProject}
        >
          <TextInputWithVoice
            name="name"
            placeholder={t("projects.projectName")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.2)] p-3">
            <TextInputWithVoice
              name="address"
              placeholder={t("common.address")}
              onChange={() => {
                setCreateAddressLookup(null);
                setCreateAddressLookupError("");
                setCreateCoordinatesConfirmed(false);
              }}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  fillAddressFromDeviceLocation(
                    "create",
                    createFormRef,
                    createLatRef,
                    createLngRef,
                    setCreateDeviceLocation,
                    () => setCreateCoordinatesConfirmed(false),
                  )
                }
                disabled={reverseLookupTarget === "create"}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
              >
                {reverseLookupTarget === "create"
                  ? t("projects.findingLocationAsAddress")
                  : t("projects.useLocationAsAddress")}
              </button>
            </div>
            {createAddressLookupError ? (
              <div
                className="mt-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm"
                style={{
                  borderColor: "rgba(212, 81, 94, 0.35)",
                  background: "rgba(212, 81, 94, 0.08)",
                  color: "var(--red)",
                }}
              >
                {createAddressLookupError}
              </div>
            ) : null}
            {createAddressLookup ? (
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
                  {createAddressLookup.formattedAddress ?? createAddressLookup.requestedAddress}
                </div>
                <div className="mt-2 text-[var(--text-secondary)]">
                  {t("projects.latitude")}: {createAddressLookup.lat.toFixed(6)} · {t("projects.longitude")}:{" "}
                  {createAddressLookup.lng.toFixed(6)}
                </div>
              </div>
            ) : null}
          </div>
          {hasFinanceAccess ? (
            <input
              name="rate"
              type="number"
              step="0.01"
              placeholder={t("projects.hourlyRate")}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
          ) : null}
          <input
            name="radius_m"
            type="number"
            placeholder={t("projects.gpsRadius")}
            defaultValue="200"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <GpsRadiusSlider />
          </div>
          <div className="flex items-stretch gap-2">
            <input
              ref={createLatRef}
              name="lat"
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              inputMode="decimal"
              required
              onChange={() => {
                setCreateCoordinatesConfirmed(false);
                setCreateDeviceLocation(null);
                setCreateAddressLookup(null);
                setCreateAddressLookupError("");
              }}
              placeholder={t("projects.latitude")}
              className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="button"
              onClick={() =>
                fillCurrentLocation(
                  createLatRef,
                  createLngRef,
                  setCreateDeviceLocation,
                  () => setCreateCoordinatesConfirmed(false),
                  () => setCreateAddressLookup(null),
                  () => setCreateAddressLookupError(""),
                )
              }
              disabled={pickingLocation}
              title={t("projects.useCurrentLocation")}
              aria-label={t("projects.useCurrentLocation")}
              className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border px-3 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
            >
              {pickingLocation ? "..." : t("projects.useCurrentLocation")}
            </button>
          </div>
          <input
            ref={createLngRef}
            name="lng"
            type="number"
            step="0.000001"
            min={-180}
            max={180}
            inputMode="decimal"
            required
            onChange={() => {
              setCreateCoordinatesConfirmed(false);
              setCreateDeviceLocation(null);
              setCreateAddressLookup(null);
              setCreateAddressLookupError("");
            }}
            placeholder={t("projects.longitude")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <p className="md:col-span-2 text-xs text-[var(--text-muted)]">
            {t("projects.deviceLocationHint")}
          </p>
          {createDeviceLocation ? (
            <div
              className="md:col-span-2 rounded-[var(--radius-md)] border px-3 py-3 text-xs"
              style={{
                borderColor: createDeviceLocation.shouldWarn
                  ? "rgba(245, 158, 11, 0.35)"
                  : "var(--border-default)",
                background: createDeviceLocation.shouldWarn
                  ? "rgba(245, 158, 11, 0.08)"
                  : "rgba(15, 17, 23, 0.24)",
              }}
            >
              <div className="font-semibold text-[var(--text-primary)]">
                {createDeviceLocation.accuracyMeters !== null
                  ? t("projects.deviceLocationAccuracy").replace(
                      "{meters}",
                      String(createDeviceLocation.accuracyMeters),
                    )
                  : t("projects.deviceLocationAccuracyUnavailable")}
              </div>
              {createDeviceLocation.shouldWarn ? (
                <p className="mt-1 font-semibold" style={{ color: "#f59e0b" }}>
                  {t("projects.deviceLocationAccuracyWarning")}
                </p>
              ) : null}
            </div>
          ) : null}
          <label
            className="md:col-span-2 flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm text-[var(--text-secondary)]"
            style={{
              borderColor: createCoordinatesConfirmed
                ? "rgba(15, 168, 120, 0.35)"
                : "rgba(245, 158, 11, 0.35)",
              background: createCoordinatesConfirmed
                ? "rgba(15, 168, 120, 0.08)"
                : "rgba(245, 158, 11, 0.08)",
            }}
          >
            <input
              type="checkbox"
              required
              checked={createCoordinatesConfirmed}
              onChange={(event) => setCreateCoordinatesConfirmed(event.target.checked)}
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
          <DateField
            name="start_date"
            label={t("projects.startDate")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <DateField
            name="end_date"
            label={t("projects.endDate")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <div className="md:col-span-2">
            <IndicatorSelects
              locale={locale}
              clientTone="green"
              timelineStatus="on_track"
              budgetStatus="on_budget"
            />
          </div>
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
        ) : null}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { key: "all", label: t("projects.filterAll") },
              { key: "active", label: t("common.active") },
              { key: "paused", label: t("common.paused") },
              { key: "completed", label: t("common.completed") },
            ] as const
          ).map(({ key, label }) => {
            const selected = statusFilter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                aria-pressed={selected}
                className="rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-semibold"
                style={{
                  borderColor: selected ? "var(--brand-yellow)" : "var(--border-default)",
                  background: selected ? "rgba(191, 162, 52, 0.14)" : "transparent",
                  color: selected ? "var(--brand-yellow)" : "var(--text-secondary)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none"
          aria-label={t("projects.sortBy")}
        >
          <option value="activity">{t("projects.sortActivity")}</option>
          <option value="name">{t("projects.sortName")}</option>
          <option value="week">{t("projects.sortWeek")}</option>
          {hasFinanceAccess ? <option value="cost">{t("projects.sortCost")}</option> : null}
        </select>
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder={t("projects.searchPlaceholder")}
          className="min-w-[180px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] outline-none"
        />
        <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
          {t("projects.shownCount")
            .replace("{shown}", String(visibleProjects.length))
            .replace("{total}", String(initialProjects.length))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {visibleProjects.map((project) => {
          const state = activityState(project);
          const fallbackCardBorder =
            state === "live"
              ? "2px solid var(--green)"
              : state === "stale"
                ? "1px solid var(--red)"
                : "1px solid var(--border-default)";
          const hasSiteCoordinates = project.hasValidSiteCoordinates;
          const scheduleHealth = deriveProjectScheduleHealth({
            startDate: project.start_date,
            endDate: project.end_date,
          });
          const scheduleStyle = projectScheduleToneStyle(scheduleHealth.tone);
          const hasSchedule = Boolean(project.start_date || project.end_date);
          const scheduleLabel = scheduleHealthLabel(locale, scheduleHealth.state);
          const deadlineCountdown = formatProjectCountdown(scheduleHealth, locale);
          const clientTone = getClientTone(project);
          const cardBorder = hasSchedule ? `2px solid ${scheduleStyle.color}` : fallbackCardBorder;
          const cardShadow = hasSchedule
            ? `0 0 0 1px ${scheduleStyle.borderColor}, 0 0 22px ${scheduleStyle.background}`
            : state === "live"
              ? "0 0 0 1px rgba(15, 168, 120, 0.18), 0 0 18px rgba(15, 168, 120, 0.18)"
              : undefined;
          const displayedTimeline = (project.timeline_status ?? "on_track") as ProjectTimelineStatus;
          const displayedTimelineLabel = timelineLabel(t, project.timeline_status);
          const statusPillStyle = hasSchedule
            ? {
                background: scheduleStyle.background,
                color: scheduleStyle.color,
                borderColor: scheduleStyle.borderColor,
              }
            : undefined;

          return (
            <article
              key={project.id}
              className="surface-card p-4"
              style={{ border: cardBorder, boxShadow: cardShadow }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/projects/${project.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/projects/${project.id}`);
                  }
                }}
                className="w-full text-left cursor-pointer space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TrafficLights
                        clientTone={clientTone}
                        timeline={displayedTimeline}
                        budget={(project.budget_status ?? "on_budget") as ProjectBudgetStatus}
                        onClientToneClick={() => void handleCycleClientTone(project)}
                        onTimelineClick={() => void handleCycleTimeline(project)}
                        onBudgetClick={() => void handleCycleBudget(project)}
                        clientToneLabel={clientToneLabel(locale, clientTone)}
                        timelineLabel={displayedTimelineLabel}
                        budgetLabel={budgetLabel(t, project.budget_status)}
                      />
                      <div className="text-base font-semibold text-[var(--text-primary)]">
                        {project.name}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <span className="truncate">{project.address ?? t("common.noAddressSet")}</span>
                      {project.address ? <CopyAddressButton address={project.address} /> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                        style={
                          hasSiteCoordinates
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
                        {hasSiteCoordinates ? t("projects.gpsOkBadge") : t("projects.gpsMissingBadge")}
                      </span>
                      <span className="text-[11px] text-[var(--text-secondary)]">
                        {hasSiteCoordinates ? t("projects.gpsOkHint") : t("projects.noSiteCoords")}
                      </span>
                    </div>
                    {state === "stale" ? (
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--red)" }}>
                        {t("projects.staleNoActivity")}
                      </div>
                    ) : null}
                  </div>
                  <div
                    className="status-pill min-w-[96px] text-center"
                    data-tone={getProjectTone(project.status)}
                    style={statusPillStyle}
                    title={hasSchedule ? `${scheduleLabel} · ${deadlineCountdown}` : project.status}
                  >
                    <div>{project.status}</div>
                    {hasSchedule ? (
                      <div className="mt-0.5 text-[10px] font-black tracking-[0.1em]">
                        {deadlineCountdown}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="metric-panel rounded-[var(--radius-md)] p-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("common.crew")}
                    </div>
                    <div className="mt-1 text-base font-bold text-[var(--text-primary)]">
                      {project.assignedWorkerCount}
                    </div>
                  </div>
                  <div className="metric-panel rounded-[var(--radius-md)] p-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("common.week")}
                    </div>
                    <div className="mt-1 font-mono text-sm font-bold text-[var(--text-primary)]">
                      {formatDurationCompact(project.weekMinutes)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/projects/${project.id}#materials`);
                    }}
                    className="metric-panel rounded-[var(--radius-md)] p-2 text-left"
                    aria-label={`${project.name} ${t("projects.materials")}`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("projects.materials")}
                    </div>
                    <div
                      className="mt-1 font-mono text-sm font-bold"
                      style={{
                        color:
                          hasFinanceAccess && project.receiptTotal > 0
                            ? "var(--brand-yellow)"
                            : "var(--text-muted)",
                      }}
                    >
                      {hasFinanceAccess ? currencyFormatter.format(project.receiptTotal) : "--"}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      router.push(`/projects/${project.id}#tasks`);
                    }}
                    className="metric-panel rounded-[var(--radius-md)] p-2 text-left"
                    aria-label={`${project.name} ${t("common.tasks")}`}
                  >
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("common.tasks")}
                    </div>
                    <div className="mt-1 text-base font-bold text-[var(--text-primary)]">
                      {project.openTaskCount}
                    </div>
                  </button>
                </div>

                <InlineNotesEditor
                  projectId={project.id}
                  initialNotes={project.notes}
                  placeholder={t("projects.noNotesHint")}
                />

                {project.recentMedia.length > 0 ? (
                  <ProjectThumbStrip
                    projectId={project.id}
                    items={project.recentMedia}
                    total={project.recentMediaTotal}
                  />
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={() => router.push(`/projects/${project.id}`)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold" style={{ background: "#f59e0b", color: "#000", border: "none" }}
                >
                  {t("projects.openDetail")}
                </button>
                <button
                  type="button"
                  onClick={() => openEditProject(project.id)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={
                    hasSiteCoordinates
                      ? { borderColor: "#3b82f6", color: "#3b82f6", background: "transparent" }
                      : {
                          borderColor: "#f59e0b",
                          color: "#f59e0b",
                          background: "rgba(245, 158, 11, 0.08)",
                        }
                  }
                >
                  <Pencil size={12} /> {hasSiteCoordinates ? t("common.edit") : t("projects.fixCoordinates")}
                </button>
                <button
                  type="button"
                  onClick={() => setRemoveConfirmId(project.id)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "#ef4444", color: "#ef4444", background: "transparent" }}
                >
                  <Trash2 size={12} /> {t("common.remove")}
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {editingProject ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={closeEditProject}
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
                onClick={closeEditProject}
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
              onSubmit={(event) => void handleUpdateProject(event, editingProject.id)}
            >
              <TextInputWithVoice
                name="name"
                defaultValue={editingProject.name}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.2)] p-3">
                <TextInputWithVoice
                  name="address"
                  defaultValue={editingProject.address ?? ""}
                  placeholder={t("common.address")}
                  onChange={() => {
                    setEditAddressLookup(null);
                    setEditAddressLookupError("");
                    setEditCoordinatesConfirmed(false);
                  }}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      fillAddressFromDeviceLocation(
                        "edit",
                        editFormRef,
                        editLatRef,
                        editLngRef,
                        setEditDeviceLocation,
                        () => setEditCoordinatesConfirmed(false),
                      )
                    }
                    disabled={reverseLookupTarget === "edit"}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
                  >
                    {reverseLookupTarget === "edit"
                      ? t("projects.findingLocationAsAddress")
                      : t("projects.useLocationAsAddress")}
                  </button>
                </div>
                {editAddressLookupError ? (
                  <div
                    className="mt-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm"
                    style={{
                      borderColor: "rgba(212, 81, 94, 0.35)",
                      background: "rgba(212, 81, 94, 0.08)",
                      color: "var(--red)",
                    }}
                  >
                    {editAddressLookupError}
                  </div>
                ) : null}
                {editAddressLookup ? (
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
                      {editAddressLookup.formattedAddress ?? editAddressLookup.requestedAddress}
                    </div>
                    <div className="mt-2 text-[var(--text-secondary)]">
                      {t("projects.latitude")}: {editAddressLookup.lat.toFixed(6)} · {t("projects.longitude")}:{" "}
                      {editAddressLookup.lng.toFixed(6)}
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
                    defaultValue={editingProject.rate}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                ) : null}
                <input
                  name="radius_m"
                  type="number"
                  defaultValue={editingProject.radius_m}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <select
                  name="status"
                  defaultValue={editingProject.status}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                >
                  <option value="active">{t("common.active")}</option>
                  <option value="paused">{t("common.paused")}</option>
                  <option value="completed">{t("common.completed")}</option>
                  <option value="archived">{t("common.archived")}</option>
                </select>
              </div>
              <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
                <GpsRadiusSlider
                  defaultValue={
                    (editingProject as { gps_radius_m?: number | null }).gps_radius_m ??
                    GPS_RADIUS_DEFAULT
                  }
                />
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
                    required={!editingProject.hasValidSiteCoordinates}
                    onChange={() => {
                      setEditCoordinatesConfirmed(false);
                      setEditDeviceLocation(null);
                      setEditAddressLookup(null);
                      setEditAddressLookupError("");
                    }}
                    defaultValue={editingSite?.lat ?? ""}
                    placeholder={t("projects.latitude")}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      fillCurrentLocation(
                        editLatRef,
                        editLngRef,
                        setEditDeviceLocation,
                        () => setEditCoordinatesConfirmed(false),
                        () => setEditAddressLookup(null),
                        () => setEditAddressLookupError(""),
                      )
                    }
                    disabled={pickingLocation}
                    title={t("projects.useCurrentLocation")}
                    aria-label={t("projects.useCurrentLocation")}
                    className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[var(--radius-md)] border px-3 text-xs font-semibold disabled:opacity-50"
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
                  required={!editingProject.hasValidSiteCoordinates}
                  onChange={() => {
                    setEditCoordinatesConfirmed(false);
                    setEditDeviceLocation(null);
                    setEditAddressLookup(null);
                    setEditAddressLookupError("");
                  }}
                  defaultValue={editingSite?.lng ?? ""}
                  placeholder={t("projects.longitude")}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                {t("projects.deviceLocationHint")}
              </p>
              {editDeviceLocation ? (
                <div
                  className="rounded-[var(--radius-md)] border px-3 py-3 text-xs"
                  style={{
                    borderColor: editDeviceLocation.shouldWarn
                      ? "rgba(245, 158, 11, 0.35)"
                      : "var(--border-default)",
                    background: editDeviceLocation.shouldWarn
                      ? "rgba(245, 158, 11, 0.08)"
                      : "rgba(15, 17, 23, 0.24)",
                  }}
                >
                  <div className="font-semibold text-[var(--text-primary)]">
                    {editDeviceLocation.accuracyMeters !== null
                      ? t("projects.deviceLocationAccuracy").replace(
                          "{meters}",
                          String(editDeviceLocation.accuracyMeters),
                        )
                      : t("projects.deviceLocationAccuracyUnavailable")}
                  </div>
                  {editDeviceLocation.shouldWarn ? (
                    <p className="mt-1 font-semibold" style={{ color: "#f59e0b" }}>
                      {t("projects.deviceLocationAccuracyWarning")}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <label
                className="flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm text-[var(--text-secondary)]"
                style={{
                  borderColor: editCoordinatesConfirmed
                    ? "rgba(15, 168, 120, 0.35)"
                    : "rgba(245, 158, 11, 0.35)",
                  background: editCoordinatesConfirmed
                    ? "rgba(15, 168, 120, 0.08)"
                    : "rgba(245, 158, 11, 0.08)",
                }}
              >
                <input
                  type="checkbox"
                  required
                  checked={editCoordinatesConfirmed}
                  onChange={(event) => setEditCoordinatesConfirmed(event.target.checked)}
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
                  defaultValue={editingProject.start_date ?? ""}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
                <DateField
                  name="end_date"
                  label={t("projects.endDate")}
                  defaultValue={editingProject.end_date ?? ""}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
              <IndicatorSelects
                locale={locale}
                clientTone={getClientTone(editingProject)}
                timelineStatus={(editingProject.timeline_status ?? "on_track") as ProjectTimelineStatus}
                budgetStatus={(editingProject.budget_status ?? "on_budget") as ProjectBudgetStatus}
              />
              <TextInputWithVoice
                multiline
                name="notes"
                defaultValue={editingProject.notes ?? ""}
                placeholder={t("projects.managerNotes")}
                className="min-h-[100px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busyKey === `update-${editingProject.id}`}
                  className="button-base button-primary"
                >
                  {busyKey === `update-${editingProject.id}` ? t("common.saving") : t("projects.saveChanges")}
                </button>
                <button
                  type="button"
                  onClick={closeEditProject}
                  className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "#3b82f6", color: "#3b82f6", background: "transparent" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {removeConfirmId ? (() => {
        const removeTarget = initialProjects.find((p) => p.id === removeConfirmId);
        if (!removeTarget) return null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setRemoveConfirmId(null)}
          >
            <div
              className="surface-card w-full max-w-[420px] p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-bold text-[var(--text-primary)]">
                {t("projects.removeConfirmTitle")}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {t("projects.removeConfirmBody").replace("{name}", removeTarget.name)}
              </p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                {t("projects.deletePermanentlyHint")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = removeTarget.id;
                    setRemoveConfirmId(null);
                    void handleArchiveProject(id);
                  }}
                  disabled={busyKey === `archive-${removeTarget.id}`}
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                  style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                >
                  {busyKey === `archive-${removeTarget.id}`
                    ? t("projects.archiving")
                    : t("projects.archive")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const id = removeTarget.id;
                    if (
                      !window.confirm(
                        t("projects.deletePermanentlyHint"),
                      )
                    ) {
                      return;
                    }
                    setRemoveConfirmId(null);
                    void handleDeleteProject(id);
                  }}
                  disabled={busyKey === `delete-${removeTarget.id}`}
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                  style={{ background: "var(--red)", color: "white" }}
                >
                  {busyKey === `delete-${removeTarget.id}`
                    ? t("projects.deleting")
                    : t("projects.deletePermanently")}
                </button>
                <button
                  type="button"
                  onClick={() => setRemoveConfirmId(null)}
                  className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                  style={{ borderColor: "#3b82f6", color: "#3b82f6", background: "transparent" }}
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}
