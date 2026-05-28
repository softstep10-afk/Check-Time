import Link from "next/link";
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FolderKanban,
  MapPin,
  MessageSquare,
  RadioTower,
  Sparkles,
  Users,
  Wallet,
  AlertTriangle,
} from "lucide-react";
import { BulkMessageComposer } from "@/components/manager/BulkMessageComposer";
import { ManagerTasksPage } from "@/components/manager/ManagerTasksPage";
import { OverviewLiveIndicator } from "@/components/manager/OverviewLiveIndicator";
import {
  buildActiveProjectIdSet,
  getActiveOperationalProjects,
  isTaskInActiveOperations,
} from "@/lib/archive-utils";
import { getProjectsPageData } from "@/lib/manager-data";
import { buildManagerSessions, buildProjectSummaries, isOpenTask } from "@/lib/manager-utils";
import { createClient } from "@/lib/supabase/server";
import { deriveGpsFreshness, formatGpsAge, GPS_FRESHNESS_COLOR, type GpsFreshness, type GpsFreshnessStatus } from "@/lib/gps-freshness";
import { deriveShiftReview, SHIFT_REVIEW_COLOR, type ShiftReviewStatus } from "@/lib/shift-review";
import { collectTaskReferencedMediaIds } from "@/lib/task-media-hydration";
import { type TaskAttachmentRef } from "@/lib/task-attachments";
import { getManagerTaskRowAuditText } from "@/lib/manager-task-row-audit";
import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { getServerLocale } from "@/lib/i18n/server";
import { formatDurationCompact } from "@/lib/worker-utils";
import { isGpsWarningSuppressedForProject } from "@/lib/driver-time-projects";
import type { TaskPriority } from "@/types/database";

export const revalidate = 15;

const COPY = {
  en: {
    eyebrow: "Manager Command Center",
    title: "Send, assign, and steer the crew",
    description:
      "This is the control desk: broadcast messages, direct-message a person, manage tasks, and jump into the tools that change the day.",
    messagesTitle: "Team messages",
    messagesDesc: "Send one instruction to everybody or a private note to one person.",
    taskPulse: "Task control",
    taskPulseDesc: "Open work, urgent work, and unassigned tasks before they get buried.",
    taskBoardTitle: "Task board",
    taskBoardDesc: "Manage active tasks here. New project-scoped tasks still start from the project so the history stays attached.",
    quickControls: "Quick controls",
    openTasks: "Open tasks",
    urgentTasks: "Urgent / high",
    unassigned: "Unassigned",
    activeProjects: "Active projects",
    noPriorityTasks: "No urgent open tasks right now.",
    noProject: "General",
    noAssignee: "Unassigned",
    openProject: "Open project",
    openTaskBoard: "Open full task board",
    openProjects: "Create task in project",
    openSchedule: "Open schedule",
    openPayroll: "Open payroll",
    openTeam: "Open team",
    openOverview: "Open overview",
    openAi: "Ask AI",
    viewTimeline: "View timeline",
    overviewHint: "Overview is for watching the operation. Command Center is for changing it.",
    liveOps: "Live operations",
    liveOpsDesc: "Who is working, where they are, and what needs attention right now.",
    onShift: "On shift",
    noLiveWorkers: "Nobody is clocked in right now.",
    currentTask: "Current task",
    noCurrentTask: "No active assigned task",
    gpsFresh: "GPS fresh",
    gpsDelayed: "GPS delayed",
    gpsStale: "GPS stale",
    gpsLost: "GPS lost",
    gpsNeedsReview: "GPS needs review",
    gpsNoSignal: "No live GPS",
    riskQueue: "Owner attention queue",
    noRisks: "No urgent operational risks right now.",
    aiNext: "Jarvis next actions",
    askJarvis: "Open Jarvis with this",
    closedShiftIssues: "Closed shift review",
    actionLedger: "Jarvis action ledger",
    noJarvisActions: "No Jarvis actions recorded yet.",
    dispatchTitle: "Task dispatch status",
    dispatchDesc: "Read, claimed, and completion signals for work that is moving through the field.",
    dispatchNoTasks: "No dispatch tasks to watch right now.",
    read: "Read",
    unread: "Not read",
    claimed: "Claimed",
    assigned: "Assigned",
    unclaimed: "Open to crew",
    completed: "Done",
    unknown: "Unknown",
  },
  ru: {
    eyebrow: "Менеджерский командный центр",
    title: "Отдать команду, назначить и направить бригаду",
    description:
      "Это рабочий пульт: отправить сообщение всем, написать лично, разобрать задачи и быстро перейти туда, где реально меняется день.",
    messagesTitle: "Сообщения команде",
    messagesDesc: "Одно распоряжение всей бригаде или личное сообщение конкретному человеку.",
    taskPulse: "Управление задачами",
    taskPulseDesc: "Открытые, срочные и неназначенные задачи до того, как они потеряются.",
    taskBoardTitle: "Доска задач",
    taskBoardDesc: "Управляйте активными задачами здесь. Новые задачи по объекту всё ещё создаются из проекта, чтобы история оставалась привязанной.",
    quickControls: "Быстрые действия",
    openTasks: "Открытые задачи",
    urgentTasks: "Срочные / важные",
    unassigned: "Без исполнителя",
    activeProjects: "Активные объекты",
    noPriorityTasks: "Сейчас нет срочных открытых задач.",
    noProject: "Общая",
    noAssignee: "Не назначено",
    openProject: "Открыть проект",
    openTaskBoard: "Открыть полную доску",
    openProjects: "Создать задачу в проекте",
    openSchedule: "Открыть расписание",
    openPayroll: "Открыть зарплату",
    openTeam: "Открыть команду",
    openOverview: "Открыть обзор",
    openAi: "Спросить ИИ",
    viewTimeline: "Открыть хронологию",
    overviewHint: "Обзор нужен, чтобы наблюдать. Командный центр нужен, чтобы управлять.",
    liveOps: "Операции сейчас",
    liveOpsDesc: "Кто работает, где находится и что требует внимания прямо сейчас.",
    onShift: "На смене",
    noLiveWorkers: "Сейчас никто не на смене.",
    currentTask: "Текущая задача",
    noCurrentTask: "Нет активной назначенной задачи",
    gpsFresh: "GPS свежий",
    gpsDelayed: "GPS с задержкой",
    gpsStale: "GPS устарел",
    gpsLost: "GPS потерян",
    gpsNeedsReview: "GPS требует проверки",
    gpsNoSignal: "Нет live GPS",
    riskQueue: "Очередь внимания владельца",
    noRisks: "Сейчас нет срочных операционных рисков.",
    aiNext: "Следующие действия Jarvis",
    askJarvis: "Открыть Jarvis с этим",
    closedShiftIssues: "Проверка закрытых смен",
    actionLedger: "Журнал действий Jarvis",
    noJarvisActions: "Действий Jarvis пока не записано.",
    dispatchTitle: "Статус раздачи задач",
    dispatchDesc: "Кто прочитал, кто взял и кто закрыл задачу. Это оперативный след для владельца.",
    dispatchNoTasks: "Сейчас нет задач для контроля dispatch.",
    read: "Прочитал",
    unread: "Не прочитано",
    claimed: "Взял",
    assigned: "Назначено",
    unclaimed: "Открыта для команды",
    completed: "Готово",
    unknown: "Неизвестно",
  },
} as const;

const priorityRank: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const priorityColor: Record<TaskPriority, string> = {
  urgent: "#ef4444",
  high: "#ef4444",
  medium: "#f59e0b",
  low: "var(--green)",
};

const riskRank: Record<ShiftReviewStatus, number> = {
  needs_review: 0,
  video_missing: 1,
  gps_lost: 2,
  no_gps: 3,
  gps_stale: 4,
  long_shift: 5,
  normal: 6,
};

function aiPromptHref(prompt: string) {
  return `/ai?prompt=${encodeURIComponent(prompt)}`;
}

type JarvisAuditRow = {
  id: string;
  action: string;
  actor_name: string | null;
  target_type: string | null;
  target_id: string | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
};

function readAuditString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstPreparedAction(after: Record<string, unknown>) {
  const actions = Array.isArray(after.actions) ? after.actions : [];
  const first = actions.find((item) => item && typeof item === "object" && !Array.isArray(item));
  return first && typeof first === "object" && !Array.isArray(first)
    ? first as Record<string, unknown>
    : null;
}

function jarvisAuditText(row: JarvisAuditRow, locale: "en" | "ru") {
  const after = row.after_data ?? {};
  const preparedAction = row.action === "jarvis_action_prepared" ? firstPreparedAction(after) : null;
  const preparedPayload =
    preparedAction?.payload && typeof preparedAction.payload === "object" && !Array.isArray(preparedAction.payload)
      ? preparedAction.payload as Record<string, unknown>
      : {};
  const preparedKind = readAuditString(preparedAction?.kind);
  const preparedLabel = readAuditString(preparedAction?.label);
  const questionPreview = readAuditString(after.questionPreview);

  if (preparedAction) {
    const target =
      readAuditString(preparedPayload.title) ??
      readAuditString(preparedPayload.name) ??
      readAuditString(preparedPayload.text) ??
      preparedLabel ??
      preparedKind ??
      row.target_id ??
      row.action;
    const detail = questionPreview
      ? `${locale === "ru" ? "Запрос" : "Request"}: ${questionPreview}`
      : locale === "ru"
        ? "Ожидает проверки владельцем."
        : "Waiting for owner review.";
    return {
      title: preparedLabel ?? `${locale === "ru" ? "Подготовлено" : "Prepared"}: ${target}`,
      detail,
    };
  }

  const title =
    readAuditString(after.title) ??
    readAuditString(after.recipientName) ??
    readAuditString(after.projectName) ??
    row.target_id ??
    row.target_type ??
    row.action;
  return {
    title,
    detail: row.actor_name ? `${locale === "ru" ? "Кто" : "By"}: ${row.actor_name}` : row.action.replace(/_/g, " "),
  };
}

function metricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "warning" | "good";
}) {
  const color =
    tone === "warning" ? "#f59e0b" :
    tone === "good" ? "var(--green)" :
    "var(--text-primary)";

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-2 font-mono text-3xl font-bold" style={{ color }}>
        {value}
      </div>
      <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">
        {detail}
      </div>
    </div>
  );
}

function quickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof FolderKanban;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm font-semibold text-[var(--text-primary)] transition hover:border-[var(--brand-yellow)]"
    >
      <span className="inline-flex items-center gap-2">
        <Icon size={16} className="text-[var(--brand-yellow)]" />
        {label}
      </span>
      <span className="text-[var(--brand-yellow)]">-&gt;</span>
    </Link>
  );
}

export default async function CommandCenterPage() {
  const locale = await getServerLocale();
  const text = COPY[locale];
  const data = await getProjectsPageData();
  const supabase = await createClient();
  const activeProjects = getActiveOperationalProjects(data.projects);
  const activeProjectIds = buildActiveProjectIdSet(data.projects);
  const sessions = buildManagerSessions(data).filter((session) => activeProjectIds.has(session.projectId));
  const projectSummaries = buildProjectSummaries(data, sessions, {
    includeFinancials: data.manager.role === "owner" || data.manager.role === "admin",
  });
  const projectsById = new Map(data.projects.map((project) => [project.id, project.name]));
  const projectRecordById = new Map(data.projects.map((project) => [project.id, project]));
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile.name]));
  const profileRecordById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const clockInEventsById = new Map(data.timeEvents.map((event) => [event.id, event]));

  const crew = data.profiles
    .filter((profile) => !profile.deleted_at && profile.is_active)
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      role: profile.role,
    }));

  const projects = activeProjects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
  }));

  const tasks = data.tasks
    .filter((task) => isTaskInActiveOperations(task, activeProjectIds))
    .map((task) => {
      const completedById = getTaskCompletionAudit(task).completedById;
      return {
        ...task,
        status: getEffectiveTaskStatus(task),
        projectName: task.project_id ? projectsById.get(task.project_id) ?? null : null,
        assigneeName: task.assigned_to ? profilesById.get(task.assigned_to) ?? null : null,
        completedByName: completedById ? profilesById.get(completedById) ?? null : null,
      };
    });

  const referencedIds = new Set(collectTaskReferencedMediaIds(tasks));
  const attachmentMedia: TaskAttachmentRef[] = data.media
    .filter((media) => referencedIds.has(media.id))
    .map((media) => ({
      id: media.id,
      filename: media.filename,
      mime_type: media.mime_type,
      media_type: media.media_type,
      storage_path: media.storage_path,
    }));

  const openTasks = tasks.filter(isOpenTask);
  const openTaskByAssignee = new Map<string, typeof openTasks>();
  for (const task of openTasks) {
    if (!task.assigned_to) continue;
    const assigned = openTaskByAssignee.get(task.assigned_to) ?? [];
    assigned.push(task);
    openTaskByAssignee.set(task.assigned_to, assigned);
  }
  const priorityTasks = [...openTasks]
    .filter((task) => task.priority === "urgent" || task.priority === "high")
    .sort((left, right) => {
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) return priorityGap;
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  const unassignedTasks = openTasks.filter((task) => !task.assigned_to);
  const topTasks = priorityTasks.length > 0 ? priorityTasks.slice(0, 6) : openTasks.slice(0, 6);
  const recentCompletedTasks = [...tasks]
    .filter((task) => getEffectiveTaskStatus(task) === "done")
    .sort((left, right) => {
      const leftTime = new Date(left.completed_at ?? left.updated_at ?? left.created_at).getTime();
      const rightTime = new Date(right.completed_at ?? right.updated_at ?? right.created_at).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 4);
  const dispatchTaskMap = new Map<string, (typeof tasks)[number]>();
  for (const task of [...priorityTasks, ...unassignedTasks, ...openTasks, ...recentCompletedTasks]) {
    dispatchTaskMap.set(task.id, task);
  }
  const dispatchTasks = [...dispatchTaskMap.values()]
    .sort((left, right) => {
      const leftOpen = isOpenTask(left) ? 0 : 1;
      const rightOpen = isOpenTask(right) ? 0 : 1;
      if (leftOpen !== rightOpen) return leftOpen - rightOpen;
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) return priorityGap;
      const leftTime = new Date(left.updated_at ?? left.created_at).getTime();
      const rightTime = new Date(right.updated_at ?? right.created_at).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 12);
  const auditDateFormatter = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const formatAuditDate = (value: string) => auditDateFormatter.format(new Date(value));
  const openSessions = sessions
    .filter((session) => session.isOpen)
    .sort((left, right) => right.durationMinutes - left.durationMinutes);
  const closedShiftIssues = sessions
    .filter((session) => !session.isOpen)
    .map((session) => {
      const profile = profileRecordById.get(session.profileId);
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      const review = deriveShiftReview({
        isOpen: false,
        durationMinutes: session.durationMinutes,
        hadGpsAtClockIn: clockInEvent?.gps_point != null,
        gpsWarningSuppressed: isGpsWarningSuppressedForProject(
          projectRecordById.get(session.projectId),
        ),
        gpsFreshness: null,
        requireVideo: profile?.require_video ?? false,
        videoStatus: session.checkoutStatus,
      });
      return { ...session, review };
    })
    .filter((session) => session.review.status !== "normal")
    .sort((left, right) => {
      const statusGap = riskRank[left.review.status] - riskRank[right.review.status];
      if (statusGap !== 0) return statusGap;
      return right.durationMinutes - left.durationMinutes;
    })
    .slice(0, 6);

  const freshnessByProfileId = new Map<string, GpsFreshness>();
  if (openSessions.length > 0) {
    try {
      const profileIds = openSessions.map((session) => session.profileId);
      const { data: liveRows, error: liveError } = await supabase
        .from("worker_live_locations")
        .select("worker_id, recorded_at")
        .in("worker_id", profileIds)
        .order("recorded_at", { ascending: false })
        .limit(profileIds.length * 5);
      if (!liveError && liveRows) {
        const lastByWorker = new Map<string, string>();
        for (const row of liveRows as Array<{ worker_id: string; recorded_at: string }>) {
          if (!lastByWorker.has(row.worker_id)) {
            lastByWorker.set(row.worker_id, row.recorded_at);
          }
        }
        for (const session of openSessions) {
          freshnessByProfileId.set(
            session.profileId,
            deriveGpsFreshness({
              lastUpdateAt: lastByWorker.get(session.profileId) ?? null,
              shiftStartAt: session.clockInTime,
            }),
          );
        }
      }
    } catch {
      // Keep Command Center usable if the optional live-location table is unreachable.
    }
  }

  const gpsFreshnessLabel: Record<GpsFreshnessStatus, string> = {
    fresh: text.gpsFresh,
    delayed: text.gpsDelayed,
    stale: text.gpsStale,
    lost: text.gpsLost,
    needs_review: text.gpsNeedsReview,
    no_signal: text.gpsNoSignal,
  };
  const shiftReviewLabel: Record<ShiftReviewStatus, string> = {
    normal: locale === "ru" ? "Норма" : "Normal",
    long_shift: locale === "ru" ? "Длинная смена" : "Long shift",
    gps_stale: locale === "ru" ? "GPS устарел" : "GPS stale",
    gps_lost: locale === "ru" ? "GPS потерян" : "GPS lost",
    no_gps: locale === "ru" ? "Без GPS" : "No GPS",
    needs_review: locale === "ru" ? "Нужна проверка" : "Needs review",
    video_missing: locale === "ru" ? "Нет видео" : "Missing video",
  };
  const liveWorkers = openSessions.map((session) => {
    const clockInEvent = clockInEventsById.get(session.clockInEventId);
    const profile = profileRecordById.get(session.profileId);
    const freshness =
      freshnessByProfileId.get(session.profileId) ??
      deriveGpsFreshness({ lastUpdateAt: null, shiftStartAt: session.clockInTime });
    const review = deriveShiftReview({
      isOpen: true,
      durationMinutes: session.durationMinutes,
      hadGpsAtClockIn: clockInEvent?.gps_point != null,
      gpsWarningSuppressed: isGpsWarningSuppressedForProject(
        projectRecordById.get(session.projectId),
      ),
      gpsFreshness: freshness,
      requireVideo: profile?.require_video ?? false,
      videoStatus: "not_required",
    });
    const task = openTaskByAssignee.get(session.profileId)?.[0] ?? null;
    return { ...session, freshness, review, task };
  });
  const liveRisks = liveWorkers
    .filter((worker) => worker.review.status !== "normal")
    .sort((left, right) => {
      const statusGap = riskRank[left.review.status] - riskRank[right.review.status];
      if (statusGap !== 0) return statusGap;
      return right.durationMinutes - left.durationMinutes;
    });
  const inactiveActiveProjects = projectSummaries
    .filter((project) => project.status === "active")
    .filter((project) => project.onSiteWorkerCount === 0 && project.openTaskCount > 0)
    .slice(0, 4);
  let jarvisAuditRows: JarvisAuditRow[] = [];
  try {
    const { data: auditRows, error: auditError } = await supabase
      .from("audit_log")
      .select("id, action, actor_name, target_type, target_id, after_data, created_at")
      .order("created_at", { ascending: false })
      .limit(24);
    if (!auditError && auditRows) {
      jarvisAuditRows = (auditRows as JarvisAuditRow[])
        .filter(
          (row) =>
            (row.action.startsWith("jarvis_") && row.action !== "jarvis_ai_usage") ||
            row.action === "task_claimed" ||
            row.action === "project_moved_to_trash",
        )
        .slice(0, 6);
    }
  } catch {
    jarvisAuditRows = [];
  }
  const aiNextActions = [
    ...liveRisks.slice(0, 3).map((worker) => ({
      id: `ai-live-${worker.id}`,
      title:
        locale === "ru"
          ? `Подготовить follow-up для ${worker.profileName}`
          : `Prepare follow-up for ${worker.profileName}`,
      detail: `${worker.projectName} · ${formatDurationCompact(worker.durationMinutes)} · ${shiftReviewLabel[worker.review.status]}`,
      prompt:
        locale === "ru"
          ? `Jarvis, посмотри смену ${worker.profileName} на проекте ${worker.projectName}. Подготовь мне сообщение или задачу, если нужно вмешаться.`
          : `Jarvis, review ${worker.profileName}'s shift on ${worker.projectName}. Prepare a message or task if I should intervene.`,
    })),
    ...unassignedTasks.slice(0, 2).map((task) => ({
      id: `ai-task-${task.id}`,
      title: locale === "ru" ? "Предложить исполнителя задачи" : "Suggest task assignee",
      detail: `${task.title} · ${task.projectName ?? text.noProject}`,
      prompt:
        locale === "ru"
          ? `Jarvis, предложи лучшего исполнителя для задачи "${task.title}"${task.projectName ? ` на проекте ${task.projectName}` : ""}.`
          : `Jarvis, suggest the best assignee for task "${task.title}"${task.projectName ? ` on ${task.projectName}` : ""}.`,
    })),
    ...inactiveActiveProjects.slice(0, 2).map((project) => ({
      id: `ai-project-${project.id}`,
      title: locale === "ru" ? "Проверить проект без людей" : "Review project with no crew",
      detail: `${project.name} · ${project.openTaskCount} ${text.openTasks.toLowerCase()}`,
      prompt:
        locale === "ru"
          ? `Jarvis, проверь проект ${project.name}. На нем нет людей, но есть открытые задачи. Что мне сделать дальше?`
          : `Jarvis, review ${project.name}. No one is on site but it has open tasks. What should I do next?`,
    })),
  ].slice(0, 6);

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 p-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {text.eyebrow}
          </p>
          <h1 className="mt-2 text-[30px] font-bold text-[var(--text-primary)]">
            {text.title}
          </h1>
          <p className="mt-1 max-w-[82ch] text-sm leading-6 text-[var(--text-secondary)]">
            {text.description}
          </p>
          <p className="mt-2 text-xs font-semibold text-[var(--brand-yellow)]">
            {text.overviewHint}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <OverviewLiveIndicator />
          <Link href="/overview" className="button-base button-secondary px-3 py-2 text-xs">
            {text.openOverview}
          </Link>
          <Link href="/timeline" className="button-base button-secondary px-3 py-2 text-xs">
            {text.viewTimeline}
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCard({
          label: text.openTasks,
          value: openTasks.length,
          detail: text.taskPulseDesc,
          tone: openTasks.length > 0 ? "warning" : "good",
        })}
        {metricCard({
          label: text.urgentTasks,
          value: priorityTasks.length,
          detail: text.noPriorityTasks,
          tone: priorityTasks.length > 0 ? "warning" : "good",
        })}
        {metricCard({
          label: text.unassigned,
          value: unassignedTasks.length,
          detail: text.noAssignee,
          tone: unassignedTasks.length > 0 ? "warning" : "good",
        })}
        {metricCard({
          label: text.activeProjects,
          value: activeProjects.length,
          detail: text.openProjects,
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)]">
        <div className="surface-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ai-cyan)]">
                {text.liveOps}
              </div>
              <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
                {text.onShift}: {liveWorkers.length}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                {text.liveOpsDesc}
              </p>
            </div>
            <Link href="/overview" className="button-base button-secondary px-3 py-2 text-xs">
              {text.openOverview}
            </Link>
          </div>

          <div className="mt-4 grid gap-2">
            {liveWorkers.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
                {text.noLiveWorkers}
              </div>
            ) : (
              liveWorkers.map((worker) => {
                const reviewColor = SHIFT_REVIEW_COLOR[worker.review.status];
                const gpsColor = GPS_FRESHNESS_COLOR[worker.freshness.status];
                return (
                  <Link
                    key={worker.id}
                    href={`/team/${worker.profileId}`}
                    className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--text-primary)]">
                            {worker.profileName}
                          </span>
                          <span className="rounded-[var(--radius-pill)] bg-[rgba(105,231,255,0.08)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ai-cyan-bright)]">
                            {worker.profileRole}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={12} className="text-[var(--brand-yellow)]" />
                            {worker.projectName}
                          </span>
                          <span>{formatDurationCompact(worker.durationMinutes)}</span>
                        </div>
                        <div className="mt-2 text-xs text-[var(--text-secondary)]">
                          <span className="font-semibold text-[var(--text-muted)]">
                            {text.currentTask}:{" "}
                          </span>
                          {worker.task ? worker.task.title : text.noCurrentTask}
                        </div>
                      </div>
                      <div className="grid shrink-0 gap-1 text-right">
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                          style={{ background: `${gpsColor}1f`, color: gpsColor }}
                        >
                          {gpsFreshnessLabel[worker.freshness.status]} · {formatGpsAge(worker.freshness.ageMs)}
                        </span>
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                          style={{ background: `${reviewColor}1f`, color: reviewColor }}
                        >
                          {shiftReviewLabel[worker.review.status]}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-5">
          <section className="surface-card p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: liveRisks.length > 0 ? "rgba(239, 68, 68, 0.12)" : "rgba(15, 168, 120, 0.12)" }}
              >
                {liveRisks.length > 0 ? (
                  <AlertTriangle size={18} className="text-[var(--red)]" />
                ) : (
                  <CheckCircle2 size={18} className="text-[var(--green)]" />
                )}
              </span>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {text.riskQueue}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {text.closedShiftIssues}: {closedShiftIssues.length}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {[...liveRisks.slice(0, 4), ...closedShiftIssues.slice(0, 3)].length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {text.noRisks}
                </div>
              ) : (
                [...liveRisks.slice(0, 4), ...closedShiftIssues.slice(0, 3)].map((item) => {
                  const color = SHIFT_REVIEW_COLOR[item.review.status];
                  return (
                    <Link
                      key={`${item.isOpen ? "open" : "closed"}-${item.id}`}
                      href={`/team/${item.profileId}`}
                      className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {item.profileName}
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {item.projectName} · {formatDurationCompact(item.durationMinutes)}
                          </div>
                        </div>
                        <span
                          className="rounded-[var(--radius-pill)] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]"
                          style={{ background: `${color}1f`, color }}
                        >
                          {shiftReviewLabel[item.review.status]}
                        </span>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(105, 231, 255, 0.1)" }}
              >
                <Sparkles size={18} className="text-[var(--ai-cyan-bright)]" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {text.aiNext}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  AI suggests → owner approves → system writes → audit records.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {aiNextActions.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {locale === "ru" ? "Jarvis сейчас не видит срочных действий." : "Jarvis does not see urgent actions right now."}
                </div>
              ) : (
                aiNextActions.map((item) => (
                  <Link
                    key={item.id}
                    href={aiPromptHref(item.prompt)}
                    className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--ai-cyan)]"
                  >
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                      {item.detail}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-[var(--ai-cyan-bright)]">
                      {text.askJarvis} -&gt;
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="surface-card p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">
              {text.actionLedger}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              AI prepares → owner confirms → server writes → audit_log stores the result.
            </p>
            <div className="mt-4 space-y-2">
              {jarvisAuditRows.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {text.noJarvisActions}
                </div>
              ) : (
                jarvisAuditRows.map((row) => {
                  const auditText = jarvisAuditText(row, locale);
                  return (
                    <div
                      key={row.id}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {row.action.replace(/_/g, " ")}
                          </div>
                          <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                            {auditText.title}
                          </div>
                          <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">
                            {auditText.detail}
                          </div>
                        </div>
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          {row.created_at.slice(0, 16).replace("T", " ")}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ai-cyan)]">
              Dispatch
            </div>
            <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
              {text.dispatchTitle}
            </h2>
            <p className="mt-1 max-w-[82ch] text-sm leading-6 text-[var(--text-secondary)]">
              {text.dispatchDesc}
            </p>
          </div>
          <Link href="/tasks" className="button-base button-secondary px-3 py-2 text-xs">
            {text.openTaskBoard}
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dispatchTasks.length === 0 ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)] md:col-span-2 xl:col-span-3">
              {text.dispatchNoTasks}
            </div>
          ) : (
            dispatchTasks.map((task) => {
              const audit = getManagerTaskRowAuditText(task, profilesById, {
                unassigned: text.noAssignee,
                unknown: text.unknown,
                formatCompletedAt: formatAuditDate,
              });
              const status = getEffectiveTaskStatus(task);
              const accent = priorityColor[task.priority];
              const readText = audit.seenAtText
                ? `${text.read}: ${audit.seenByText ?? text.unknown}`
                : task.assigned_to
                  ? text.unread
                  : text.unclaimed;
              const progressText = audit.completedAtText
                ? `${text.completed}: ${audit.completedByText ?? text.unknown}`
                : audit.startedAtText
                  ? `${text.claimed}: ${audit.startedByText ?? audit.assignedToText}`
                  : task.assigned_to
                    ? `${text.assigned}: ${audit.assignedToText}`
                    : text.unclaimed;
              const progressColor = audit.completedAtText
                ? "var(--green)"
                : audit.startedAtText
                  ? "var(--brand-yellow)"
                  : task.assigned_to
                    ? "var(--ai-cyan-bright)"
                    : "#f59e0b";
              return (
                <Link
                  key={task.id}
                  href={task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks"}
                  className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                        {task.title}
                      </div>
                      <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                        {task.projectName ?? text.noProject}
                      </div>
                    </div>
                    <span
                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                      style={{ background: `${accent}1f`, color: accent }}
                    >
                      {task.priority}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em]"
                      style={{ background: `${progressColor}1f`, color: progressColor }}
                    >
                      {progressText}
                    </span>
                    <span className="rounded-[var(--radius-pill)] bg-[rgba(148,163,184,0.12)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      {readText}
                    </span>
                    <span className="rounded-[var(--radius-pill)] bg-[rgba(148,163,184,0.12)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      {status}
                    </span>
                  </div>
                  {(audit.startedAtText || audit.completedAtText || audit.seenAtText) ? (
                    <div className="mt-3 text-[11px] leading-5 text-[var(--text-muted)]">
                      {audit.completedAtText
                        ? audit.completedAtText
                        : audit.startedAtText
                          ? audit.startedAtText
                          : audit.seenAtText}
                    </div>
                  ) : null}
                </Link>
              );
            })
          )}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{text.messagesTitle}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{text.messagesDesc}</p>
          </div>
          <BulkMessageComposer
            orgId={data.manager.org_id}
            senderId={data.manager.id}
            senderName={data.manager.name}
            senderRole={data.manager.role}
            crew={crew}
            projects={projects}
            embedded
          />
        </div>

        <div className="space-y-5">
          <section className="surface-card p-4">
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(191, 162, 52, 0.12)" }}
              >
                <RadioTower size={18} style={{ color: "var(--brand-yellow)" }} />
              </span>
              <div>
                <h2 className="text-lg font-bold text-[var(--text-primary)]">
                  {text.taskPulse}
                </h2>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {text.taskPulseDesc}
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {topTasks.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {text.noPriorityTasks}
                </div>
              ) : (
                topTasks.map((task) => {
                  const accent = priorityColor[task.priority];
                  return (
                    <Link
                      key={task.id}
                      href={task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks"}
                      className="block rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 transition hover:border-[var(--brand-yellow)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {task.title}
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {task.projectName ?? text.noProject} · {task.assigneeName ?? text.noAssignee}
                          </div>
                        </div>
                        <span
                          className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[9px] font-bold uppercase"
                          style={{ background: `${accent}1f`, color: accent }}
                        >
                          {task.priority}
                        </span>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/tasks" className="button-base button-secondary px-3 py-2 text-xs">
                {text.openTaskBoard}
              </Link>
              <Link href="/projects" className="button-base button-primary px-3 py-2 text-xs">
                {text.openProjects}
              </Link>
            </div>
          </section>

          <section className="surface-card p-4">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.quickControls}</h2>
            <div className="mt-4 grid gap-2">
              {quickLink({ href: "/projects", icon: FolderKanban, label: text.openProjects })}
              {quickLink({ href: "/team", icon: Users, label: text.openTeam })}
              {quickLink({ href: "/schedule", icon: CalendarDays, label: text.openSchedule })}
              {quickLink({ href: "/payroll", icon: Wallet, label: text.openPayroll })}
              {quickLink({ href: "/tasks", icon: ClipboardCheck, label: text.openTaskBoard })}
              {quickLink({ href: "/ai", icon: Bot, label: text.openAi })}
            </div>
          </section>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{text.taskBoardTitle}</h2>
            <p className="mt-1 max-w-[80ch] text-sm text-[var(--text-secondary)]">
              {text.taskBoardDesc}
            </p>
          </div>
          <MessageSquare size={20} className="text-[var(--brand-yellow)]" />
        </div>
        <ManagerTasksPage
          orgId={data.manager.org_id}
          managerId={data.manager.id}
          managerName={data.manager.name}
          managerRole={data.manager.role}
          projects={projects}
          workers={crew}
          initialTasks={tasks}
          attachmentMedia={attachmentMedia}
          embedded
        />
      </section>
    </div>
  );
}
