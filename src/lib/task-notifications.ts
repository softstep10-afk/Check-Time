/**
 * Task notification + grouping helpers shared by the worker shell, the
 * /my-tasks page, and the notification bell. Pure logic so it can be
 * unit-tested without the Supabase client / React tree.
 *
 * Two product behaviors live here:
 *
 *   1. Worker task visibility — replicates the same filter the SSR data
 *      loader uses so realtime payloads can be triaged client-side
 *      (assigned-to-me, OR project-level on a project I can see).
 *
 *   2. Unseen-task tracking — a per-worker localStorage timestamp
 *      ("last seen") that powers the notification badge / banner /
 *      sound on /my-tasks visit. The first ever load defaults the
 *      timestamp to the most recent task's created_at so existing old
 *      tasks do not keep triggering after the worker upgrades.
 */

const TASK_LAST_SEEN_KEY_PREFIX = "check-time-tasks-last-seen-";

export interface TaskVisibilityArgs {
  /** profiles.id of the current worker. */
  profileId: string;
  /** Project ids visible to this worker (their access set). */
  visibleProjectIds: Set<string>;
}

export interface TaskLike {
  id: string;
  assigned_to: string | null;
  project_id: string | null;
  status: string;
  created_at: string;
  deleted_at?: string | null;
}

/**
 * True when this task should appear on the worker's queue. Mirrors the
 * server-side filter in worker-data.ts: personal tasks (assigned_to=me)
 * are always visible; project-level tasks (assigned_to=null) are visible
 * when the worker has access to the project.
 *
 * Soft-deleted, done, and cancelled tasks are excluded — those should
 * never wake the badge or banner.
 */
export function isTaskVisibleToWorker(
  task: TaskLike,
  args: TaskVisibilityArgs,
): boolean {
  if (task.deleted_at) return false;
  if (task.status === "done" || task.status === "cancelled") return false;
  if (task.assigned_to === args.profileId) return true;
  if (
    task.assigned_to === null &&
    task.project_id &&
    args.visibleProjectIds.has(task.project_id)
  ) {
    return true;
  }
  return false;
}

export interface UnseenTasksResult {
  /** Number of visible, non-terminal tasks created after lastSeenIso. */
  count: number;
  /** Most-recent created_at across visible tasks, or null when empty. */
  latestCreatedAt: string | null;
}

/**
 * Count visible tasks that are newer than the worker's last-seen
 * timestamp. When `lastSeenIso` is null we treat every visible task
 * as unseen — callers that want to suppress that initial flood should
 * pre-seed lastSeenIso to `latestCreatedAt` of the first load.
 */
export function countUnseenTasks(
  tasks: TaskLike[],
  lastSeenIso: string | null,
  args: TaskVisibilityArgs,
): UnseenTasksResult {
  let count = 0;
  let latestCreatedAt: string | null = null;
  for (const task of tasks) {
    if (!isTaskVisibleToWorker(task, args)) continue;
    if (!latestCreatedAt || task.created_at > latestCreatedAt) {
      latestCreatedAt = task.created_at;
    }
    if (lastSeenIso && task.created_at <= lastSeenIso) continue;
    count += 1;
  }
  return { count, latestCreatedAt };
}

export function loadTaskLastSeen(profileId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TASK_LAST_SEEN_KEY_PREFIX + profileId);
  } catch {
    return null;
  }
}

export function saveTaskLastSeen(profileId: string, iso: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TASK_LAST_SEEN_KEY_PREFIX + profileId, iso);
  } catch {
    // Ignore quota / disabled-storage errors. Worst case the badge
    // stays warm until the next route change clears it server-side.
  }
}

export interface TaskGroupingItem {
  id: string;
  project_id: string | null;
  projectName: string | null;
  priority: string;
  created_at: string;
}

export interface ProjectBucket<T> {
  key: string;
  name: string;
  tasks: T[];
}

const DEFAULT_PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Group worker tasks into per-project buckets and sort:
 *   1. The current/active project (worker is clocked in there) first.
 *   2. Other projects alphabetically by name.
 *   3. The synthetic "no project" bucket last.
 *
 * Inside each bucket: priority desc, then created_at desc.
 *
 * `currentProjectId` is the project the worker is clocked in to; pass
 * null when the worker is off-clock so all projects sort alphabetically.
 */
export function groupWorkerTasksByProject<T extends TaskGroupingItem>(
  tasks: T[],
  options: {
    currentProjectId?: string | null;
    generalLabel: string;
    priorityOrder?: Record<string, number>;
  },
): ProjectBucket<T>[] {
  const priorityOrder = options.priorityOrder ?? DEFAULT_PRIORITY_ORDER;
  const map = new Map<string, ProjectBucket<T>>();
  for (const task of tasks) {
    const key = task.project_id ?? "__noproject__";
    const name = task.projectName ?? options.generalLabel;
    const bucket = map.get(key) ?? { key, name, tasks: [] };
    bucket.tasks.push(task);
    map.set(key, bucket);
  }
  for (const bucket of map.values()) {
    bucket.tasks.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 99;
      const pb = priorityOrder[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }
  const buckets = [...map.values()];
  const currentId = options.currentProjectId ?? null;
  buckets.sort((a, b) => {
    const aCurrent = currentId !== null && a.key === currentId;
    const bCurrent = currentId !== null && b.key === currentId;
    if (aCurrent && !bCurrent) return -1;
    if (bCurrent && !aCurrent) return 1;
    if (a.key === "__noproject__" && b.key !== "__noproject__") return 1;
    if (b.key === "__noproject__" && a.key !== "__noproject__") return -1;
    return a.name.localeCompare(b.name);
  });
  return buckets;
}

/**
 * Classify a task for "My task" / "Project task" labelling. Returns
 * "personal" when the worker is the explicit assignee, "project" when
 * it's an assigned_to=null project-level task, and "other" for anything
 * else (e.g. assigned to a different worker but visible because the row
 * happened to be cached).
 */
export function classifyTaskForWorker(
  task: { assigned_to: string | null; project_id: string | null },
  profileId: string,
): "personal" | "project" | "other" {
  if (task.assigned_to === profileId) return "personal";
  if (task.assigned_to === null && task.project_id) return "project";
  return "other";
}

export function applyClaimedTaskAssignment<
  T extends { id: string; assigned_to: string | null },
>(tasks: T[], taskId: string, assignedTo: string | null): T[] {
  return tasks.map((task) =>
    task.id === taskId ? { ...task, assigned_to: assignedTo } : task,
  );
}

export function splitWorkerProjectTasks<
  T extends { assigned_to: string | null; status: string },
>(tasks: T[], profileId: string): {
  mineTasks: T[];
  projectLevelTasks: T[];
  completedTasks: T[];
} {
  const completedTasks = tasks.filter((task) => task.status === "done");
  return {
    mineTasks: tasks.filter(
      (task) => task.assigned_to === profileId && task.status !== "done",
    ),
    projectLevelTasks: tasks.filter(
      (task) => task.assigned_to === null && task.status !== "done",
    ),
    completedTasks,
  };
}

export function shouldBlockCompletionFileUpload({
  projectId,
  fileCount,
}: {
  projectId: string | null | undefined;
  fileCount: number;
}): boolean {
  return fileCount > 0 && !projectId;
}

/**
 * Merge an optional worker completion note into a task's existing
 * `metadata` jsonb without disturbing other keys. Returns a NEW object
 * — callers should pass the result to `update({ metadata })`. Empty
 * notes are ignored (no key churn on the row).
 *
 * `tasks.metadata` is `Record<string, unknown>` and already exists in
 * the schema; this helper just keeps the merge centralised so the
 * worker shell, the worker project view, and any future callers all
 * stamp the same `completion_note` shape.
 */
export function mergeCompletionNote(
  existing: Record<string, unknown> | null | undefined,
  note: string | null | undefined,
): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (trimmed.length === 0) return base;
  base.completion_note = trimmed;
  base.completion_note_at = new Date().toISOString();
  return base;
}

export interface TaskCompletionPayload {
  /** Free-form text the worker types in the completion modal. */
  note?: string | null;
  /** True when the worker checked "Needs follow-up". */
  followUpRequired?: boolean;
  /** Free-form follow-up text — only meaningful when followUpRequired. */
  followUpNote?: string | null;
  /**
   * media.id values for any photos / videos / PDFs the worker uploaded
   * as completion evidence. Stored separately from the original
   * `attachment_media_ids` (which the manager set when creating the
   * task) so the manager UI can distinguish "evidence the worker
   * uploaded after the fact" from "files the manager attached upfront".
   */
  completionMediaIds?: string[];
  /** profiles.id of the worker completing the task — recorded in metadata.completed_by_recorded for audit. */
  completedById?: string | null;
}

/**
 * Compose the metadata patch for a worker task completion. Combines:
 *   • completion_note + completion_note_at (kept compatible with the
 *     existing mergeCompletionNote semantics)
 *   • follow_up_required + follow_up_note + follow_up_at when the
 *     worker flagged the task as needing more work
 *   • completion_media_ids (NEW) — media.id values for evidence
 *     uploaded during the completion flow
 *   • completed_by_recorded — auditable who-finished-it stamp;
 *     `tasks.completed_by` is the canonical column but a metadata
 *     mirror keeps the audit trail intact even if a future trigger
 *     overwrites the column
 *
 * Returns a NEW metadata object. Empty strings collapse cleanly so
 * we never write half-empty rows.
 */
export function buildTaskCompletionMetadata(
  existing: Record<string, unknown> | null | undefined,
  payload: TaskCompletionPayload,
): Record<string, unknown> {
  const base = existing && typeof existing === "object" ? { ...existing } : {};
  const now = new Date().toISOString();

  const trimmedNote = typeof payload.note === "string" ? payload.note.trim() : "";
  if (trimmedNote.length > 0) {
    base.completion_note = trimmedNote;
    base.completion_note_at = now;
  }

  if (payload.followUpRequired) {
    base.follow_up_required = true;
    base.follow_up_at = now;
    const trimmedFollowUp =
      typeof payload.followUpNote === "string" ? payload.followUpNote.trim() : "";
    if (trimmedFollowUp.length > 0) {
      base.follow_up_note = trimmedFollowUp;
    }
  } else if (payload.followUpRequired === false) {
    // Explicit false clears any prior follow-up flag — supports a worker
    // re-completing a task to mark it actually done.
    delete base.follow_up_required;
    delete base.follow_up_at;
    delete base.follow_up_note;
  }

  if (payload.completionMediaIds && payload.completionMediaIds.length > 0) {
    const existingList = Array.isArray(base.completion_media_ids)
      ? (base.completion_media_ids as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    const merged = Array.from(
      new Set([...existingList, ...payload.completionMediaIds]),
    );
    base.completion_media_ids = merged;
  }

  if (payload.completedById) {
    base.completed_by_recorded = payload.completedById;
  }

  return base;
}

/** Defensive read of completion_media_ids from task.metadata. */
export function getCompletionMediaIds(task: { metadata?: unknown }): string[] {
  const meta = task.metadata as Record<string, unknown> | null | undefined;
  const ids = meta?.completion_media_ids;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}

/** Defensive read of follow-up fields written by buildTaskCompletionMetadata. */
export function getFollowUpInfo(task: { metadata?: unknown }): {
  required: boolean;
  note: string | null;
} {
  const meta = task.metadata as Record<string, unknown> | null | undefined;
  return {
    required: meta?.follow_up_required === true,
    note: typeof meta?.follow_up_note === "string" ? meta.follow_up_note : null,
  };
}

/** Defensive read of the completion note from task.metadata. */
export function getCompletionNote(task: { metadata?: unknown }): string | null {
  const meta = task.metadata as Record<string, unknown> | null | undefined;
  return typeof meta?.completion_note === "string" ? meta.completion_note : null;
}

export interface CompletionAuditProfile {
  id: string;
  name: string | null;
}

export function buildProfileNameMap(
  profiles: CompletionAuditProfile[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.name) map.set(profile.id, profile.name);
  }
  return map;
}

export function getTaskCompletionAudit(
  task: {
    status?: string | null;
    completed_by?: string | null;
    completed_at?: string | null;
    metadata?: unknown;
    completedByName?: string | null;
  },
  profileNames: Map<string, string> = new Map(),
): {
  hasAudit: boolean;
  completedById: string | null;
  completedByName: string | null;
  completedAt: string | null;
} {
  const meta = task.metadata as Record<string, unknown> | null | undefined;
  const recordedBy =
    typeof meta?.completed_by_recorded === "string"
      ? meta.completed_by_recorded
      : null;
  const completedById = task.completed_by ?? recordedBy;
  const completedAt = task.completed_at ?? null;
  const hasAudit =
    task.status === "done" ||
    Boolean(completedById) ||
    Boolean(completedAt) ||
    Boolean(getCompletionNote(task)) ||
    getFollowUpInfo(task).required ||
    getCompletionMediaIds(task).length > 0;

  return {
    hasAudit,
    completedById,
    completedByName: completedById
      ? task.completedByName ?? profileNames.get(completedById) ?? null
      : null,
    completedAt,
  };
}
