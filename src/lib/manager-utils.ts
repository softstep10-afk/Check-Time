import type { UserRole } from "@/types/database";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
  ManagerTimelineItem,
  ManagerWorkspaceData,
  PayrollPreview,
  PayrollPreviewLine,
  PayrollWorkerTotal,
} from "@/lib/manager-types";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDate(value: string): Date {
  return new Date(value);
}

function isSameOrAfter(left: Date, right: Date): boolean {
  return left.getTime() >= right.getTime();
}

function startOfWeek(date = new Date()): Date {
  const base = new Date(date);
  const day = base.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() + mondayOffset);
  return base;
}

function endOfDay(date = new Date()): Date {
  const base = new Date(date);
  base.setHours(23, 59, 59, 999);
  return base;
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function isManagerRole(role: UserRole): boolean {
  return role === "manager" || role === "admin" || role === "owner";
}

export function buildManagerSessions(data: ManagerWorkspaceData): ManagerSession[] {
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const eventsByProfile = new Map<string, typeof data.timeEvents>();

  for (const event of data.timeEvents) {
    const profileEvents = eventsByProfile.get(event.profile_id) ?? [];
    profileEvents.push(event);
    eventsByProfile.set(event.profile_id, profileEvents);
  }

  const sessions: ManagerSession[] = [];

  for (const [profileId, profileEvents] of eventsByProfile.entries()) {
    const profile = profilesById.get(profileId);
    if (!profile) {
      continue;
    }

    const orderedEvents = [...profileEvents].sort((left, right) => {
      return toDate(left.event_time).getTime() - toDate(right.event_time).getTime();
    });
    let openClockIn = null as (typeof orderedEvents)[number] | null;

    for (const event of orderedEvents) {
      if (event.event_type === "clock_in") {
        openClockIn = event;
        continue;
      }

      if (event.event_type !== "clock_out" && event.event_type !== "auto_out") {
        continue;
      }

      if (!openClockIn) {
        continue;
      }

      const project = projectsById.get(openClockIn.project_id);
      const clockInTime = toDate(openClockIn.event_time);
      const clockOutTime = toDate(event.event_time);

      sessions.push({
        id: openClockIn.id,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        projectId: openClockIn.project_id,
        projectName: project?.name ?? "Unknown project",
        clockInEventId: openClockIn.id,
        clockOutEventId: event.id,
        clockInTime: openClockIn.event_time,
        clockOutTime: event.event_time,
        durationMinutes: minutesBetween(clockInTime, clockOutTime),
        checkoutStatus: event.video_status,
        isOpen: false,
        eventIds: [openClockIn.id, event.id],
      });

      openClockIn = null;
    }

    if (openClockIn) {
      const project = projectsById.get(openClockIn.project_id);
      sessions.push({
        id: openClockIn.id,
        profileId: profile.id,
        profileName: profile.name,
        profileRole: profile.role,
        projectId: openClockIn.project_id,
        projectName: project?.name ?? "Unknown project",
        clockInEventId: openClockIn.id,
        clockOutEventId: null,
        clockInTime: openClockIn.event_time,
        clockOutTime: null,
        durationMinutes: minutesBetween(toDate(openClockIn.event_time), new Date()),
        checkoutStatus: "not_required",
        isOpen: true,
        eventIds: [openClockIn.id],
      });
    }
  }

  return sessions.sort((left, right) => {
    return toDate(right.clockInTime).getTime() - toDate(left.clockInTime).getTime();
  });
}

export function buildProjectSummaries(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
): ManagerProjectSummary[] {
  const weekStart = startOfWeek();
  const assignmentsByProject = new Map<string, Set<string>>();
  const openTasksByProject = new Map<string, number>();
  const onSiteByProject = new Map<string, Set<string>>();
  const weekMinutesByProject = new Map<string, number>();

  for (const assignment of data.assignments) {
    const ids = assignmentsByProject.get(assignment.project_id) ?? new Set<string>();
    ids.add(assignment.profile_id);
    assignmentsByProject.set(assignment.project_id, ids);
  }

  for (const task of data.tasks) {
    if (!task.project_id || task.status === "done" || task.status === "cancelled") {
      continue;
    }

    openTasksByProject.set(
      task.project_id,
      (openTasksByProject.get(task.project_id) ?? 0) + 1,
    );
  }

  for (const session of sessions) {
    if (session.isOpen) {
      const ids = onSiteByProject.get(session.projectId) ?? new Set<string>();
      ids.add(session.profileId);
      onSiteByProject.set(session.projectId, ids);
    }

    if (isSameOrAfter(toDate(session.clockInTime), weekStart)) {
      weekMinutesByProject.set(
        session.projectId,
        (weekMinutesByProject.get(session.projectId) ?? 0) + session.durationMinutes,
      );
    }
  }

  return data.projects
    .map((project) => ({
      ...project,
      assignedWorkerCount: assignmentsByProject.get(project.id)?.size ?? 0,
      onSiteWorkerCount: onSiteByProject.get(project.id)?.size ?? 0,
      openTaskCount: openTasksByProject.get(project.id) ?? 0,
      weekMinutes: weekMinutesByProject.get(project.id) ?? 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildProfileSummaries(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
): ManagerProfileSummary[] {
  const weekStart = startOfWeek();
  const assignmentsByProfile = new Map<string, string[]>();
  const openTasksByProfile = new Map<string, number>();
  const weekMinutesByProfile = new Map<string, number>();
  const openSessionsByProfile = new Map<string, ManagerSession>();
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));

  for (const assignment of data.assignments) {
    const ids = assignmentsByProfile.get(assignment.profile_id) ?? [];
    ids.push(assignment.project_id);
    assignmentsByProfile.set(assignment.profile_id, ids);
  }

  for (const task of data.tasks) {
    if (!task.assigned_to || task.status === "done" || task.status === "cancelled") {
      continue;
    }

    openTasksByProfile.set(
      task.assigned_to,
      (openTasksByProfile.get(task.assigned_to) ?? 0) + 1,
    );
  }

  for (const session of sessions) {
    if (session.isOpen) {
      openSessionsByProfile.set(session.profileId, session);
    }

    if (isSameOrAfter(toDate(session.clockInTime), weekStart)) {
      weekMinutesByProfile.set(
        session.profileId,
        (weekMinutesByProfile.get(session.profileId) ?? 0) + session.durationMinutes,
      );
    }
  }

  return data.profiles
    .map((profile) => {
      const assignedProjectIds = assignmentsByProfile.get(profile.id) ?? [];
      const currentSession = openSessionsByProfile.get(profile.id) ?? null;

      return {
        ...profile,
        assignedProjectIds,
        assignedProjectNames: assignedProjectIds
          .map((projectId) => projectsById.get(projectId)?.name)
          .filter((value): value is string => Boolean(value)),
        currentProjectName: profile.current_project
          ? projectsById.get(profile.current_project)?.name ?? null
          : null,
        openTaskCount: openTasksByProfile.get(profile.id) ?? 0,
        weekMinutes: weekMinutesByProfile.get(profile.id) ?? 0,
        isOnSite: Boolean(currentSession),
        currentSessionMinutes: currentSession?.durationMinutes ?? null,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function buildTimelineItems(data: ManagerWorkspaceData): ManagerTimelineItem[] {
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));

  return [...data.timeEvents]
    .sort((left, right) => {
      return toDate(right.event_time).getTime() - toDate(left.event_time).getTime();
    })
    .map((event) => {
      const profile = profilesById.get(event.profile_id);
      const project = projectsById.get(event.project_id);

      return {
        ...event,
        profileName: profile?.name ?? "Unknown worker",
        profileRole: profile?.role ?? "worker",
        projectName: project?.name ?? "Unknown project",
      };
    });
}

export function getOverviewStats(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  projectSummaries: ManagerProjectSummary[],
  profileSummaries: ManagerProfileSummary[],
) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const unpaidPreview = computePayrollPreview(data, sessions);
  const todayMinutes = sessions.reduce((sum, session) => {
    if (isSameOrAfter(toDate(session.clockInTime), todayStart)) {
      return sum + session.durationMinutes;
    }

    return sum;
  }, 0);

  return {
    onSiteCount: profileSummaries.filter((profile) => profile.isOnSite).length,
    activeProjectCount: projectSummaries.filter((project) => project.status === "active").length,
    openTaskCount: data.tasks.filter(
      (task) => task.status !== "done" && task.status !== "cancelled",
    ).length,
    crewCount: data.profiles.length,
    todayHours: roundCurrency(todayMinutes / 60),
    unpaidHours: unpaidPreview.totalHours,
    unpaidAmount: unpaidPreview.totalAmount,
  };
}

export function normalisePeriodEnd(periodEnd?: string): string {
  if (periodEnd) {
    return endOfDay(new Date(`${periodEnd}T12:00:00`)).toISOString();
  }

  return endOfDay(new Date()).toISOString();
}

export function computePayrollPreview(
  data: ManagerWorkspaceData,
  sessions: ManagerSession[],
  periodEndInput?: string,
): PayrollPreview {
  const periodEnd = toDate(normalisePeriodEnd(periodEndInput));
  const latestClosureByProfile = new Map<string, Date>();

  for (const closure of data.payrollClosures) {
    const closureTime = toDate(closure.closed_through);
    const current = latestClosureByProfile.get(closure.profile_id);

    if (!current || closureTime.getTime() > current.getTime()) {
      latestClosureByProfile.set(closure.profile_id, closureTime);
    }
  }

  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const linesByKey = new Map<string, PayrollPreviewLine>();
  let earliestWindowStart = periodEnd.toISOString();

  for (const session of sessions) {
    const sessionStart = toDate(session.clockInTime);
    const sessionEnd = toDate(session.clockOutTime ?? new Date().toISOString());

    if (sessionStart.getTime() > periodEnd.getTime()) {
      continue;
    }

    const effectiveEnd = new Date(Math.min(sessionEnd.getTime(), periodEnd.getTime()));
    const latestClosure = latestClosureByProfile.get(session.profileId);
    const payableStart = new Date(
      Math.max(
        sessionStart.getTime(),
        latestClosure ? latestClosure.getTime() : Number.NEGATIVE_INFINITY,
      ),
    );

    if (effectiveEnd.getTime() <= payableStart.getTime()) {
      continue;
    }

    const minutes = minutesBetween(payableStart, effectiveEnd);
    if (minutes <= 0) {
      continue;
    }

    if (payableStart.toISOString() < earliestWindowStart) {
      earliestWindowStart = payableStart.toISOString();
    }

    const profile = data.profiles.find((entry) => entry.id === session.profileId);
    const project = projectsById.get(session.projectId);
    if (!profile || !project) {
      continue;
    }

    const rate = Number(profile.hourly_rate ?? project.rate ?? 0);
    const hours = roundCurrency(minutes / 60);
    const amount = roundCurrency(hours * rate);
    const key = `${profile.id}:${project.id}:${rate.toFixed(2)}`;
    const existing = linesByKey.get(key);

    if (existing) {
      existing.minutes += minutes;
      existing.hours = roundCurrency(existing.minutes / 60);
      existing.amount = roundCurrency(existing.hours * existing.rate);
      existing.sessionIds.push(session.id);
      existing.eventIds.push(...session.eventIds);
      continue;
    }

    linesByKey.set(key, {
      profileId: profile.id,
      profileName: profile.name,
      profileRole: profile.role,
      projectId: project.id,
      projectName: project.name,
      minutes,
      hours,
      rate,
      amount,
      sessionIds: [session.id],
      eventIds: [...session.eventIds],
    });
  }

  const lines = [...linesByKey.values()].sort((left, right) => {
    if (left.profileName === right.profileName) {
      return left.projectName.localeCompare(right.projectName);
    }

    return left.profileName.localeCompare(right.profileName);
  });
  const workerTotalsById = new Map<string, PayrollWorkerTotal>();

  for (const line of lines) {
    const current = workerTotalsById.get(line.profileId);
    if (current) {
      current.hours = roundCurrency(current.hours + line.hours);
      current.amount = roundCurrency(current.amount + line.amount);
      current.lines.push(line);
      continue;
    }

    workerTotalsById.set(line.profileId, {
      profileId: line.profileId,
      profileName: line.profileName,
      profileRole: line.profileRole,
      hours: line.hours,
      amount: line.amount,
      lines: [line],
    });
  }

  const workerTotals = [...workerTotalsById.values()].sort((left, right) => {
    return left.profileName.localeCompare(right.profileName);
  });
  const totalHours = roundCurrency(lines.reduce((sum, line) => sum + line.hours, 0));
  const totalAmount = roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0));

  return {
    periodStart: earliestWindowStart,
    periodEnd: periodEnd.toISOString(),
    totalHours,
    totalAmount,
    workersCount: workerTotals.length,
    lineCount: lines.length,
    lines,
    workerTotals,
  };
}
