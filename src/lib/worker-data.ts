import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewWorkerShellData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { buildWorkerSessions, deriveClockState, deriveWorkerSummary, enrichProjects } from "@/lib/worker-utils";
import {
  fetchTaskAttachments,
  getAttachmentMediaIds,
} from "@/lib/task-attachments";
import { isMaterialTask } from "@/lib/material-tasks";
import {
  canSeeOpenMaterialTask,
  shouldFilterWorkerTasksToMaterials,
} from "@/lib/material-driver-permissions";
import { readMaterialDriverProfileIdsFromEnv } from "@/lib/server/material-driver-config";
import { getCompletionMediaIds } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import type { WorkerMediaItem, WorkerShellData, WorkerTaskItem } from "@/lib/worker-types";
import type { Media, PayrollClosure, Profile, Project, Task, TimeEvent } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

function isUnclaimedDeliveryTask(task: Task): boolean {
  if (task.assigned_to !== null) return false;
  const metadata = task.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>).schedule_kind === "delivery";
}

export const getWorkerShellData = cache(async (): Promise<WorkerShellData> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return buildPreviewWorkerShellData();
  }

  if (authError || !user) {
    redirect("/login");
  }

  const [
    profileResult,
    assignmentsResult,
    eventsResult,
    closuresResult,
    tasksResult,
    openDeliveryTasksResult,
    mediaResult,
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single<Profile>(),
    supabase
      .from("project_assignments")
      .select("project_id, assigned_at")
      .eq("profile_id", user.id),
    supabase
      .from("time_events")
      .select("*")
      .eq("profile_id", user.id)
      .order("event_time", { ascending: false })
      .limit(500)
      .returns<TimeEvent[]>(),
    supabase
      .from("payroll_closures")
      .select("closed_through")
      .eq("profile_id", user.id)
      .order("closed_through", { ascending: false })
      .limit(50)
      .returns<Pick<PayrollClosure, "closed_through">[]>(),
    supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", user.id)
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<Task[]>(),
    // Open delivery calendar items are team-call tasks: any worker,
    // driver, subcontractor, or supervisor can claim them even before a
    // specific person is assigned. Keep them in the worker queue so the
    // "I will take it" flow is visible from /my-tasks and project pages.
    supabase
      .from("tasks")
      .select("*")
      .is("assigned_to", null)
      .eq("metadata->>schedule_kind", "delivery")
      .order("created_at", { ascending: false })
      .limit(80)
      .returns<Task[]>(),
    // Worker journal feed: only the worker's own uploads.
    //
    // Wave X2 (00011_media_project_privacy.sql) tightens the media SELECT
    // RLS so workers also can't peek at media they did NOT upload for
    // projects they are NOT assigned to. This query is already narrower
    // than that policy (uploaded_by = self), so no code change is needed
    // here. RLS will continue to filter automatically through the SSR
    // client.
    supabase
      .from("media")
      .select("*")
      .eq("uploaded_by", user.id)
      .order("created_at", { ascending: false })
      .limit(40)
      .returns<Media[]>(),
  ]);

  assertNoError(profileResult.error, "Profile query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(eventsResult.error, "Time events query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(openDeliveryTasksResult.error, "Open delivery tasks query failed");
  assertNoError(mediaResult.error, "Media query failed");

  const profile = profileResult.data;
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

  const assignments = assignmentsResult.data ?? [];
  const events = eventsResult.data ?? [];
  const closures = (closuresResult.error ? [] : closuresResult.data ?? []).map((closure) => ({
    closedThrough: closure.closed_through,
  }));
  const personalTasks = tasksResult.data ?? [];
  const openDeliveryTasks = openDeliveryTasksResult.data ?? [];
  let media = mediaResult.data ?? [];

  const earliestEventMs = events.reduce<number | null>((earliest, event) => {
    const value = new Date(event.event_time).getTime();
    if (!Number.isFinite(value)) return earliest;
    return earliest === null ? value : Math.min(earliest, value);
  }, null);
  if (earliestEventMs !== null) {
    const checkoutMediaWindowStart = new Date(
      earliestEventMs - 15 * 60 * 1000,
    ).toISOString();
    const checkoutMediaResult = await supabase
      .from("media")
      .select("*")
      .eq("uploaded_by", user.id)
      .eq("is_checkout", true)
      .eq("media_type", "video")
      .gte("created_at", checkoutMediaWindowStart)
      .order("created_at", { ascending: false })
      .limit(160)
      .returns<Media[]>();
    assertNoError(checkoutMediaResult.error, "Checkout media query failed");

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
      const { data: visibleAssignedProjects, error } = await supabase
        .from("projects")
        .select("id")
        .in("id", [...allowedProjectIds])
        .neq("status", "archived")
        .is("deleted_at", null)
        .returns<Array<{ id: string }>>();
      assertNoError(error, "Assigned projects visibility query failed");
      const visibleIds = new Set((visibleAssignedProjects ?? []).map((project) => project.id));
      for (const projectId of [...allowedProjectIds]) {
        if (!visibleIds.has(projectId)) {
          allowedProjectIds.delete(projectId);
          projectIds.delete(projectId);
        }
      }
    }
  } else {
    const [activeProjectsResult, exclusionsResult] = await Promise.all([
      supabase
        .from("projects")
        .select("id")
        .eq("status", "active")
        .is("deleted_at", null)
        .returns<Array<{ id: string }>>(),
      supabase
        .from("project_exclusions")
        .select("project_id")
        .eq("profile_id", user.id)
        .returns<Array<{ project_id: string }>>(),
    ]);
    assertNoError(activeProjectsResult.error, "Active projects query failed");
    // project_exclusions table may not exist on a deploy that hasn't run
    // migration 00018 yet — treat that as "no exclusions" rather than a hard
    // failure so a partially-migrated environment doesn't lock workers out.
    const exclusionRows = exclusionsResult.error ? [] : (exclusionsResult.data ?? []);
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
    const { data, error } = await supabase
      .from("tasks")
      .select("*")
      .is("assigned_to", null)
      .in("project_id", [...allowedProjectIds])
      .order("created_at", { ascending: false })
      .limit(60)
      .returns<Task[]>();
    assertNoError(error, "Project-level tasks query failed");
    projectLevelTasks = data ?? [];
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
    const projectsResult = await supabase
      .from("projects")
      .select("*")
      .in("id", [...projectIds])
      .returns<Project[]>();

    assertNoError(projectsResult.error, "Projects query failed");
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
  const attachmentMap = await fetchTaskAttachments(supabase, allAttachmentIds);

  const taskItems: WorkerTaskItem[] = tasks.map((task) => {
    const ids = getAttachmentMediaIds(task);
    const resolved = ids
      .map((id) => attachmentMap.get(id))
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
});
