import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewManagerWorkspaceData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/manager-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import {
  hydrateProfilesWithRates,
  PROFILE_SELECT_WITHOUT_RATE,
  profilesWithoutRates,
  withNullProfileRate,
  type ProfileWithoutRate,
} from "@/lib/profile-rates";
import type { PayPeriodItemRow, PayPeriodRow } from "@/lib/archive-utils";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type {
  Media,
  Organization,
  PayrollClosure,
  PayrollLineItem,
  PayrollRun,
  Profile,
  Project,
  ProjectAssignment,
  Task,
  TimeEvent,
} from "@/types/database";
import type { StoreVisit } from "@/lib/store-types";

export interface ArchivePageData extends ManagerWorkspaceData {
  payPeriods: PayPeriodRow[];
  payPeriodItems: PayPeriodItemRow[];
  payrollLineItems: PayrollLineItem[];
}

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

// The auth result a caller may already hold from an earlier
// `supabase.auth.getUser()` — its shape mirrors that call's
// `{ data: { user }, error }`, flattened to `{ user, error }`.
type PreresolvedManagerAuth = {
  user: Awaited<ReturnType<ServerSupabase["auth"]["getUser"]>>["data"]["user"];
  error: Awaited<ReturnType<ServerSupabase["auth"]["getUser"]>>["error"];
};

async function resolveManagerAuth(
  supabase: ServerSupabase,
): Promise<PreresolvedManagerAuth> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return { user, error };
}

// `preresolvedAuth` lets callers that already ran `supabase.auth.getUser()`
// (the manager page-data fetchers below) hand in that result instead of paying
// for a second Auth-server round-trip. When omitted — every API-route caller
// elsewhere — it resolves the user itself, exactly as before. Behavior is
// otherwise identical: same redirects, same return shape.
export async function requireManagerContext(
  supabase: ServerSupabase,
  preresolvedAuth?: PreresolvedManagerAuth,
) {
  const { user, error: authError } =
    preresolvedAuth ?? (await resolveManagerAuth(supabase));

  if (authError || !user) {
    redirect("/login");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT_WITHOUT_RATE)
    .eq("id", user.id)
    .single<ProfileWithoutRate>();

  assertNoError(profileError, "Manager profile query failed");

  if (!profile) {
    redirect("/login");
  }

  const profileWithNullRate = withNullProfileRate(profile);

  if (!isManagerRole(profileWithNullRate.role)) {
    redirect("/clock");
  }

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("*")
    .eq("id", profileWithNullRate.org_id)
    .single<Organization>();

  assertNoError(orgError, "Organization query failed");

  if (!org) {
    throw new Error("Organization not found.");
  }

  return { user, profile: profileWithNullRate, org };
}

type ManagerContext = Awaited<ReturnType<typeof requireManagerContext>>;

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

  const getWorkspaceResults = () =>
    Promise.all([
      supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITHOUT_RATE)
        .order("name", { ascending: true })
        .returns<ProfileWithoutRate[]>(),
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

  // Reuse the user already fetched above — requireManagerContext would otherwise
  // hit the Auth server a second time on every manager workspace load.
  const preresolvedAuth = { user, error: authError };
  const contextPromise =
    !authError && user ? requireManagerContext(supabase, preresolvedAuth) : null;
  const [context, workspaceResults] = contextPromise
    ? await Promise.all([contextPromise, getWorkspaceResults()])
    : [await requireManagerContext(supabase, preresolvedAuth), await getWorkspaceResults()];

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
  ] = workspaceResults;

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");
  assertNoError(mediaResult.error, "Media query failed");
  assertNoError(payrollRunsResult.error, "Payroll runs query failed");
  assertNoError(closuresResult.error, "Payroll closures query failed");

  const canReadRates = await hasFinanceAccess(supabase, {
    id: context.profile.id,
    role: context.profile.role,
  });
  const profiles = await hydrateProfilesWithRates(
    supabase,
    profilesResult.data ?? [],
    canReadRates,
    context.org.id,
  );

  return {
    manager: context.profile,
    org: context.org,
    profiles,
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
  | { preview: null; supabase: ServerSupabase; context: ManagerContext }
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

  const context = await requireManagerContext(supabase, { user, error: authError });
  return { preview: null, supabase, context };
}

async function resolveDeferredContextOrPreview(): Promise<
  | { preview: ManagerWorkspaceData }
  | { preview: null; supabase: ServerSupabase; contextPromise: Promise<ManagerContext> }
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

  const preresolvedAuth = { user, error: authError };

  if (authError || !user) {
    const context = await requireManagerContext(supabase, preresolvedAuth);
    return { preview: null, supabase, contextPromise: Promise.resolve(context) };
  }

  return {
    preview: null,
    supabase,
    contextPromise: requireManagerContext(supabase, preresolvedAuth),
  };
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
  const resolved = await resolveDeferredContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, contextPromise } = resolved;

  const since14d = isoDaysAgo(14);

  const dataPromise = Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_SELECT_WITHOUT_RATE)
      .order("name", { ascending: true })
      .returns<ProfileWithoutRate[]>(),
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
  const [context, pageResults] = await Promise.all([contextPromise, dataPromise]);
  const [profilesResult, projectsResult, assignmentsResult, tasksResult, mediaResult, timeEventsResult] = pageResults;

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(mediaResult.error, "Media query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  const canReadRates = await hasFinanceAccess(supabase, {
    id: context.profile.id,
    role: context.profile.role,
  });
  const profiles = await hydrateProfilesWithRates(
    supabase,
    profilesResult.data ?? [],
    canReadRates,
    context.org.id,
  );

  return {
    manager: context.profile,
    org: context.org,
    profiles,
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

export const getArchivePageData = cache(async (): Promise<ArchivePageData> => {
  const resolved = await resolveContextOrPreview();
  if (resolved.preview) {
    return {
      ...resolved.preview,
      payPeriods: [],
      payPeriodItems: [],
      payrollLineItems: [],
    };
  }
  const { supabase, context } = resolved;

  const [
    profilesResult,
    projectsResult,
    assignmentsResult,
    tasksResult,
    mediaResult,
    timeEventsResult,
    payrollRunsResult,
    payrollLineItemsResult,
    payrollClosuresResult,
    payPeriodsResult,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_SELECT_WITHOUT_RATE)
      .order("name", { ascending: true })
      .returns<ProfileWithoutRate[]>(),
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
      .range(0, 9999)
      .returns<Task[]>(),
    supabase
      .from("media")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 9999)
      .returns<Media[]>(),
    supabase
      .from("time_events")
      .select("*")
      .order("event_time", { ascending: false })
      .range(0, 9999)
      .returns<TimeEvent[]>(),
    supabase
      .from("payroll_runs")
      .select("*")
      .order("period_end", { ascending: false })
      .range(0, 999)
      .returns<PayrollRun[]>(),
    supabase
      .from("payroll_line_items")
      .select("*")
      .order("created_at", { ascending: false })
      .range(0, 9999)
      .returns<PayrollLineItem[]>(),
    supabase
      .from("payroll_closures")
      .select("*")
      .order("closed_through", { ascending: false })
      .range(0, 9999)
      .returns<PayrollClosure[]>(),
    supabase
      .from("pay_periods")
      .select("id, org_id, label, start_date, end_date, status, approved_by, paid_at, metadata, created_at")
      .eq("org_id", context.org.id)
      .order("end_date", { ascending: false })
      .range(0, 999)
      .returns<PayPeriodRow[]>(),
  ]);

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(mediaResult.error, "Media query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");
  assertNoError(payrollRunsResult.error, "Payroll runs query failed");
  assertNoError(payrollLineItemsResult.error, "Payroll line items query failed");
  assertNoError(payrollClosuresResult.error, "Payroll closures query failed");
  assertNoError(payPeriodsResult.error, "Pay periods query failed");

  const canReadRates = await hasFinanceAccess(supabase, {
    id: context.profile.id,
    role: context.profile.role,
  });
  const profiles = await hydrateProfilesWithRates(
    supabase,
    profilesResult.data ?? [],
    canReadRates,
    context.org.id,
  );

  const periodIds = (payPeriodsResult.data ?? []).map((period) => period.id);
  const payPeriodItemsResult = periodIds.length > 0
    ? await supabase
        .from("pay_period_items")
        .select("id, pay_period_id, worker_id, rate, regular_hours, overtime_hours, gross_total, net_total, status, created_at")
        .in("pay_period_id", periodIds)
        .order("created_at", { ascending: false })
        .range(0, 9999)
        .returns<PayPeriodItemRow[]>()
    : { data: [] as PayPeriodItemRow[], error: null };

  assertNoError(payPeriodItemsResult.error, "Pay period items query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles,
    projects: projectsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    tasks: tasksResult.data ?? [],
    timeEvents: timeEventsResult.data ?? [],
    media: mediaResult.data ?? [],
    payrollRuns: payrollRunsResult.data ?? [],
    payrollClosures: payrollClosuresResult.data ?? [],
    storeVisits: [],
    payPeriods: payPeriodsResult.data ?? [],
    payPeriodItems: payPeriodItemsResult.data ?? [],
    payrollLineItems: payrollLineItemsResult.data ?? [],
  };
});

/**
 * Team page + team/[id]. Needs profile directory, project names, the
 * worker's recent shifts (last 14 days), and their store visits. Skips
 * media and payroll.
 */
export const getTeamPageData = cache(async (): Promise<ManagerWorkspaceData> => {
  const resolved = await resolveDeferredContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, contextPromise } = resolved;

  const since14d = isoDaysAgo(14);

  const dataPromise = Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_SELECT_WITHOUT_RATE)
      .order("name", { ascending: true })
      .returns<ProfileWithoutRate[]>(),
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
  const [context, pageResults] = await Promise.all([contextPromise, dataPromise]);
  const [profilesResult, projectsResult, assignmentsResult, tasksResult, timeEventsResult, storeVisitsResult] =
    pageResults;

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(assignmentsResult.error, "Assignments query failed");
  assertNoError(tasksResult.error, "Tasks query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  const canReadRates = await hasFinanceAccess(supabase, {
    id: context.profile.id,
    role: context.profile.role,
  });
  const profiles = await hydrateProfilesWithRates(
    supabase,
    profilesResult.data ?? [],
    canReadRates,
    context.org.id,
  );

  return {
    manager: context.profile,
    org: context.org,
    profiles,
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
      supabase
        .from("profiles")
        .select(PROFILE_SELECT_WITHOUT_RATE)
        .order("name", { ascending: true })
        .returns<ProfileWithoutRate[]>(),
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

  const canReadRates = await hasFinanceAccess(supabase, {
    id: context.profile.id,
    role: context.profile.role,
  });
  const profiles = await hydrateProfilesWithRates(
    supabase,
    profilesResult.data ?? [],
    canReadRates,
    context.org.id,
  );

  return {
    manager: context.profile,
    org: context.org,
    profiles,
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
  const resolved = await resolveDeferredContextOrPreview();
  if (resolved.preview) return resolved.preview;
  const { supabase, contextPromise } = resolved;

  const dataPromise = Promise.all([
    supabase
      .from("profiles")
      .select(PROFILE_SELECT_WITHOUT_RATE)
      .order("name", { ascending: true })
      .returns<ProfileWithoutRate[]>(),
    supabase.from("projects").select("*").order("name", { ascending: true }).returns<Project[]>(),
    supabase
      .from("time_events")
      .select("*")
      .order("event_time", { ascending: false })
      .range(0, 499)
      .returns<TimeEvent[]>(),
  ]);
  const [context, pageResults] = await Promise.all([contextPromise, dataPromise]);
  const [profilesResult, projectsResult, timeEventsResult] = pageResults;

  assertNoError(profilesResult.error, "Profiles query failed");
  assertNoError(projectsResult.error, "Projects query failed");
  assertNoError(timeEventsResult.error, "Time events query failed");

  return {
    manager: context.profile,
    org: context.org,
    profiles: profilesWithoutRates(profilesResult.data ?? []),
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
