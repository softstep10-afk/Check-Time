import Link from "next/link";
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
  FolderKanban,
  MessageSquare,
  RadioTower,
  Users,
  Wallet,
} from "lucide-react";
import { BulkMessageComposer } from "@/components/manager/BulkMessageComposer";
import { ManagerTasksPage } from "@/components/manager/ManagerTasksPage";
import {
  buildActiveProjectIdSet,
  getActiveOperationalProjects,
  isTaskInActiveOperations,
} from "@/lib/archive-utils";
import { getProjectsPageData } from "@/lib/manager-data";
import { isOpenTask } from "@/lib/manager-utils";
import { collectTaskReferencedMediaIds } from "@/lib/task-media-hydration";
import { type TaskAttachmentRef } from "@/lib/task-attachments";
import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { getServerLocale } from "@/lib/i18n/server";
import type { TaskPriority } from "@/types/database";

export const revalidate = 0;

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
  const activeProjects = getActiveOperationalProjects(data.projects);
  const activeProjectIds = buildActiveProjectIdSet(data.projects);
  const projectsById = new Map(data.projects.map((project) => [project.id, project.name]));
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile.name]));

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
  const priorityTasks = [...openTasks]
    .filter((task) => task.priority === "urgent" || task.priority === "high")
    .sort((left, right) => {
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) return priorityGap;
      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    });
  const unassignedTasks = openTasks.filter((task) => !task.assigned_to);
  const topTasks = priorityTasks.length > 0 ? priorityTasks.slice(0, 6) : openTasks.slice(0, 6);

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
            crew={crew}
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
