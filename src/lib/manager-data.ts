import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewManagerWorkspaceData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/manager-utils";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Media,
  Organization,
  PayrollClosure,
  PayrollRun,
  Profile,
  Project,
  ProjectAssignment,
  Task,
  TimeEvent,
} from "@/types/database";
import type { StoreVisit } from "@/lib/store-types";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function requireManagerContext(supabase: ServerSupabase) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  assertNoError(profileError, "Manager profile query failed");

  if (!profile) {
    redirect("/login");
  }

  if (!isManagerRole(profile.role)) {
    redirect("/clock");
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profile.org_id)
    .single<Organization>();

  assertNoError(orgError, "Organization query failed");

  if (!org) {
    throw new Error("Organization not found.");
  }

  return { user, profile, org };
}

export const getManagerWorkspaceData = cache(async (): Promise<ManagerWorkspaceData> => {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return buildPreviewManagerWorkspaceData();
  }

  if (AUTH_BYPASS_ENABLED && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<Pick<Profile, "role">>();

    if (!profile || !isManagerRole(profile.role)) {
      return buildPreviewManagerWorkspaceData();
    }
  }

  const context = await requireManagerContext(supabase);

  const [
    profilesResult,
    projectsResult,
    assignmentsResult,
    tasksResult,
    timeEventsResult,
    mediaResult,
    payrollRunsResult,
    closuresResult,
    storeVisitsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .order("name", { ascending: true })
      .returns<Profile[]>(),
    supabase
      .from("projects")
      .select("*")
      .order("name", { ascending: true })
      .returns<Project[]>(),
    supabase
      .from("project_assignments")
      .select("*")
      .order("assigned_at", { ascending: false })
      .returns<ProjectAssignment[]>(),
    supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 399)
      .returns<Task[]>(),
    supabase
      .from("time_events")
      .select("*")
      .order("event_time", { ascending: false })
      .range(0, 4999)
      .returns<TimeEvent[]>(),
    supabase
      .from("media")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 399)
      .returns<Media[]>(),
    supabase
      .from("payroll_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 49)
      .returns<PayrollRun[]>(),
    supabase
      .from("payroll_closures")
      .select("*")
      .order("closed_through", { ascending: false })
      .range(0, 999)
      .returns<PayrollClosure[]>(),
    // store_visits is optional — table may not exist yet in older envs.
    supabase
      .from("store_visits")
      .select("*")
      .order("entered_at", { ascending: false })
      .range(0, 199)
      .returns<StoreVisit[]>(),
  ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");
  assertNoError(mediaResult.error, "Media query failed");
  assertNoError(payrollRunsResult.error, "Payroll runs query failed");
  assertNoError(closuresResult.error, "Payroll closures query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    timeEvents: timeEventsResult.data ?? [],
    media: mediaResult.data ?? [],
    payrollRuns: payrollRunsResult.data ?? [],
    payrollClosures: closuresResult.data ?? [],
    storeVisits: storeVisitsResult.error ? [] : storeVisitsResult.data ?? [],
  };
});

/**
 * Shared auth gate for the page-specific fetchers below. Returns the
 * preview workspace when AUTH_BYPASS is on and the caller is anonymous
 * or not a manager; otherwise returns { supabase, context } for the
 * caller to run its narrower queries.
 */
async function resolveContextOrPreview(): Promise<
  | { preview: ManagerWorkspaceData }
  | { preview: null; supabase: ServerSupabase; context: Awaited<ReturnType<typeof requireManagerContext>> }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (AUTH_BYPASS_ENABLED && (authError || !user)) {
    return { preview: buildPreviewManagerWorkspaceData() };
  }
  if (AUTH_BYPASS_ENABLED && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single<Pick<Profile, "role">>();
    if (!profile || !isManagerRole(profile.role)) {
      return { preview: buildPreviewManagerWorkspaceData() };
    }
  }

  const context = await requireManagerContext(supabase);
  return { preview: null, supabase, context };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Projects / Tasks / Project-Detail pages. Fetches the project-facing
 * tables plus a narrow 14-day window of time_events — the window is
 * the minimum needed for buildManagerSessions() / buildProjectSummaries()
 * to compute:
 *   - onSiteWorkerCount     (open sessions right now)
 *   - weekMinutes           (current Mon-Sun always fits in 14 days)
 *   - lastActivityTime      (most-recent event per project)
 *   - activityState()       (live / open / stale thresholds)
 * Without this the projects page showed 0 on-site, 0 week hours, and a
 * null lastActivityTime for every card, which forced every traffic-
 * light activity dot to read cold and broke the "sort by activity" and
 * "sort by week" options. Payroll tables + store_visits are still
 * skipped — they're not read on these pages.
 */
export const getProjectsPageData = cache(async (): Promise<ManagerWorkspaceData> => {
  const resolved = await resolveContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, context } = resolved;

  const since14d = isoDaysAgo(14);

  const [
    profilesResult,
    projectsResult,
    assignmentsResult,
    tasksResult,
    mediaResult,
    timeEventsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("*").order("name", { ascending: true }).returns<Profile[]>(),
    supabase.from("projects").select("*").order("name", { ascending: true }).returns<Project[]>(),
    supabase
      .from("project_assignments")
      .select("*")
      .order("assigned_at", { ascending: false })
      .returns<ProjectAssignment[]>(),
    supabase
      .from("tasks")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 199)
      .returns<Task[]>(),
    supabase
      .from("media")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 149)
      .returns<Media[]>(),
    supabase
      .from("time_events")
      .select("*")
      .gte("event_time", since14d)
      .order("event_time", { ascending: false })
      .range(0, 499)
      .returns<TimeEvent[]>(),
  ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(mediaResult.error, "Media query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    timeEvents: timeEventsResult.data ?? [],
    media: mediaResult.data ?? [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: [],
  };
});

/**
 * Team page + team/[id]. Needs profile directory, project names, the
 * worker's recent shifts (last 14 days), and their store visits. Skips
 * media and payroll.
 */
export const getTeamPageData = cache(async (): Promise<ManagerWorkspaceData> => {
  const resolved = await resolveContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, context } = resolved;

  const since14d = isoDaysAgo(14);

  const [profilesResult, projectsResult, assignmentsResult, tasksResult, timeEventsResult, storeVisitsResult] =
    await Promise.all([
      supabase.from("profiles").select("*").order("name", { ascending: true }).returns<Profile[]>(),
      supabase.from("projects").select("*").order("name", { ascending: true }).returns<Project[]>(),
      supabase
        .from("project_assignments")
        .select("*")
        .order("assigned_at", { ascending: false })
        .returns<ProjectAssignment[]>(),
      supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, 99)
        .returns<Task[]>(),
      supabase
        .from("time_events")
        .select("*")
        .gte("event_time", since14d)
        .order("event_time", { ascending: false })
        .range(0, 299)
        .returns<TimeEvent[]>(),
      supabase
        .from("store_visits")
        .select("*")
        .order("entered_at", { ascending: false })
        .range(0, 49)
        .returns<StoreVisit[]>(),
    ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    timeEvents: timeEventsResult.data ?? [],
    media: [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: storeVisitsResult.error ? [] : storeVisitsResult.data ?? [],
  };
});

/**
 * Payroll page. Needs enough time_events to cover the viewable period
 * (90 days), plus payroll_runs / payroll_closures. Skips tasks, media,
 * assignments, and store visits.
 */
export const getPayrollPageData = cache(async (): Promise<ManagerWorkspaceData> => {
  const resolved = await resolveContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, context } = resolved;

  const since90d = isoDaysAgo(90);

  const [profilesResult, projectsResult, timeEventsResult, payrollRunsResult, closuresResult] =
    await Promise.all([
      supabase.from("profiles").select("*").order("name", { ascending: true }).returns<Profile[]>(),
      supabase.from("projects").select("*").order("name", { ascending: true }).returns<Project[]>(),
      supabase
        .from("time_events")
        .select("*")
        .gte("event_time", since90d)
        .order("event_time", { ascending: false })
        .range(0, 1999)
        .returns<TimeEvent[]>(),
      supabase
        .from("payroll_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .range(0, 19)
        .returns<PayrollRun[]>(),
      supabase
        .from("payroll_closures")
        .select("*")
        .order("closed_through", { ascending: false })
        .range(0, 99)
        .returns<PayrollClosure[]>(),
    ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");
  assertNoError(payrollRunsResult.error, "Payroll runs query failed");
  assertNoError(closuresResult.error, "Payroll closures query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: [],
    tasks: [],
    timeEvents: timeEventsResult.data ?? [],
    media: [],
    payrollRuns: payrollRunsResult.data ?? [],
    payrollClosures: closuresResult.data ?? [],
    storeVisits: [],
  };
});

/**
 * Timeline page. Needs profile directory + project names + a bounded
 * time_events slice. Skips everything else.
 */
export const getTimelinePageData = cache(async (): Promise<ManagerWorkspaceData> => {
  const resolved = await resolveContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, context } = resolved;

  const [profilesResult, projectsResult, timeEventsResult] = await Promise.all([
    supabase.from("profiles").select("*").order("name", { ascending: true }).returns<Profile[]>(),
    supabase.from("projects").select("*").order("name", { ascending: true }).returns<Project[]>(),
    supabase
      .from("time_events")
      .select("*")
      .order("event_time", { ascending: false })
      .range(0, 499)
      .returns<TimeEvent[]>(),
  ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesResult.data ?? [],
    projects: projectsResult.data ?? [],
    assignments: [],
    tasks: [],
    timeEvents: timeEventsResult.data ?? [],
    media: [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: [],
  };
});
