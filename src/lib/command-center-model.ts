import {
  buildActiveProjectIdSet,
  getActiveOperationalProjects,
  getActiveOperationalTasks,
} from "@/lib/archive-utils";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  detectTransferGaps,
  getOverviewStats,
  isOpenTask,
  TRANSFER_GAP_COLOR,
  type TransferGap,
} from "@/lib/manager-utils";
import type {
  ManagerProfileSummary,
  ManagerProjectSummary,
  ManagerSession,
  ManagerWorkspaceData,
} from "@/lib/manager-types";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { formatDurationCompact } from "@/lib/worker-utils";
import {
  deriveShiftReview,
  type ShiftReview,
  type ShiftReviewStatus,
} from "@/lib/shift-review";
import type { GpsFreshness } from "@/lib/gps-freshness";
import type { Project, Task, TimeEvent } from "@/types/database";
import {
  buildCommandCenterQueue,
  type CommandCenterActionItem as BaseCommandCenterActionItem,
  type CommandCenterQueue,
} from "@/lib/command-center";

const priorityRank = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

const reviewPriorityRank: Record<ShiftReviewStatus, number> = {
  needs_review: 0,
  video_missing: 1,
  gps_lost: 2,
  no_gps: 3,
  gps_stale: 4,
  long_shift: 5,
  normal: 6,
};

export type CommandCenterActionKind =
  | "open_shift"
  | "closed_shift"
  | "travel_gap"
  | "task";

export type CommandCenterActionItem = CommandCenterActionItemBase & {
  kind: CommandCenterActionKind;
  entityId: string;
};

type CommandCenterActionItemBase = BaseCommandCenterActionItem;

export type CommandCenterOnSiteSession = ManagerSession & {
  todayMinutes: number;
  projectAddress: string | null;
  hadGpsAtClockIn: boolean;
};

export type CommandCenterClosedShiftAlert = ManagerSession & {
  review: ShiftReview;
};

export type CommandCenterLabels = {
  actionShift: string;
  actionTravelGap: string;
  actionTask: string;
  generalTask: string;
  shiftReviewLabel: Record<ShiftReviewStatus, string>;
};

export type CommandCenterBase = {
  data: ManagerWorkspaceData;
  sessions: ManagerSession[];
  activeProjectIds: Set<string>;
  activeSessions: ManagerSession[];
  activeTasks: Task[];
  activeProjects: Project[];
  projectSummaries: ManagerProjectSummary[];
  profileSummaries: ManagerProfileSummary[];
  stats: ReturnType<typeof getOverviewStats>;
  projectsById: Map<string, Project>;
  profilesById: Map<string, ManagerWorkspaceData["profiles"][number]>;
  clockInEventsById: Map<string, TimeEvent>;
  todayStartIso: string;
  onSiteSessions: CommandCenterOnSiteSession[];
};

export type CommandCenterModel = CommandCenterBase & {
  actionItems: CommandCenterActionItem[];
  commandQueue: CommandCenterQueue & {
    allItems: CommandCenterActionItem[];
    visibleItems: CommandCenterActionItem[];
    primaryAction: CommandCenterActionItem | null;
  };
  shiftReviewByProfileId: Map<string, ShiftReview>;
  closedShiftAlerts: CommandCenterClosedShiftAlert[];
  travelGaps: TransferGap[];
  urgentTasks: Task[];
  highPriorityTaskCount: number;
  projectsWithCrewCount: number;
  criticalActionCount: number;
  needsReviewCount: number;
  primaryAction: CommandCenterActionItem | null;
};

function todayStartIso(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function buildCommandCenterBase(
  data: ManagerWorkspaceData,
  options: {
    includeFinancials?: boolean;
    now?: Date;
  } = {},
): CommandCenterBase {
  const includeFinancials = options.includeFinancials ?? true;
  const sessions = buildManagerSessions(data);
  const activeProjectIds = buildActiveProjectIdSet(data.projects);
  const activeSessions = sessions.filter((session) => activeProjectIds.has(session.projectId));
  const activeTasks = getActiveOperationalTasks(data.tasks, data.projects);
  const activeProjects = getActiveOperationalProjects(data.projects);
  const projectSummaries = getActiveOperationalProjects(buildProjectSummaries(data, activeSessions, {
    includeFinancials,
  }));
  const profileSummaries = buildProfileSummaries(data, activeSessions);
  const stats = getOverviewStats(data, activeSessions, projectSummaries, profileSummaries, {
    includeFinancials,
  });
  const projectsById = new Map(data.projects.map((project) => [project.id, project]));
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const clockInEventsById = new Map(
    data.timeEvents
      .filter((event) => event.event_type === "clock_in")
      .map((event) => [event.id, event]),
  );
  const onSiteSessions = activeSessions
    .filter((session) => session.isOpen)
    .map((session) => {
      const project = projectsById.get(session.projectId);
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      return {
        ...session,
        todayMinutes: session.durationMinutes,
        projectAddress: project?.address ?? null,
        hadGpsAtClockIn: clockInEvent?.gps_point != null,
      };
    });

  return {
    data,
    sessions,
    activeProjectIds,
    activeSessions,
    activeTasks,
    activeProjects,
    projectSummaries,
    profileSummaries,
    stats,
    projectsById,
    profilesById,
    clockInEventsById,
    todayStartIso: todayStartIso(options.now),
    onSiteSessions,
  };
}

export function buildCommandCenterModel({
  base,
  labels,
  gpsFreshnessByProfileId = new Map<string, GpsFreshness>(),
  queueLimit = 6,
}: {
  base: CommandCenterBase;
  labels: CommandCenterLabels;
  gpsFreshnessByProfileId?: Map<string, GpsFreshness>;
  queueLimit?: number;
}): CommandCenterModel {
  const shiftReviewByProfileId = new Map<string, ShiftReview>();
  for (const session of base.onSiteSessions) {
    const profile = base.profilesById.get(session.profileId);
    shiftReviewByProfileId.set(
      session.profileId,
      deriveShiftReview({
        isOpen: true,
        durationMinutes: session.todayMinutes,
        hadGpsAtClockIn: session.hadGpsAtClockIn,
        gpsFreshness: gpsFreshnessByProfileId.get(session.profileId) ?? null,
        requireVideo: profile?.require_video ?? false,
        videoStatus: "not_required",
      }),
    );
  }

  const closedShiftAlerts = base.activeSessions
    .filter((session) => !session.isOpen)
    .map((session) => {
      const profile = base.profilesById.get(session.profileId);
      const clockInEvent = base.clockInEventsById.get(session.clockInEventId);
      const review = deriveShiftReview({
        isOpen: false,
        durationMinutes: session.durationMinutes,
        hadGpsAtClockIn: clockInEvent?.gps_point != null,
        gpsFreshness: null,
        requireVideo: profile?.require_video ?? false,
        videoStatus: session.checkoutStatus,
      });
      return { ...session, review };
    })
    .filter((session) => session.review.status !== "normal")
    .sort((left, right) => {
      const statusGap =
        reviewPriorityRank[left.review.status] - reviewPriorityRank[right.review.status];
      if (statusGap !== 0) return statusGap;
      return right.durationMinutes - left.durationMinutes;
    })
    .slice(0, 12);

  const travelGaps = detectTransferGaps({
    timeEvents: base.data.timeEvents.filter((event) => base.activeProjectIds.has(event.project_id)),
    projects: base.activeProjects,
    profiles: base.data.profiles,
    sinceIso: base.todayStartIso,
  });

  const urgentTasks = [...base.activeTasks]
    .filter(isOpenTask)
    .sort((left, right) => {
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) return priorityGap;
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    })
    .slice(0, 12);

  const actionItems: CommandCenterActionItem[] = [
    ...base.onSiteSessions
      .map((session) => {
        const review = shiftReviewByProfileId.get(session.profileId);
        if (!review || review.status === "normal") return null;
        const reasonLabels = review.reasons
          .map((reason) => labels.shiftReviewLabel[reason])
          .join(", ");
        const isCritical =
          review.status === "needs_review" ||
          review.status === "video_missing" ||
          review.status === "gps_lost";
        return {
          id: `open-shift-${session.id}`,
          kind: "open_shift" as const,
          entityId: session.profileId,
          label: labels.actionShift,
          title: session.profileName,
          detail: `${session.projectName} · ${formatDurationCompact(session.todayMinutes)} · ${reasonLabels || labels.shiftReviewLabel[review.status]}`,
          href: `/team/${session.profileId}`,
          severity: isCritical ? 0 as const : 1 as const,
          color: isCritical ? "var(--red)" : "#f59e0b",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
    ...closedShiftAlerts.map((session) => {
      const reasonLabels = session.review.reasons
        .map((reason) => labels.shiftReviewLabel[reason])
        .join(", ");
      return {
        id: `closed-shift-${session.id}`,
        kind: "closed_shift" as const,
        entityId: session.profileId,
        label: labels.actionShift,
        title: session.profileName,
        detail: `${session.projectName} · ${formatDurationCompact(session.durationMinutes)} · ${reasonLabels}`,
        href: `/team/${session.profileId}`,
        severity: 0 as const,
        color: "var(--red)",
      };
    }),
    ...travelGaps.map((gap) => ({
      id: `gap-${gap.id}`,
      kind: "travel_gap" as const,
      entityId: gap.profileId,
      label: labels.actionTravelGap,
      title: gap.workerName,
      detail: `${gap.fromProject} -> ${gap.toProject} · ${formatDurationCompact(gap.gapMinutes)}`,
      href: `/team/${gap.profileId}`,
      severity: gap.severity === "critical" ? 0 as const : 1 as const,
      color: TRANSFER_GAP_COLOR[gap.severity],
    })),
    ...urgentTasks
      .filter((task) => task.priority === "urgent" || task.priority === "high")
      .map((task) => {
        const project = task.project_id ? base.projectsById.get(task.project_id) : null;
        const effectiveStatus = getEffectiveTaskStatus(task);
        return {
          id: `task-${task.id}`,
          kind: "task" as const,
          entityId: task.id,
          label: labels.actionTask,
          title: task.title,
          detail: `${project?.name ?? labels.generalTask} · ${effectiveStatus}`,
          href: task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks",
          severity: task.priority === "urgent" ? 0 as const : 1 as const,
          color: task.priority === "urgent" ? "var(--red)" : "#f59e0b",
        };
      }),
  ];

  const commandQueue = buildCommandCenterQueue(actionItems, { limit: queueLimit }) as CommandCenterModel["commandQueue"];
  const highPriorityTaskCount = urgentTasks.filter((task) => (
    task.priority === "urgent" || task.priority === "high"
  )).length;
  const projectsWithCrewCount = base.projectSummaries.filter((project) => (
    project.onSiteWorkerCount > 0
  )).length;
  const needsReviewCount = [...shiftReviewByProfileId.values()].filter((review) => (
    review.status === "needs_review"
  )).length;

  return {
    ...base,
    actionItems,
    commandQueue,
    shiftReviewByProfileId,
    closedShiftAlerts,
    travelGaps,
    urgentTasks,
    highPriorityTaskCount,
    projectsWithCrewCount,
    criticalActionCount: commandQueue.criticalCount,
    needsReviewCount,
    primaryAction: commandQueue.primaryAction,
  };
}
