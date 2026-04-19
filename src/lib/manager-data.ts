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
