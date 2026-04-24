"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Check, Plus, Pencil, Trash2, X, FileText, Play } from "lucide-react";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import {
  GpsRadiusSlider,
  GPS_RADIUS_DEFAULT,
  clampRadius,
} from "@/components/manager/GpsRadiusSlider";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  formatDurationCompact,
  parseGeoPoint,
  toSupabasePoint,
} from "@/lib/worker-utils";
import type { ManagerProjectSummary } from "@/lib/manager-types";
import { normalizeStoragePath } from "@/lib/task-attachments";
import type {
  ProjectBudgetStatus,
  ProjectStatus,
  ProjectTimelineStatus,
} from "@/types/database";

const STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

type ActivityState = "live" | "open" | "stale" | "inactive";

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

type TFn = (key: import("@/lib/i18n").TranslationKey) => string;

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

function TrafficLights({
  state,
  timeline,
  budget,
  onTimelineClick,
  onBudgetClick,
  timelineLabel,
  budgetLabel,
}: {
  state: ActivityState;
  timeline: ProjectTimelineStatus;
  budget: ProjectBudgetStatus;
  onTimelineClick: () => void;
  onBudgetClick: () => void;
  timelineLabel: string;
  budgetLabel: string;
}) {
  const isLive = state === "live";
  const dim = "color-mix(in srgb, currentColor 18%, transparent)";

  return (
    <div className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: isLive ? "var(--green)" : dim, color: "var(--green)" }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTimelineClick();
        }}
        title={timelineLabel}
        aria-label={timelineLabel}
        className="inline-block h-2.5 w-2.5 cursor-pointer rounded-full border-0 p-0"
        style={{ background: TIMELINE_COLOR[timeline] }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onBudgetClick();
        }}
        title={budgetLabel}
        aria-label={budgetLabel}
        className="inline-block h-2.5 w-2.5 cursor-pointer rounded-full border-0 p-0"
        style={{ background: BUDGET_COLOR[budget] }}
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
function isMissingColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST204" || error.code === "42703") return true;
  return /column .* gps_radius_m/i.test(error.message ?? "");
}

async function insertProjectTolerant(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
) {
  const first = await supabase.from("projects").insert(payload);
  if (first.error && isMissingColumn(first.error)) {
    const { gps_radius_m: _omit, ...rest } = payload;
    void _omit;
    return supabase.from("projects").insert(rest);
  }
  return first;
}

async function updateProjectTolerant(
  supabase: SupabaseClient,
  projectId: string,
  payload: Record<string, unknown>,
) {
  const first = await supabase.from("projects").update(payload).eq("id", projectId);
  if (first.error && isMissingColumn(first.error)) {
    const { gps_radius_m: _omit, ...rest } = payload;
    void _omit;
    return supabase.from("projects").update(rest).eq("id", projectId);
  }
  return first;
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
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [pickingLocation, setPickingLocation] = useState(false);
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
    } else if (sortBy === "cost") {
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
  }, [initialProjects, statusFilter, sortBy, searchQuery]);
  const createLatRef = useRef<HTMLInputElement>(null);
  const createLngRef = useRef<HTMLInputElement>(null);
  const editLatRef = useRef<HTMLInputElement>(null);
  const editLngRef = useRef<HTMLInputElement>(null);
  const editingProject =
    initialProjects.find((p) => p.id === editingProjectId) ?? null;
  const editingSite = editingProject ? parseGeoPoint(editingProject.site_point) : null;

  function fillCurrentLocation(
    targetLatRef: React.RefObject<HTMLInputElement | null>,
    targetLngRef: React.RefObject<HTMLInputElement | null>,
  ) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMessage(t("projects.locationUnavailable"));
      return;
    }
    setPickingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (targetLatRef.current) {
          targetLatRef.current.value = position.coords.latitude.toFixed(6);
        }
        if (targetLngRef.current) {
          targetLngRef.current.value = position.coords.longitude.toFixed(6);
        }
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
        setMessage(t(key));
        setPickingLocation(false);
      },
      // 20s timeout (was 10s) — desktop browsers without GPS hardware fall
      // back to Wi-Fi triangulation which routinely takes 10–15s on first
      // call. maximumAge bumped too so a fresh tab-open isn't penalized.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
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
    const gpsRadius = clampRadius(
      Number.parseInt(formData.get("gps_radius_m")?.toString() ?? `${GPS_RADIUS_DEFAULT}`, 10),
    );
    const lat = Number.parseFloat(formData.get("lat")?.toString() ?? "");
    const lng = Number.parseFloat(formData.get("lng")?.toString() ?? "");
    const startDate = formData.get("start_date")?.toString() ?? "";
    const endDate = formData.get("end_date")?.toString() ?? "";

    if (!name) {
      setMessage(t("projects.nameRequired"));
      return;
    }

    // Coordinates are now required: without them the worker-side
    // geofence has nothing to check against and anyone can clock in
    // from anywhere on this project. Refuse the insert before it
    // reaches Supabase rather than saving a site_point: null row.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setMessage(t("projects.coordsRequired"));
      return;
    }

    setBusyKey("create");
    setMessage("");

    const { error } = await insertProjectTolerant(supabase, {
      org_id: orgId,
      name,
      address: address || null,
      notes: notes || null,
      rate: Number.isFinite(rate) ? rate : 25,
      radius_m: Number.isFinite(radius) ? radius : 200,
      gps_radius_m: gpsRadius,
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
    setShowCreatePanel(false);
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
    const gpsRadius = clampRadius(
      Number.parseInt(formData.get("gps_radius_m")?.toString() ?? `${GPS_RADIUS_DEFAULT}`, 10),
    );
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

    const payload: Record<string, unknown> = {
      name,
      address: address || null,
      notes: notes || null,
      rate: Number.isFinite(rate) ? rate : 25,
      radius_m: Number.isFinite(radius) ? radius : 200,
      gps_radius_m: gpsRadius,
      status,
      start_date: startDate || null,
      end_date: endDate || null,
    };

    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      payload.site_point = toSupabasePoint({ lat, lng });
    }

    const { error } = await updateProjectTolerant(supabase, projectId, payload);

    if (error) {
      setMessage(error.message);
      setBusyKey(null);
      return;
    }

    setBusyKey(null);
    setEditingProjectId(null);
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("projects.createProject")}</h2>
          <button
            type="button"
            onClick={() => setShowCreatePanel((v) => !v)}
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
          <div className="md:col-span-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3">
            <GpsRadiusSlider />
          </div>
          <div className="flex items-stretch gap-2">
            <input
              ref={createLatRef}
              name="lat"
              type="number"
              step="0.000001"
              placeholder={t("projects.latitude")}
              className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="button"
              onClick={() => fillCurrentLocation(createLatRef, createLngRef)}
              disabled={pickingLocation}
              title={t("projects.useCurrentLocation")}
              aria-label={t("projects.useCurrentLocation")}
              className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border px-3 text-base disabled:opacity-50"
              style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
            >
              {pickingLocation ? "…" : "📍"}
            </button>
          </div>
          <input
            ref={createLngRef}
            name="lng"
            type="number"
            step="0.000001"
            placeholder={t("projects.longitude")}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
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
          <option value="cost">{t("projects.sortCost")}</option>
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
          const cardBorder =
            state === "live"
              ? "2px solid var(--green)"
              : state === "stale"
                ? "1px solid var(--red)"
                : "1px solid var(--border-default)";
          const cardShadow =
            state === "live"
              ? "0 0 0 1px rgba(15, 168, 120, 0.18), 0 0 18px rgba(15, 168, 120, 0.18)"
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
                        state={state}
                        timeline={(project.timeline_status ?? "on_track") as ProjectTimelineStatus}
                        budget={(project.budget_status ?? "on_budget") as ProjectBudgetStatus}
                        onTimelineClick={() => void handleCycleTimeline(project)}
                        onBudgetClick={() => void handleCycleBudget(project)}
                        timelineLabel={timelineLabel(t, project.timeline_status)}
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
                    {state === "stale" ? (
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--red)" }}>
                        {t("projects.staleNoActivity")}
                      </div>
                    ) : null}
                  </div>
                  <div className="status-pill" data-tone={getProjectTone(project.status)}>
                    {project.status}
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
                  <div className="metric-panel rounded-[var(--radius-md)] p-2">
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
                  <div className="metric-panel rounded-[var(--radius-md)] p-2">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                      {t("common.tasks")}
                    </div>
                    <div className="mt-1 text-base font-bold text-[var(--text-primary)]">
                      {project.openTaskCount}
                    </div>
                  </div>
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
                  onClick={() => setEditingProjectId(project.id)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                  style={{ borderColor: "#3b82f6", color: "#3b82f6", background: "transparent" }}
                >
                  <Pencil size={12} /> {t("common.edit")}
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
          onClick={() => setEditingProjectId(null)}
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
                onClick={() => setEditingProjectId(null)}
                aria-label={t("common.cancel")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                <X size={14} />
              </button>
            </div>
            <form
              className="mt-4 grid gap-3"
              onSubmit={(event) => void handleUpdateProject(event, editingProject.id)}
            >
              <TextInputWithVoice
                name="name"
                defaultValue={editingProject.name}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <TextInputWithVoice
                name="address"
                defaultValue={editingProject.address ?? ""}
                placeholder={t("common.address")}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <input
                  name="rate"
                  type="number"
                  step="0.01"
                  defaultValue={editingProject.rate}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
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
                    defaultValue={editingSite?.lat ?? ""}
                    placeholder={t("projects.latitude")}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => fillCurrentLocation(editLatRef, editLngRef)}
                    disabled={pickingLocation}
                    title={t("projects.useCurrentLocation")}
                    aria-label={t("projects.useCurrentLocation")}
                    className="inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border px-3 text-base disabled:opacity-50"
                    style={{ borderColor: "var(--border-default)", color: "var(--brand-yellow)" }}
                  >
                    {pickingLocation ? "…" : "📍"}
                  </button>
                </div>
                <input
                  ref={editLngRef}
                  name="lng"
                  type="number"
                  step="0.000001"
                  defaultValue={editingSite?.lng ?? ""}
                  placeholder={t("projects.longitude")}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </div>
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
                  onClick={() => setEditingProjectId(null)}
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
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = removeTarget.id;
                    setRemoveConfirmId(null);
                    void handleArchiveProject(id);
                  }}
                  disabled={busyKey === `archive-${removeTarget.id}`}
                  className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                  style={{ background: "var(--red)", color: "white" }}
                >
                  {busyKey === `archive-${removeTarget.id}`
                    ? t("projects.archiving")
                    : t("common.remove")}
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
