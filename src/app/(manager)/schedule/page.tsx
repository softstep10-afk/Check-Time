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

type ScheduleKind = "meeting" | "task" | "note";
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

const CALENDAR_ROLES: UserRole[] = ["owner", "admin", "manager", "supervisor", "sales"];

const TEXT = {
  en: {
    eyebrow: "Schedule",
    title: "Team calendar",
    subtitle: "Meetings, tasks, sales appointments, and project deadlines in one calendar.",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    newItem: "New calendar item",
    titleLabel: "Title",
    typeLabel: "Type",
    projectLabel: "Project",
    assigneeLabel: "Person",
    startLabel: "Start",
    endLabel: "End",
    notesLabel: "Notes",
    noProject: "No project",
    noAssignee: "No person",
    create: "Create item",
    creating: "Creating...",
    datesTitle: "Project dates",
    saveDates: "Save dates",
    saving: "Saving...",
    deadlines: "Project deadlines",
    noEntries: "No items",
    noDeadlines: "No project deadlines yet.",
    noProjects: "No projects",
    starts: "Start",
    deadline: "Deadline",
    meeting: "Meeting",
    task: "Task",
    note: "Note",
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
  },
  ru: {
    eyebrow: "Расписание",
    title: "Календарь команды",
    subtitle: "Встречи, задачи, выезды sales и дедлайны проектов в одном календаре.",
    today: "Сегодня",
    previousMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    newItem: "Новая запись",
    titleLabel: "Название",
    typeLabel: "Тип",
    projectLabel: "Проект",
    assigneeLabel: "Кому",
    startLabel: "Начало",
    endLabel: "Конец",
    notesLabel: "Заметки",
    noProject: "Без проекта",
    noAssignee: "Без человека",
    create: "Создать запись",
    creating: "Создаю...",
    datesTitle: "Даты проекта",
    saveDates: "Сохранить даты",
    saving: "Сохраняю...",
    deadlines: "Дедлайны проектов",
    noEntries: "Нет записей",
    noDeadlines: "Пока нет дедлайнов проектов.",
    noProjects: "Нет проектов",
    starts: "Старт",
    deadline: "Дедлайн",
    meeting: "Встреча",
    task: "Задача",
    note: "Заметка",
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

function defaultItemForm(): ItemForm {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  return {
    title: "",
    kind: "meeting",
    projectId: "",
    assignedTo: "",
    startsAt: toDatetimeLocalValue(start),
    endsAt: toDatetimeLocalValue(end),
    description: "",
  };
}

function monthLabel(date: Date, locale: "en" | "ru"): string {
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
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
  if (kind === "meeting" || kind === "task" || kind === "note") return kind;
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
  const [anchorMonth, setAnchorMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [itemForm, setItemForm] = useState<ItemForm>(() => defaultItemForm());
  const [projectForm, setProjectForm] = useState<ProjectDateForm>({
    projectId: "",
    startDate: "",
    endDate: "",
  });

  const gridStart = useMemo(() => startOfCalendarGrid(anchorMonth), [anchorMonth]);
  const gridDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index);
      return {
        date,
        iso: isoDay(date),
        inMonth: date.getMonth() === anchorMonth.getMonth(),
        isToday: isoDay(date) === isoDay(new Date()),
      };
    });
  }, [anchorMonth, gridStart]);
  const gridEnd = gridDays[gridDays.length - 1]?.iso ?? isoDay(gridStart);

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
        .gte("due_date", isoDay(gridStart))
        .lte("due_date", gridEnd)
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
  }, [gridEnd, gridStart, supabase, text.loadFailed]);

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

  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const scheduleProfiles = useMemo(() => {
    return profiles.filter((profile) => profile.is_active && CALENDAR_ROLES.includes(profile.role));
  }, [profiles]);

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
          tone: kind === "meeting" ? "blue" : kind === "note" ? "neutral" : "yellow",
        };
      })
      .filter((entry): entry is CalendarEntry => entry !== null);

    const projectEntries = projects.flatMap((project): CalendarEntry[] => {
      const health = deriveProjectScheduleHealth({
        startDate: project.start_date,
        endDate: project.end_date,
      });
      const out: CalendarEntry[] = [];
      if (project.start_date) {
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
      if (project.end_date) {
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
  }, [locale, profilesById, projects, projectsById, tasks, text]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.dayIso) ?? [];
      list.push(entry);
      map.set(entry.dayIso, list);
    }
    return map;
  }, [entries]);

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
      ...defaultItemForm(),
      kind: prev.kind,
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

  const weekdayLabels =
    locale === "ru"
      ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {text.eyebrow}
          </p>
          <h1 className="text-[30px] font-bold text-[var(--text-primary)]">{text.title}</h1>
          <p className="max-w-[760px] text-sm leading-6 text-[var(--text-secondary)]">
            {text.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            title={text.previousMonth}
            aria-label={text.previousMonth}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setAnchorMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)]"
          >
            {text.today}
          </button>
          <button
            type="button"
            onClick={() => setAnchorMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            title={text.nextMonth}
            aria-label={text.nextMonth}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronRight size={18} />
          </button>
        </div>
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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="surface-card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold capitalize text-[var(--text-primary)]">
                {monthLabel(anchorMonth, locale)}
              </h2>
            </div>
            {loading ? <span className="text-xs text-[var(--text-muted)]">{text.loading}</span> : null}
          </div>

          <div className="grid grid-cols-7 border-b border-[var(--border-default)]">
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {gridDays.map((day) => {
              const dayEntries = entriesByDay.get(day.iso) ?? [];
              return (
                <div
                  key={day.iso}
                  className="min-h-[138px] border-b border-r border-[var(--border-subtle)] p-2"
                  style={{
                    background: day.inMonth ? "transparent" : "rgba(15, 17, 23, 0.24)",
                  }}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold"
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
                  </div>
                  <div className="space-y-1">
                    {dayEntries.slice(0, 5).map((entry) => {
                      const style = entryStyle(entry.tone);
                      const time = timeLabel(entry.startsAt, locale);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setSelectedEntry(entry)}
                          className="block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-left"
                          style={style}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[11px] font-semibold">{entry.title}</span>
                          </div>
                          <div className="mt-0.5 truncate text-[10px] opacity-80">
                            {time ? `${time} · ` : ""}
                            {entryTypeLabel(entry.type, text)}
                          </div>
                        </button>
                      );
                    })}
                    {dayEntries.length === 0 ? (
                      <div className="pt-2 text-[10px] text-[var(--text-muted)]">{text.noEntries}</div>
                    ) : null}
                    {dayEntries.length > 5 ? (
                      <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                        +{dayEntries.length - 5}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-5">
          <form className="surface-card space-y-3 p-4" onSubmit={(event) => void createCalendarItem(event)}>
            <div className="flex items-center gap-2">
              <Plus size={17} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.newItem}</h2>
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
              <span className="uppercase tracking-[0.14em]">{text.assigneeLabel}</span>
              <select
                value={itemForm.assignedTo}
                onChange={(event) => setItemForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                <option value="">{text.noAssignee}</option>
                {scheduleProfiles.map((profile) => (
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
                className="min-h-[84px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>

            <button type="submit" disabled={busy === "item"} className="button-base button-primary w-full">
              {busy === "item" ? text.creating : text.create}
            </button>
            {currentProfile ? (
              <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                <UserRound size={13} />
                <span>{currentProfile.name} · {currentProfile.role}</span>
              </div>
            ) : null}
          </form>

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
              <div className="space-y-2">
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

      {selectedEntry ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.58)" }}
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
                  <span className="font-semibold text-[var(--text-primary)]">{text.assigneeLabel}:</span>{" "}
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
