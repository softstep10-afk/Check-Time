import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewWorkerShellData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { buildWorkerSessions, deriveClockState, deriveWorkerSummary, enrichProjects } from "@/lib/worker-utils";
import type { WorkerMediaItem, WorkerShellData, WorkerTaskItem } from "@/lib/worker-types";
import type { Media, Profile, Project, Task, TimeEvent } from "@/types/database";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
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
    tasksResult,
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
      .limit(160)
      .returns<TimeEvent[]>(),
    supabase
      .from("tasks")
      .select("*")
      .eq("assigned_to", user.id)
      .order("created_at", { ascending: false })
      .limit(60)
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
  assertNoError(mediaResult.error, "Media query failed");

  const profile = profileResult.data;
  if (!profile) {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/login");
  }

  if (profile.role === "manager" || profile.role === "admin" || profile.role === "owner" || profile.role === "supervisor") {
    if (AUTH_BYPASS_ENABLED) {
      return buildPreviewWorkerShellData();
    }

    redirect("/overview");
  }

  const assignments = assignmentsResult.data ?? [];
  const events = eventsResult.data ?? [];
  const tasks = tasksResult.data ?? [];
  const media = mediaResult.data ?? [];

  const projectIds = new Set<string>();
  const assignedAtByProjectId = new Map<string, string | null>();

  for (const assignment of assignments) {
    if (assignment.project_id) {
      projectIds.add(assignment.project_id);
      assignedAtByProjectId.set(assignment.project_id, assignment.assigned_at ?? null);
    }
  }

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
    projects = projectsResult.data ?? [];
  }

  const workerProjects = enrichProjects(projects, assignedAtByProjectId);
  const projectsById = new Map(workerProjects.map((project) => [project.id, project]));

  const taskItems: WorkerTaskItem[] = tasks.map((task) => ({
    ...task,
    projectName: task.project_id ? projectsById.get(task.project_id)?.name ?? null : null,
  }));
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
      };
    });

  return {
    profile,
    projects: workerProjects.sort((left, right) => left.name.localeCompare(right.name)),
    tasks: taskItems,
    media: mediaItems,
    sessions,
    clockState,
    summary,
    adjustments,
  };
});
