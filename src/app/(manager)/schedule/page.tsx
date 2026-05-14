"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Plus,
  Save,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslation } from "@/lib/i18n";
import {
  deriveProjectScheduleHealth,
  formatProjectCountdown,
  projectScheduleToneStyle,
} from "@/lib/project-schedule";
import type { Profile, Project, Task, UserRole } from "@/types/database";

type ScheduleKind = "meeting" | "task" | "note" | "delivery";
type CalendarMode = "general" | "deliveries";
type EntrySource = "task" | "project";
type EntryType = ScheduleKind | "project_start" | "project_deadline";

type CalendarEntry = {
  id: string;
  source: EntrySource;
  type: EntryType;
  dayIso: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  projectName: string | null;
  assigneeName: string | null;
  description: string | null;
  tone: "neutral" | "green" | "yellow" | "red" | "blue";
};

type CalendarDay = {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
};

type ItemForm = {
  title: string;
  kind: ScheduleKind;
  projectId: string;
  assignedTo: string;
  startsAt: string;
  endsAt: string;
  description: string;
};

type ProjectDateForm = {
  projectId: string;
  startDate: string;
  endDate: string;
};

const CALENDAR_ROLES: UserRole[] = [
  "owner",
  "admin",
  "manager",
  "supervisor",
  "sales",
  "driver",
  "worker",
  "subcontractor",
];

const TEXT = {
  en: {
    eyebrow: "Schedule",
    title: "Year calendar",
    subtitle: "Click any day to add meetings, notes, project work, or delivery runs. Project deadlines stay visible across the year.",
    today: "Today",
    previousYear: "Previous year",
    nextYear: "Next year",
    generalCalendar: "Team calendar",
    deliveryCalendar: "Delivery calendar",
    newItem: "New calendar item",
    addToDay: "Add to this day",
    titleLabel: "Title",
    typeLabel: "Type",
    projectLabel: "Project",
    assigneeLabel: "Person",
    driverLabel: "Driver",
    startLabel: "Start",
    endLabel: "End",
    notesLabel: "Notes",
    noProject: "No project",
    noAssignee: "No person",
    noDriver: "No driver",
    create: "Create item",
    creating: "Creating...",
    datesTitle: "Project dates",
    saveDates: "Save dates",
    saving: "Saving...",
    deadlines: "Project deadlines",
    noEntries: "No items yet.",
    noDeadlines: "No project deadlines yet.",
    noProjects: "No projects",
    starts: "Start",
    deadline: "Deadline",
    meeting: "Meeting",
    task: "Task",
    note: "Note",
    delivery: "Delivery",
    projectStart: "Project start",
    projectDeadline: "Project deadline",
    notStarted: "Not started",
    onTrack: "On track",
    halfElapsed: "Past 50%",
    almostDue: "Last 10%",
    overdue: "Overdue",
    unscheduled: "No deadline",
    saved: "Saved.",
    created: "Calendar item created.",
    loadFailed: "Could not load schedule.",
    writeFailed: "Could not save schedule.",
    loading: "Loading...",
    openDay: "Open day",
    dayPlanner: "Day planner",
    itemsOnDay: "Items on this day",
    useAsStart: "Set as project start",
    useAsDeadline: "Set as deadline",
    more: "more",
  },
  ru: {
    eyebrow: "Расписание",
    title: "Годовой календарь",
    subtitle: "Нажмите на любой день, чтобы добавить встречу, заметку, проектную работу или доставку. Дедлайны проектов видны по всему году.",
    today: "Сегодня",
    previousYear: "Предыдущий год",
    nextYear: "Следующий год",
    generalCalendar: "Календарь команды",
    deliveryCalendar: "Календарь доставок",
    newItem: "Новая запись",
    addToDay: "Добавить в этот день",
    titleLabel: "Название",
    typeLabel: "Тип",
    projectLabel: "Проект",
    assigneeLabel: "Кому",
    driverLabel: "Водитель",
    startLabel: "Начало",
    endLabel: "Конец",
    notesLabel: "Заметки",
    noProject: "Без проекта",
    noAssignee: "Без человека",
    noDriver: "Без водителя",
    create: "Создать запись",
    creating: "Создаю...",
    datesTitle: "Даты проекта",
    saveDates: "Сохранить даты",
    saving: "Сохраняю...",
    deadlines: "Дедлайны проектов",
    noEntries: "Пока нет записей.",
    noDeadlines: "Пока нет дедлайнов проектов.",
    noProjects: "Нет проектов",
    starts: "Старт",
    deadline: "Дедлайн",
    meeting: "Встреча",
    task: "Задача",
    note: "Заметка",
    delivery: "Доставка",
    projectStart: "Старт проекта",
    projectDeadline: "Дедлайн проекта",
    notStarted: "Ещё не стартовал",
    onTrack: "В графике",
    halfElapsed: "Прошли 50%",
    almostDue: "Осталось 10%",
    overdue: "Просрочен",
    unscheduled: "Без дедлайна",
    saved: "Сохранено.",
    created: "Запись создана.",
    loadFailed: "Не удалось загрузить расписание.",
    writeFailed: "Не удалось сохранить расписание.",
    loading: "Загружаю...",
    openDay: "Открыть день",
    dayPlanner: "План дня",
    itemsOnDay: "Записи на этот день",
    useAsStart: "Этот день = старт",
    useAsDeadline: "Этот день = дедлайн",
    more: "ещё",
  },
} as const;

type ScheduleText = {
  [K in keyof typeof TEXT.en]: string;
};

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDay(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfCalendarGrid(month: Date): Date {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  first.setHours(0, 0, 0, 0);
  const day = first.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(first, mondayOffset);
}

function toDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateFromIsoDay(dayIso: string, hour = 9): Date {
  const date = new Date(`${dayIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

function defaultItemForm(dayIso?: string, kind: ScheduleKind = "meeting"): ItemForm {
  const start = dayIso ? dateFromIsoDay(dayIso) : new Date();
  if (!dayIso) {
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
  }
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    title: "",
    kind,
    projectId: "",
    assignedTo: "",
    startsAt: toDatetimeLocalValue(start),
    endsAt: toDatetimeLocalValue(end),
    description: "",
  };
}

function yearStartIso(year: number): string {
  return `${year}-01-01`;
}

function yearEndIso(year: number): string {
  return `${year}-12-31`;
}

function monthLabel(date: Date, locale: "en" | "ru"): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "long",
  }).format(date);
}

function dayLongLabel(value: string, locale: "en" | "ru"): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dateFromIsoDay(value, 12));
}

function timeLabel(value: string | null, locale: "en" | "ru"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function dateTimeLabel(value: string | null, locale: "en" | "ru"): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function entryTypeLabel(type: EntryType, text: ScheduleText): string {
  if (type === "meeting") return text.meeting;
  if (type === "task") return text.task;
  if (type === "note") return text.note;
  if (type === "delivery") return text.delivery;
  if (type === "project_start") return text.projectStart;
  return text.projectDeadline;
}

function scheduleStateLabel(
  state: ReturnType<typeof deriveProjectScheduleHealth>["state"],
  text: ScheduleText,
): string {
  if (state === "not_started") return text.notStarted;
  if (state === "on_track") return text.onTrack;
  if (state === "half_elapsed") return text.halfElapsed;
  if (state === "almost_due") return text.almostDue;
  if (state === "overdue") return text.overdue;
  return text.unscheduled;
}

function entryStyle(tone: CalendarEntry["tone"]) {
  if (tone === "blue") {
    return {
      background: "rgba(59, 130, 246, 0.14)",
      color: "#60a5fa",
      borderColor: "rgba(59, 130, 246, 0.28)",
    };
  }
  return projectScheduleToneStyle(tone);
}

function scheduleKindFromMetadata(metadata: Record<string, unknown> | null | undefined): ScheduleKind {
  const kind = metadata?.schedule_kind;
  if (kind === "meeting" || kind === "task" || kind === "note" || kind === "delivery") return kind;
  return "task";
}

async function readRouteError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return `Request failed (${response.status})`;
}

export default function SchedulePage() {
  const supabase = useMemo(() => createClient(), []);
  const { locale } = useTranslation();
  const text = TEXT[locale];
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"item" | "dates" | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("general");
  const [anchorYear, setAnchorYear] = useState(() => new Date().getFullYear());
  const [itemForm, setItemForm] = useState<ItemForm>(() => defaultItemForm());
  const [projectForm, setProjectForm] = useState<ProjectDateForm>({
    projectId: "",
    startDate: "",
    endDate: "",
  });

  const weekdayLabels =
    locale === "ru"
      ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const yearMonths = useMemo(() => {
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const month = new Date(anchorYear, monthIndex, 1);
      const gridStart = startOfCalendarGrid(month);
      const days = Array.from({ length: 42 }, (_, index) => {
        const date = addDays(gridStart, index);
        return {
          date,
          iso: isoDay(date),
          inMonth: date.getMonth() === month.getMonth(),
          isToday: isoDay(date) === isoDay(new Date()),
        };
      });
      return { month, days };
    });
  }, [anchorYear]);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const profileQuery = user
      ? supabase.from("profiles").select("*").eq("id", user.id).maybeSingle<Profile>()
      : Promise.resolve({ data: null, error: null });

    const [profileRes, profilesRes, projectsRes, tasksRes] = await Promise.all([
      profileQuery,
      supabase
        .from("profiles")
        .select("*")
        .is("deleted_at", null)
        .order("role", { ascending: true })
        .order("name", { ascending: true })
        .returns<Profile[]>(),
      supabase
        .from("projects")
        .select("*")
        .is("deleted_at", null)
        .neq("status", "archived")
        .order("name", { ascending: true })
        .returns<Project[]>(),
      supabase
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .gte("due_date", yearStartIso(anchorYear))
        .lte("due_date", yearEndIso(anchorYear))
        .order("due_date", { ascending: true })
        .returns<Task[]>(),
    ]);

    if (profilesRes.error || projectsRes.error || tasksRes.error) {
      setNotice(text.loadFailed);
    }

    const loadedProjects = projectsRes.data ?? [];
    setCurrentProfile(profileRes.data ?? null);
    setProfiles(profilesRes.data ?? []);
    setProjects(loadedProjects);
    setTasks(tasksRes.data ?? []);
    setProjectForm((prev) => {
      if (prev.projectId || loadedProjects.length === 0) return prev;
      const first = loadedProjects[0];
      return {
        projectId: first.id,
        startDate: first.start_date ?? "",
        endDate: first.end_date ?? "",
      };
    });
    setLoading(false);
  }, [anchorYear, supabase, text.loadFailed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSchedule();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSchedule]);

  useEffect(() => {
    const channel = supabase
      .channel("schedule-calendar-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void loadSchedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => void loadSchedule())
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => void loadSchedule())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadSchedule, supabase]);

  useEffect(() => {
    setItemForm((prev) => {
      const nextKind = calendarMode === "deliveries" ? "delivery" : prev.kind === "delivery" ? "meeting" : prev.kind;
      return prev.kind === nextKind ? prev : { ...prev, kind: nextKind };
    });
  }, [calendarMode]);

  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const activeProfiles = useMemo(() => {
    return profiles.filter((profile) => profile.is_active && CALENDAR_ROLES.includes(profile.role));
  }, [profiles]);

  const deliveryProfiles = useMemo(() => {
    return activeProfiles.filter((profile) => profile.role === "driver");
  }, [activeProfiles]);

  const assignmentOptions = itemForm.kind === "delivery" ? deliveryProfiles : activeProfiles;

  const entries = useMemo<CalendarEntry[]>(() => {
    const taskEntries = tasks
      .map((task): CalendarEntry | null => {
        if (!task.due_date) return null;
        const metadata = task.metadata ?? {};
        const startsAt =
          typeof metadata.schedule_starts_at === "string"
            ? metadata.schedule_starts_at
            : `${task.due_date}T09:00:00`;
        const endsAt = typeof metadata.schedule_ends_at === "string" ? metadata.schedule_ends_at : null;
        const startDate = new Date(startsAt);
        const dayIso = Number.isNaN(startDate.getTime()) ? task.due_date : isoDay(startDate);
        const kind = scheduleKindFromMetadata(metadata);

        return {
          id: task.id,
          source: "task",
          type: kind,
          dayIso,
          title: task.title,
          startsAt,
          endsAt,
          projectName: task.project_id ? projectsById.get(task.project_id)?.name ?? null : null,
          assigneeName: task.assigned_to ? profilesById.get(task.assigned_to)?.name ?? null : null,
          description: task.description,
          tone:
            kind === "delivery"
              ? "blue"
              : kind === "meeting"
                ? "blue"
                : kind === "note"
                  ? "neutral"
                  : "yellow",
        };
      })
      .filter((entry): entry is CalendarEntry => entry !== null);

    const projectEntries = projects.flatMap((project): CalendarEntry[] => {
      const health = deriveProjectScheduleHealth({
        startDate: project.start_date,
        endDate: project.end_date,
      });
      const out: CalendarEntry[] = [];
      if (project.start_date?.startsWith(String(anchorYear))) {
        out.push({
          id: `${project.id}-start`,
          source: "project",
          type: "project_start",
          dayIso: project.start_date,
          title: project.name,
          startsAt: `${project.start_date}T08:00:00`,
          endsAt: null,
          projectName: project.name,
          assigneeName: null,
          description: project.address,
          tone: "green",
        });
      }
      if (project.end_date?.startsWith(String(anchorYear))) {
        out.push({
          id: `${project.id}-deadline`,
          source: "project",
          type: "project_deadline",
          dayIso: project.end_date,
          title: project.name,
          startsAt: `${project.end_date}T17:00:00`,
          endsAt: null,
          projectName: project.name,
          assigneeName: null,
          description: `${scheduleStateLabel(health.state, text)} · ${formatProjectCountdown(health, locale)}`,
          tone: health.tone,
        });
      }
      return out;
    });

    return [...taskEntries, ...projectEntries].sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [anchorYear, locale, profilesById, projects, projectsById, tasks, text]);

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (calendarMode === "deliveries") return entry.type === "delivery";
      return entry.type !== "delivery";
    });
  }, [calendarMode, entries]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of visibleEntries) {
      const list = map.get(entry.dayIso) ?? [];
      list.push(entry);
      map.set(entry.dayIso, list);
    }
    return map;
  }, [visibleEntries]);

  const selectedDayEntries = selectedDay ? entriesByDay.get(selectedDay.iso) ?? [] : [];

  const projectDeadlines = useMemo(() => {
    return projects
      .filter((project) => project.end_date && project.status !== "completed")
      .map((project) => ({
        project,
        health: deriveProjectScheduleHealth({
          startDate: project.start_date,
          endDate: project.end_date,
        }),
      }))
      .sort((a, b) => (a.project.end_date ?? "").localeCompare(b.project.end_date ?? ""));
  }, [projects]);

  function openDay(day: CalendarDay) {
    setSelectedDay(day);
    setSelectedEntry(null);
    setItemForm((prev) => ({
      ...defaultItemForm(day.iso, calendarMode === "deliveries" ? "delivery" : prev.kind === "delivery" ? "meeting" : prev.kind),
      projectId: prev.projectId,
      assignedTo: calendarMode === "deliveries" ? prev.assignedTo : prev.assignedTo,
    }));
  }

  async function createCalendarItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("item");
    setNotice("");

    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create_item",
        title: itemForm.title,
        kind: itemForm.kind,
        projectId: itemForm.projectId || null,
        assignedTo: itemForm.assignedTo || null,
        startsAt: itemForm.startsAt,
        endsAt: itemForm.endsAt || null,
        description: itemForm.description,
      }),
    });

    if (!response.ok) {
      setNotice(`${text.writeFailed} ${await readRouteError(response)}`);
      setBusy(null);
      return;
    }

    setItemForm((prev) => ({
      ...defaultItemForm(selectedDay?.iso, calendarMode === "deliveries" ? "delivery" : prev.kind),
      projectId: prev.projectId,
      assignedTo: prev.assignedTo,
    }));
    setNotice(text.created);
    setBusy(null);
    await loadSchedule();
  }

  async function saveProjectDates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectForm.projectId) return;
    setBusy("dates");
    setNotice("");

    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_project_dates",
        projectId: projectForm.projectId,
        startDate: projectForm.startDate || null,
        endDate: projectForm.endDate || null,
      }),
    });

    if (!response.ok) {
      setNotice(`${text.writeFailed} ${await readRouteError(response)}`);
      setBusy(null);
      return;
    }

    setNotice(text.saved);
    setBusy(null);
    await loadSchedule();
  }

  function selectProjectForDates(projectId: string) {
    const project = projectsById.get(projectId);
    setProjectForm({
      projectId,
      startDate: project?.start_date ?? "",
      endDate: project?.end_date ?? "",
    });
  }

  function renderCalendarItemForm(title: string, buttonText: string) {
    return (
      <form className="space-y-3" onSubmit={(event) => void createCalendarItem(event)}>
        <div className="flex items-center gap-2">
          <Plus size={17} className="text-[var(--brand-yellow)]" />
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
        </div>

        <label className="grid gap-1 text-xs text-[var(--text-muted)]">
          <span className="uppercase tracking-[0.14em]">{text.titleLabel}</span>
          <input
            value={itemForm.title}
            onChange={(event) => setItemForm((prev) => ({ ...prev, title: event.target.value }))}
            required
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.typeLabel}</span>
            <select
              value={itemForm.kind}
              onChange={(event) => setItemForm((prev) => ({ ...prev, kind: event.target.value as ScheduleKind }))}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="meeting">{text.meeting}</option>
              <option value="task">{text.task}</option>
              <option value="note">{text.note}</option>
              <option value="delivery">{text.delivery}</option>
            </select>
          </label>

          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.projectLabel}</span>
            <select
              value={itemForm.projectId}
              onChange={(event) => setItemForm((prev) => ({ ...prev, projectId: event.target.value }))}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="">{text.noProject}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-xs text-[var(--text-muted)]">
          <span className="uppercase tracking-[0.14em]">
            {itemForm.kind === "delivery" ? text.driverLabel : text.assigneeLabel}
          </span>
          <select
            value={itemForm.assignedTo}
            onChange={(event) => setItemForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{itemForm.kind === "delivery" ? text.noDriver : text.noAssignee}</option>
            {assignmentOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.role}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.startLabel}</span>
            <input
              type="datetime-local"
              value={itemForm.startsAt}
              onChange={(event) => setItemForm((prev) => ({ ...prev, startsAt: event.target.value }))}
              required
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.endLabel}</span>
            <input
              type="datetime-local"
              value={itemForm.endsAt}
              onChange={(event) => setItemForm((prev) => ({ ...prev, endsAt: event.target.value }))}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
        </div>

        <label className="grid gap-1 text-xs text-[var(--text-muted)]">
          <span className="uppercase tracking-[0.14em]">{text.notesLabel}</span>
          <textarea
            value={itemForm.description}
            onChange={(event) => setItemForm((prev) => ({ ...prev, description: event.target.value }))}
            className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
        </label>

        <button type="submit" disabled={busy === "item"} className="button-base button-primary w-full">
          {busy === "item" ? text.creating : buttonText}
        </button>
      </form>
    );
  }

  return (
    <div className="mx-auto max-w-[1800px] space-y-5 p-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {text.eyebrow}
          </p>
          <h1 className="text-[30px] font-bold text-[var(--text-primary)]">{text.title}</h1>
          <p className="max-w-[820px] text-sm leading-6 text-[var(--text-secondary)]">
            {text.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchorYear((year) => year - 1)}
            title={text.previousYear}
            aria-label={text.previousYear}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-[90px] text-center text-2xl font-black text-[var(--text-primary)]">
            {anchorYear}
          </div>
          <button
            type="button"
            onClick={() => setAnchorYear((year) => year + 1)}
            title={text.nextYear}
            aria-label={text.nextYear}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={() => setAnchorYear(new Date().getFullYear())}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]"
          >
            {text.today}
          </button>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "general", label: text.generalCalendar, icon: CalendarDays },
              { key: "deliveries", label: text.deliveryCalendar, icon: Truck },
            ] as const
          ).map(({ key, label, icon: Icon }) => {
            const active = calendarMode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCalendarMode(key)}
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm font-semibold transition"
                style={{
                  background: active ? "rgba(191, 162, 52, 0.2)" : "transparent",
                  color: active ? "var(--brand-yellow)" : "var(--text-secondary)",
                  border: active ? "1px solid rgba(191, 162, 52, 0.34)" : "1px solid transparent",
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>
        {loading ? <span className="px-2 text-xs text-[var(--text-muted)]">{text.loading}</span> : null}
      </section>

      {notice ? (
        <div
          className="rounded-[var(--radius-md)] border px-3 py-3 text-sm"
          style={{
            background: "rgba(191, 162, 52, 0.12)",
            borderColor: "rgba(191, 162, 52, 0.24)",
            color: "var(--brand-yellow)",
          }}
        >
          {notice}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {yearMonths.map(({ month, days }) => (
            <section key={month.toISOString()} className="surface-card overflow-hidden p-0">
              <div className="border-b border-[var(--border-default)] px-3 py-2">
                <h2 className="text-sm font-black capitalize text-[var(--text-primary)]">
                  {monthLabel(month, locale)}
                </h2>
              </div>
              <div className="grid grid-cols-7 border-b border-[var(--border-default)]">
                {weekdayLabels.map((label) => (
                  <div
                    key={label}
                    className="px-1 py-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const dayEntries = entriesByDay.get(day.iso) ?? [];
                  return (
                    <div
                      key={day.iso}
                      role="button"
                      tabIndex={0}
                      onClick={() => openDay(day)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openDay(day);
                        }
                      }}
                      title={`${text.openDay}: ${dayLongLabel(day.iso, locale)}`}
                      className="min-h-[82px] cursor-pointer border-b border-r border-[var(--border-subtle)] p-1.5 outline-none transition hover:bg-[rgba(191,162,52,0.08)]"
                      style={{
                        background: day.inMonth ? "transparent" : "rgba(15, 17, 23, 0.24)",
                      }}
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <span
                          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold"
                          style={{
                            background: day.isToday ? "var(--brand-yellow)" : "transparent",
                            color: day.isToday
                              ? "var(--text-inverse)"
                              : day.inMonth
                                ? "var(--text-primary)"
                                : "var(--text-muted)",
                          }}
                        >
                          {day.date.getDate()}
                        </span>
                        {dayEntries.length > 0 ? (
                          <span className="text-[9px] font-bold text-[var(--brand-yellow)]">
                            {dayEntries.length}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {dayEntries.slice(0, 3).map((entry) => {
                          const style = entryStyle(entry.tone);
                          const time = timeLabel(entry.startsAt, locale);
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedEntry(entry);
                              }}
                              className="block w-full rounded-[var(--radius-sm)] border px-1.5 py-1 text-left"
                              style={style}
                            >
                              <div className="truncate text-[10px] font-semibold">{entry.title}</div>
                              <div className="truncate text-[9px] opacity-80">
                                {time ? `${time} · ` : ""}
                                {entryTypeLabel(entry.type, text)}
                              </div>
                            </button>
                          );
                        })}
                        {dayEntries.length > 3 ? (
                          <div className="text-[9px] font-semibold text-[var(--text-muted)]">
                            +{dayEntries.length - 3} {text.more}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <aside className="space-y-5">
          <section className="surface-card p-4">
            {renderCalendarItemForm(text.newItem, text.create)}
            {currentProfile ? (
              <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <UserRound size={13} />
                <span>
                  {currentProfile.name} · {currentProfile.role}
                </span>
              </div>
            ) : null}
          </section>

          <form className="surface-card space-y-3 p-4" onSubmit={(event) => void saveProjectDates(event)}>
            <div className="flex items-center gap-2">
              <Flag size={17} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.datesTitle}</h2>
            </div>
            <label className="grid gap-1 text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-[0.14em]">{text.projectLabel}</span>
              <select
                value={projectForm.projectId}
                onChange={(event) => selectProjectForDates(event.target.value)}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                {projects.length === 0 ? <option value="">{text.noProjects}</option> : null}
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="grid gap-1 text-xs text-[var(--text-muted)]">
                <span className="uppercase tracking-[0.14em]">{text.starts}</span>
                <input
                  type="date"
                  value={projectForm.startDate}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, startDate: event.target.value }))}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </label>
              <label className="grid gap-1 text-xs text-[var(--text-muted)]">
                <span className="uppercase tracking-[0.14em]">{text.deadline}</span>
                <input
                  type="date"
                  value={projectForm.endDate}
                  onChange={(event) => setProjectForm((prev) => ({ ...prev, endDate: event.target.value }))}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
                />
              </label>
            </div>
            <button type="submit" disabled={busy === "dates" || !projectForm.projectId} className="button-base button-primary w-full">
              <Save size={15} />
              {busy === "dates" ? text.saving : text.saveDates}
            </button>
          </form>

          <section className="surface-card space-y-3 p-4">
            <div className="flex items-center gap-2">
              <Clock3 size={17} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.deadlines}</h2>
            </div>
            {projectDeadlines.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {text.noDeadlines}
              </div>
            ) : (
              <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
                {projectDeadlines.map(({ project, health }) => {
                  const style = projectScheduleToneStyle(health.tone);
                  const progress = Math.round(health.elapsedPercent ?? 0);
                  return (
                    <div
                      key={project.id}
                      className="rounded-[var(--radius-md)] border p-3"
                      style={{ borderColor: style.borderColor, background: style.background }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[var(--text-primary)]">{project.name}</div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {project.start_date ?? "—"} → {project.end_date}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs font-semibold" style={{ color: style.color }}>
                          {formatProjectCountdown(health, locale)}
                        </div>
                      </div>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(0,0,0,0.25)]">
                        <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: style.color }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-muted)]">
                        <span>{scheduleStateLabel(health.state, text)}</span>
                        <span>{progress}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </section>

      {selectedDay ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.58)" }}
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="surface-card max-h-[92vh] w-full max-w-[900px] overflow-auto p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {calendarMode === "deliveries" ? text.deliveryCalendar : text.dayPlanner}
                </div>
                <h2 className="mt-1 text-xl font-bold capitalize text-[var(--text-primary)]">
                  {dayLongLabel(selectedDay.iso, locale)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section className="space-y-3">
                <h3 className="text-sm font-bold text-[var(--text-primary)]">{text.itemsOnDay}</h3>
                {selectedDayEntries.length === 0 ? (
                  <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                    {text.noEntries}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEntries.map((entry) => {
                      const style = entryStyle(entry.tone);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedEntry(entry)}
                          className="block w-full rounded-[var(--radius-md)] border p-3 text-left"
                          style={style}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold">{entry.title}</div>
                              <div className="mt-1 text-xs opacity-80">
                                {timeLabel(entry.startsAt, locale) ?? "—"} · {entryTypeLabel(entry.type, text)}
                              </div>
                            </div>
                            {entry.assigneeName ? (
                              <div className="shrink-0 text-xs font-semibold opacity-80">{entry.assigneeName}</div>
                            ) : null}
                          </div>
                          {entry.projectName ? (
                            <div className="mt-2 text-xs opacity-80">{entry.projectName}</div>
                          ) : null}
                          {entry.description ? (
                            <div className="mt-2 line-clamp-3 text-xs opacity-80">{entry.description}</div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(15,17,23,0.32)] p-3">
                <form className="mb-4 space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-3" onSubmit={(event) => void saveProjectDates(event)}>
                  <div className="flex items-center gap-2">
                    <Flag size={15} className="text-[var(--brand-yellow)]" />
                    <h3 className="text-sm font-bold text-[var(--text-primary)]">{text.datesTitle}</h3>
                  </div>
                  <label className="grid gap-1 text-xs text-[var(--text-muted)]">
                    <span className="uppercase tracking-[0.14em]">{text.projectLabel}</span>
                    <select
                      value={projectForm.projectId}
                      onChange={(event) => selectProjectForDates(event.target.value)}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                    >
                      {projects.length === 0 ? <option value="">{text.noProjects}</option> : null}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setProjectForm((prev) => ({ ...prev, startDate: selectedDay.iso }))}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
                    >
                      {text.useAsStart}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProjectForm((prev) => ({ ...prev, endDate: selectedDay.iso }))}
                      className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
                    >
                      {text.useAsDeadline}
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      type="date"
                      value={projectForm.startDate}
                      onChange={(event) => setProjectForm((prev) => ({ ...prev, startDate: event.target.value }))}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                    />
                    <input
                      type="date"
                      value={projectForm.endDate}
                      onChange={(event) => setProjectForm((prev) => ({ ...prev, endDate: event.target.value }))}
                      className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                    />
                  </div>
                  <button type="submit" disabled={busy === "dates" || !projectForm.projectId} className="button-base button-primary w-full">
                    <Save size={15} />
                    {busy === "dates" ? text.saving : text.saveDates}
                  </button>
                </form>
                {renderCalendarItemForm(text.addToDay, text.create)}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {selectedEntry ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.62)" }}
          onClick={() => setSelectedEntry(null)}
        >
          <div className="surface-card w-full max-w-[560px] p-4" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {entryTypeLabel(selectedEntry.type, text)}
                </div>
                <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">{selectedEntry.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntry(null)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-default)] text-[var(--text-secondary)]"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-4 grid gap-2 text-sm text-[var(--text-secondary)]">
              {selectedEntry.startsAt ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">{text.startLabel}:</span>{" "}
                  {dateTimeLabel(selectedEntry.startsAt, locale)}
                </div>
              ) : null}
              {selectedEntry.endsAt ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">{text.endLabel}:</span>{" "}
                  {dateTimeLabel(selectedEntry.endsAt, locale)}
                </div>
              ) : null}
              {selectedEntry.projectName ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">{text.projectLabel}:</span>{" "}
                  {selectedEntry.projectName}
                </div>
              ) : null}
              {selectedEntry.assigneeName ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">
                    {selectedEntry.type === "delivery" ? text.driverLabel : text.assigneeLabel}:
                  </span>{" "}
                  {selectedEntry.assigneeName}
                </div>
              ) : null}
              {selectedEntry.description ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-[var(--text-primary)]">
                  {selectedEntry.description}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
