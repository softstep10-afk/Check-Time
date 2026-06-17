import "server-only";

import { cache } from "react";
import { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewWorkerShellData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { buildWorkerSessions, deriveClockState, deriveWorkerSummary, enrichProjects } from "@/lib/worker-utils";
import {
  fetchTaskAttachments,
  getAttachmentMediaIds,
  getAttachmentRefs,
} from "@/lib/task-attachments";
import { isMaterialTask } from "@/lib/material-tasks";
import {
  canSeeOpenMaterialTask,
  shouldFilterWorkerTasksToMaterials,
} from "@/lib/material-driver-permissions";
import { readMaterialDriverProfileIdsFromEnv } from "@/lib/server/material-driver-config";
import { getCompletionMediaIds } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import {
  PROFILE_SELECT_WITHOUT_RATE,
  withNullProfileRate,
  type ProfileWithoutRate,
} from "@/lib/profile-rates";
import type { WorkerMediaItem, WorkerShellData, WorkerTaskItem } from "@/lib/worker-types";
import type { Media, PayrollClosure, Profile, Project, Task, TimeEvent } from "@/types/database";

const WORKER_AUTH_TIMEOUT_MS = 8_000;
const WORKER_BOOTSTRAP_PROFILE_TIMEOUT_MS = 4_000;
const WORKER_PROFILE_TIMEOUT_MS = 6_000;
const WORKER_QUERY_TIMEOUT_MS = 7_000;
const WORKER_ATTACHMENTS_TIMEOUT_MS = 5_000;

const PROFILE_BOOTSTRAP_SELECT = [
  "id",
  "org_id",
  "name",
  "role",
  "color",
  "is_active",
  "require_video",
  "language",
  "settings",
  "last_clock_in",
  "current_project",
  "deleted_at",
  "created_at",
  "updated_at",
].join(", ");

type WorkerDataError = { message: string };
type QueryResult<T> = { data: T | null; error: WorkerDataError | null };
type WorkerAuthUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};
type WorkerProfileRead =
  | { profile: Profile; source: "full" | "bootstrap" | "synthetic" }
  | { profile: null; source: "missing" };

function normaliseError(error: unknown): WorkerDataError {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return { message };
    }
  }
  if (typeof error === "string" && error.trim()) {
    return { message: error };
  }
  return { message: "Unknown error" };
}

function timeoutError(label: string, timeoutMs: number): WorkerDataError {
  return { message: `${label} timed out after ${timeoutMs}ms` };
}

function logWorkerDataWarning(label: string, error: WorkerDataError | null) {
  console.warn(`[worker-data] ${label}: ${error?.message ?? "no data"}`);
}

async function withQueryTimeout<T>(
  label: string,
  query: PromiseLike<QueryResult<T>>,
  timeoutMs = WORKER_QUERY_TIMEOUT_MS,
): Promise<QueryResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<QueryResult<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({ data: null, error: timeoutError(label, timeoutMs) });
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(query), timeout]);
  } catch (error) {
    return { data: null, error: normaliseError(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withValueTimeout<T>(
  label: string,
  promise: PromiseLike<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      logWorkerDataWarning(label, timeoutError(label, timeoutMs));
      resolve(fallback);
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } catch (error) {
    logWorkerDataWarning(label, normaliseError(error));
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rowsOrEmpty<T>(label: string, result: QueryResult<T[]>): T[] {
  if (result.error) {
    logWorkerDataWarning(label, result.error);
  }
  return result.data ?? [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildSyntheticWorkerProfile(user: WorkerAuthUser): Profile {
  const metadata = user.user_metadata ?? {};
  const now = new Date().toISOString();
  const emailName = user.email?.split("@")[0] ?? null;

  return {
    id: user.id,
    org_id: "",
    name:
      readString(metadata.name) ??
      readString(metadata.full_name) ??
      readString(emailName) ??
      "Worker",
    role: "worker",
    pin_hash: null,
    color: "#9ca3af",
    is_active: true,
    require_video: false,
    hourly_rate: null,
    language: readString(metadata.language) ?? "en",
    settings: {},
    last_clock_in: null,
    current_project: null,
    notif_mode: "silent",
    project_access_mode: "list",
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
}

function buildMinimalWorkerShellData(profile: Profile): WorkerShellData {
  const sessions: WorkerShellData["sessions"] = [];

  return {
    profile,
    materialDriverView: false,
    projects: [],
    tasks: [],
    media: [],
    sessions,
    clockState: deriveClockState(sessions),
    summary: deriveWorkerSummary(sessions),
    adjustments: [],
    closures: [],
  };
}

export const getWorkerShellBootstrapData = cache(async (): Promise<WorkerShellData> => {
  const supabase = await createClient();
  const authFallback: Awaited<ReturnType<typeof supabase.auth.getUser>> = {
    data: { user: null },
    error: new AuthError(
      timeoutError("Worker auth query", WORKER_AUTH_TIMEOUT_MS).message,
      408,
      "timeout",
    ),
  };
  const authResult = await withValueTimeout(
    "Worker auth query",
    supabase.auth.getUser(),
    authFallback,
    WORKER_AUTH_TIMEOUT_MS,
  );
  const {
    data: { user },
    error: authError,
  } = authResult;

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return buildPreviewWorkerShellData();
  }

  if (authError || !user) {
    if (authError) {
      logWorkerDataWarning("Worker auth query", normaliseError(authError));
    }
    redirect("/login");
  }

  const bootstrapProfile = await withQueryTimeout<ProfileWithoutRate>(
    "Worker bootstrap profile query",
    supabase
      .from("profiles")
      .select(PROFILE_BOOTSTRAP_SELECT)
      .eq("id", user.id)
      .maybeSingle<ProfileWithoutRate>(),
    WORKER_BOOTSTRAP_PROFILE_TIMEOUT_MS,
  );

  if (bootstrapProfile.error) {
    logWorkerDataWarning("Worker bootstrap profile query", bootstrapProfile.error);
  }

  const profile =
    bootstrapProfile.data
      ? withNullProfileRate(bootstrapProfile.data)
      : bootstrapProfile.error
        ? buildSyntheticWorkerProfile(user)
        : null;

  if (!profile) {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/login");
  }

  if (profile.role === "manager" || profile.role === "admin" || profile.role === "owner") {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/overview");
  }

  return buildMinimalWorkerShellData(profile);
});

async function readWorkerProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: WorkerAuthUser,
): Promise<WorkerProfileRead> {
  const fullProfile = await withQueryTimeout<ProfileWithoutRate>(
    "Worker profile query",
    supabase
      .from("profiles")
      .select(PROFILE_SELECT_WITHOUT_RATE)
      .eq("id", user.id)
      .maybeSingle<ProfileWithoutRate>(),
    WORKER_PROFILE_TIMEOUT_MS,
  );

  if (fullProfile.data) {
    return { profile: withNullProfileRate(fullProfile.data), source: "full" };
  }

  if (fullProfile.error) {
    logWorkerDataWarning("Worker profile query", fullProfile.error);

    const bootstrapProfile = await withQueryTimeout<ProfileWithoutRate>(
      "Worker bootstrap profile query",
      supabase
        .from("profiles")
        .select(PROFILE_BOOTSTRAP_SELECT)
        .eq("id", user.id)
        .maybeSingle<ProfileWithoutRate>(),
      WORKER_PROFILE_TIMEOUT_MS,
    );

    if (bootstrapProfile.data) {
      return { profile: withNullProfileRate(bootstrapProfile.data), source: "bootstrap" };
    }

    if (bootstrapProfile.error) {
      logWorkerDataWarning("Worker bootstrap profile query", bootstrapProfile.error);
    }

    return { profile: buildSyntheticWorkerProfile(user), source: "synthetic" };
  }

  return { profile: null, source: "missing" };
}

function isUnclaimedDeliveryTask(task: Task): boolean {
  if (task.assigned_to !== null) return false;
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).schedule_kind === "delivery";
}

export async function loadWorkerShellData(): Promise<WorkerShellData> {
  const supabase = await createClient();
  const authFallback: Awaited<ReturnType<typeof supabase.auth.getUser>> = {
    data: { user: null },
    error: new AuthError(
      timeoutError("Worker auth query", WORKER_AUTH_TIMEOUT_MS).message,
      408,
      "timeout",
    ),
  };
  const authResult = await withValueTimeout(
    "Worker auth query",
    supabase.auth.getUser(),
    authFallback,
    WORKER_AUTH_TIMEOUT_MS,
  );
  const {
    data: { user },
    error: authError,
  } = authResult;

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return buildPreviewWorkerShellData();
  }

  if (authError || !user) {
    if (authError) {
      logWorkerDataWarning("Worker auth query", normaliseError(authError));
    }
    redirect("/login");
  }

  const profileRead = await readWorkerProfile(supabase, user);
  const profile = profileRead.profile;
  const configuredMaterialDriverIds = readMaterialDriverProfileIdsFromEnv();

  if (!profile) {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/login");
  }

  if (profile.role === "manager" || profile.role === "admin" || profile.role === "owner") {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/overview");
  }

  if (profileRead.source === "synthetic") {
    return buildMinimalWorkerShellData(profile);
  }

  const [
    assignmentsResult,
    eventsResult,
    closuresResult,
    tasksResult,
    openDeliveryTasksResult,
    mediaResult,
  ] = await Promise.all([
    withQueryTimeout<Array<{ project_id: string; assigned_at: string | null }>>(
      "Worker assignments query",
      supabase
        .from("project_assignments")
        .select("project_id, assigned_at")
        .eq("profile_id", user.id),
    ),
    withQueryTimeout<TimeEvent[]>(
      "Worker time events query",
      supabase
        .from("time_events")
        .select("*")
        .eq("profile_id", user.id)
        .order("event_time", { ascending: false })
        .limit(500)
        .returns<TimeEvent[]>(),
    ),
    withQueryTimeout<Pick<PayrollClosure, "closed_through">[]>(
      "Worker payroll closures query",
      supabase
        .from("payroll_closures")
        .select("closed_through")
        .eq("profile_id", user.id)
        .order("closed_through", { ascending: false })
        .limit(50)
        .returns<Pick<PayrollClosure, "closed_through">[]>(),
    ),
    withQueryTimeout<Task[]>(
      "Worker personal tasks query",
      supabase
        .from("tasks")
        .select("*")
        .eq("assigned_to", user.id)
        .order("created_at", { ascending: false })
        .limit(60)
        .returns<Task[]>(),
    ),
    // Open delivery calendar items are team-call tasks: any worker,
    // driver, subcontractor, or supervisor can claim them even before a
    // specific person is assigned. Keep them in the worker queue so the
    // "I will take it" flow is visible from /my-tasks and project pages.
    withQueryTimeout<Task[]>(
      "Worker open delivery tasks query",
      supabase
        .from("tasks")
        .select("*")
        .is("assigned_to", null)
        .eq("metadata->>schedule_kind", "delivery")
        .order("created_at", { ascending: false })
        .limit(80)
        .returns<Task[]>(),
    ),
    // Worker journal feed: only the worker's own uploads.
    //
    // Wave X2 (00011_media_project_privacy.sql) tightens the media SELECT
    // RLS so workers also can't peek at media they did NOT upload for
    // projects they are NOT assigned to. This query is already narrower
    // than that policy (uploaded_by = self), so no code change is needed
    // here. RLS will continue to filter automatically through the SSR
    // client.
    withQueryTimeout<Media[]>(
      "Worker media query",
      supabase
        .from("media")
        .select("*")
        .eq("uploaded_by", user.id)
        .order("created_at", { ascending: false })
        .limit(40)
        .returns<Media[]>(),
    ),
  ]);

  const assignments = rowsOrEmpty("Worker assignments query", assignmentsResult);
  const events = rowsOrEmpty("Worker time events query", eventsResult);
  const closures = rowsOrEmpty("Worker payroll closures query", closuresResult).map((closure) => ({
    closedThrough: closure.closed_through,
  }));
  const personalTasks = rowsOrEmpty("Worker personal tasks query", tasksResult);
  const openDeliveryTasks = rowsOrEmpty("Worker open delivery tasks query", openDeliveryTasksResult);
  let media = rowsOrEmpty("Worker media query", mediaResult);

  const earliestEventMs = events.reduce<number | null>((earliest, event) => {
    const value = new Date(event.event_time).getTime();
    if (!Number.isFinite(value)) return earliest;
    return earliest === null ? value : Math.min(earliest, value);
  }, null);
  if (earliestEventMs !== null) {
    const checkoutMediaWindowStart = new Date(
      earliestEventMs - 15 * 60 * 1000,
    ).toISOString();
    const checkoutMediaResult = await withQueryTimeout<Media[]>(
      "Worker checkout media query",
      supabase
        .from("media")
        .select("*")
        .eq("uploaded_by", user.id)
        .eq("is_checkout", true)
        .eq("media_type", "video")
        .gte("created_at", checkoutMediaWindowStart)
        .order("created_at", { ascending: false })
        .limit(160)
        .returns<Media[]>(),
    );
    if (checkoutMediaResult.error) {
      logWorkerDataWarning("Worker checkout media query", checkoutMediaResult.error);
    }

    const mediaById = new Map(media.map((entry) => [entry.id, entry]));
    for (const entry of checkoutMediaResult.data ?? []) {
      mediaById.set(entry.id, entry);
    }
    media = [...mediaById.values()].sort(
      (left, right) =>
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
    );
  }

  const projectIds = new Set<string>();
  const assignedAtByProjectId = new Map<string, string | null>();

  for (const assignment of assignments) {
    if (assignment.project_id) {
      projectIds.add(assignment.project_id);
      assignedAtByProjectId.set(assignment.project_id, assignment.assigned_at ?? null);
    }
  }

  // Migration 00018 — visibility set depends on profile.project_access_mode.
  //   'list'        → existing project_assignments rows
  //   'all_active'  → every active project minus project_exclusions
  // The column is optional in older deploys; treat undefined as 'list'
  // so workers default to today's behavior until the migration runs.
  const accessMode: "list" | "all_active" =
    profile.project_access_mode === "all_active" ? "all_active" : "list";

  const allowedProjectIds = new Set<string>();
  if (accessMode === "list") {
    for (const assignment of assignments) {
      if (assignment.project_id) {
        allowedProjectIds.add(assignment.project_id);
      }
    }
    if (allowedProjectIds.size > 0) {
      const visibleAssignedProjectsResult = await withQueryTimeout<Array<{ id: string }>>(
        "Assigned projects visibility query",
        supabase
          .from("projects")
          .select("id")
          .in("id", [...allowedProjectIds])
          .neq("status", "archived")
          .is("deleted_at", null)
          .returns<Array<{ id: string }>>(),
      );
      if (visibleAssignedProjectsResult.error) {
        logWorkerDataWarning("Assigned projects visibility query", visibleAssignedProjectsResult.error);
      } else {
        const visibleIds = new Set((visibleAssignedProjectsResult.data ?? []).map((project) => project.id));
        for (const projectId of [...allowedProjectIds]) {
          if (!visibleIds.has(projectId)) {
            allowedProjectIds.delete(projectId);
            projectIds.delete(projectId);
          }
        }
      }
    }
  } else {
    const [activeProjectsResult, exclusionsResult] = await Promise.all([
      withQueryTimeout<Array<{ id: string }>>(
        "Active projects query",
        supabase
          .from("projects")
          .select("id")
          .eq("status", "active")
          .is("deleted_at", null)
          .returns<Array<{ id: string }>>(),
      ),
      withQueryTimeout<Array<{ project_id: string }>>(
        "Project exclusions query",
        supabase
          .from("project_exclusions")
          .select("project_id")
          .eq("profile_id", user.id)
          .returns<Array<{ project_id: string }>>(),
      ),
    ]);
    if (activeProjectsResult.error) {
      logWorkerDataWarning("Active projects query", activeProjectsResult.error);
    }
    // project_exclusions table may not exist on a deploy that hasn't run
    // migration 00018 yet — treat that as "no exclusions" rather than a hard
    // failure so a partially-migrated environment doesn't lock workers out.
    if (exclusionsResult.error) {
      logWorkerDataWarning("Project exclusions query", exclusionsResult.error);
    }
    const exclusionRows = exclusionsResult.data ?? [];
    for (const row of activeProjectsResult.data ?? []) {
      allowedProjectIds.add(row.id);
      projectIds.add(row.id); // hydrate the project list below too
    }
    for (const row of exclusionRows) {
      allowedProjectIds.delete(row.project_id);
    }
  }

  // Project-level tasks (assigned_to is null, project the worker is on).
  // Visible to every worker whose access mode includes that project.
  // Manager creates one task without a specific assignee and the whole
  // crew sees it.
  let projectLevelTasks: Task[] = [];
  if (allowedProjectIds.size > 0) {
    const projectLevelTasksResult = await withQueryTimeout<Task[]>(
      "Project-level tasks query",
      supabase
        .from("tasks")
        .select("*")
        .is("assigned_to", null)
        .in("project_id", [...allowedProjectIds])
        .order("created_at", { ascending: false })
        .limit(60)
        .returns<Task[]>(),
    );
    projectLevelTasks = rowsOrEmpty("Project-level tasks query", projectLevelTasksResult);
  }

  // Merge personal + project-level, dedupe by id (covers the edge case of
  // a project-level task that was later assigned to this worker explicitly).
  const seenIds = new Set(personalTasks.map((t) => t.id));
  const dedupedOpenDeliveries = openDeliveryTasks.filter((task) => {
    if (seenIds.has(task.id)) return false;
    seenIds.add(task.id);
    return true;
  });
  const dedupedProjectLevelTasks = projectLevelTasks.filter((task) => {
    if (seenIds.has(task.id)) return false;
    seenIds.add(task.id);
    return true;
  });
  let tasks: Task[] = [
    ...personalTasks,
    ...dedupedOpenDeliveries,
    ...dedupedProjectLevelTasks,
  ].map((task) => ({
    ...task,
    status: getEffectiveTaskStatus(task),
  }));

  for (const event of events) {
    projectIds.add(event.project_id);
  }

  for (const task of tasks) {
    if (task.project_id) {
      projectIds.add(task.project_id);
    }
  }

  for (const entry of media) {
    if (entry.project_id) {
      projectIds.add(entry.project_id);
    }
  }

  if (profile.current_project) {
    projectIds.add(profile.current_project);
  }

  let projects: Project[] = [];
  if (projectIds.size > 0) {
    const projectsResult = await withQueryTimeout<Project[]>(
      "Worker projects query",
      supabase
        .from("projects")
        .select("*")
        .in("id", [...projectIds])
        .returns<Project[]>(),
    );
    if (projectsResult.error) {
      logWorkerDataWarning("Worker projects query", projectsResult.error);
    }
    projects = (projectsResult.data ?? []).filter(
      (project) => !project.deleted_at && project.status !== "archived",
    );
  }

  const workerProjects = enrichProjects(projects, assignedAtByProjectId);
  const projectsById = new Map(workerProjects.map((project) => [project.id, project]));
  const visibleProjectIds = new Set(workerProjects.map((project) => project.id));
  tasks = tasks.filter(
    (task) =>
      !task.project_id ||
      visibleProjectIds.has(task.project_id) ||
      isUnclaimedDeliveryTask(task),
  );
  const materialDriverView = shouldFilterWorkerTasksToMaterials(profile, {
    configuredDriverProfileIds: configuredMaterialDriverIds,
  });
  const canSeeOpenMaterials = canSeeOpenMaterialTask(profile, {
    configuredDriverProfileIds: configuredMaterialDriverIds,
  });
  tasks = tasks.filter((task) => {
    if (task.assigned_to === null && isMaterialTask(task)) {
      return canSeeOpenMaterials;
    }
    return true;
  });
  if (materialDriverView) {
    tasks = tasks.filter(isMaterialTask);
  }
  media = media.filter((entry) => !entry.project_id || visibleProjectIds.has(entry.project_id));

  // Eager-fetch attachment media rows referenced by any task.metadata.
  // Both `attachment_media_ids` (manager-supplied at task creation) and
  // `completion_media_ids` (worker evidence at done-time) live in the
  // same media table, so a single bulk fetch + lookup map covers both.
  // RLS scopes results to this worker.
  const allAttachmentIds = Array.from(
    new Set(
      tasks.flatMap((task) => [
        ...getAttachmentMediaIds(task),
        ...getCompletionMediaIds(task),
      ]),
    ),
  );
  const attachmentMap = await withValueTimeout(
    "Worker task attachments query",
    fetchTaskAttachments(supabase, allAttachmentIds),
    new Map(),
    WORKER_ATTACHMENTS_TIMEOUT_MS,
  );

  const taskItems: WorkerTaskItem[] = tasks.map((task) => {
    const ids = getAttachmentMediaIds(task);
    const fallbackAttachmentRefs = getAttachmentRefs(task);
    const fallbackAttachmentById = new Map(
      fallbackAttachmentRefs.map((ref) => [ref.id, ref]),
    );
    const resolved = ids
      .map((id) => attachmentMap.get(id) ?? fallbackAttachmentById.get(id))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
    const completionIds = getCompletionMediaIds(task);
    const completionResolved = completionIds
      .map((id) => attachmentMap.get(id))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));
    return {
      ...task,
      projectName: task.project_id ? projectsById.get(task.project_id)?.name ?? null : null,
      attachments: resolved.length > 0 ? resolved : undefined,
      completionAttachments: completionResolved.length > 0 ? completionResolved : undefined,
    };
  });
  const mediaItems: WorkerMediaItem[] = media.map((entry) => ({
    ...entry,
    projectName: entry.project_id ? projectsById.get(entry.project_id)?.name ?? null : null,
  }));

  const sessions = buildWorkerSessions(events, workerProjects, mediaItems);
  const clockState = deriveClockState(sessions);
  const summary = deriveWorkerSummary(sessions);

  // Adjustment events the manager flagged as visible to the worker.
  // metadata.showToWorker is undefined on legacy rows → default to visible.
  const adjustments = events
    .filter((event) => {
      if (event.event_type !== "adjust") return false;
      const meta = event.metadata as Record<string, unknown>;
      return meta?.showToWorker !== false;
    })
    .map((event) => {
      const meta = event.metadata as Record<string, unknown>;
      const minutes = Number(meta?.adjustMinutes ?? 0);
      return {
        id: event.id,
        projectId: event.project_id,
        projectName: projectsById.get(event.project_id)?.name ?? null,
        eventTime: event.event_time,
        minutes: Number.isFinite(minutes) ? minutes : 0,
        reason: typeof meta?.reason === "string" ? meta.reason : "",
        kind: typeof meta?.kind === "string" ? meta.kind : null,
      };
    });

  // Hide projects that aren't in the worker's access set. We keep
  // workerProjects fully populated above so session rows / task rows /
  // media rows can still resolve a projectName for historical entries
  // — only the live picker (shell.projects) is filtered down.
  const visibleProjects = workerProjects.filter((project) =>
    allowedProjectIds.has(project.id),
  );

  return {
    profile,
    materialDriverView,
    projects: visibleProjects.sort((left, right) => left.name.localeCompare(right.name)),
    tasks: taskItems,
    media: mediaItems,
    sessions,
    clockState,
    summary,
    adjustments,
    closures,
  };
}

export const getWorkerShellData = cache(loadWorkerShellData);
