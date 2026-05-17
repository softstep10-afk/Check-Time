"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Hand,
  Plus,
  Save,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isLiveRefreshBlocked } from "@/lib/client-interaction";
import { useTranslation } from "@/lib/i18n";
import {
  deriveProjectScheduleHealth,
  formatProjectCountdown,
  projectScheduleToneStyle,
} from "@/lib/project-schedule";
import type { Profile, Project, Task, UserRole } from "@/types/database";

type ScheduleKind =
  | "client_meeting"
  | "worker_meeting"
  | "inspection"
  | "subcontractor_meeting"
  | "site_visit"
  | "meeting"
  | "task"
  | "note"
  | "delivery";
type CalendarMode = "general" | "deliveries";
type EntrySource = "task" | "project";
type EntryType = ScheduleKind | "project_start" | "project_deadline";
type DeliveryStatus = "open" | "assigned" | "claimed" | "in_progress" | "delivered";

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
  assigneeId: string | null;
  description: string | null;
  tone: "neutral" | "green" | "yellow" | "red" | "blue";
  status: Task["status"] | null;
  deliveryStatus: DeliveryStatus | null;
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

const DELIVERY_ONLY_ROLES = new Set<UserRole>(["worker", "driver", "subcontractor"]);

const GENERAL_EVENT_KINDS: ScheduleKind[] = [
  "client_meeting",
  "worker_meeting",
  "inspection",
  "subcontractor_meeting",
  "site_visit",
  "task",
  "note",
];

const DELIVERY_ASSIGNEE_ROLES = new Set<UserRole>([
  "worker",
  "driver",
  "subcontractor",
  "supervisor",
  "sales",
  "manager",
  "admin",
  "owner",
]);

const TEXT = {
  en: {
    eyebrow: "Schedule",
    title: "Team calendar",
    subtitle: "One full-screen month for meetings, notes, project work, deliveries, and project deadlines.",
    today: "Today",
    previousMonth: "Previous month",
    nextMonth: "Next month",
    dateFrom: "From",
    dateTo: "To",
    resetRange: "Reset dates",
    generalCalendar: "Team calendar",
    deliveryCalendar: "Delivery calendar",
    newItem: "New calendar item",
    addToDay: "Add to this day",
    titleLabel: "Title",
    typeLabel: "Type",
    projectLabel: "Project",
    assigneeLabel: "Person",
    driverLabel: "Driver",
    deliveryPersonLabel: "Who takes it / assign to",
    startLabel: "Start",
    endLabel: "End",
    notesLabel: "Notes",
    noProject: "No project",
    noAssignee: "No person",
    noDriver: "Whole team",
    allDeliveryPeople: "Leave this empty when anyone on the team can take it.",
    deliveryTitlePlaceholder: "What needs to be delivered?",
    eventTitlePlaceholder: "Meeting, inspection, visit, or note",
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
    clientMeeting: "Client meeting",
    workerMeeting: "Worker meeting",
    inspection: "Inspection",
    subcontractorMeeting: "Subcontractor meeting",
    siteVisit: "Site visit",
    task: "Task",
    note: "Note",
    delivery: "Delivery",
    deliveryStatus: "Delivery status",
    deliveryOpen: "Open to team",
    deliveryAssigned: "Assigned",
    deliveryClaimed: "Taken",
    deliveryInProgress: "In progress",
    deliveryDelivered: "Delivered",
    takeDelivery: "I will take it",
    markDelivered: "Mark delivered",
    deliveryActionSaved: "Delivery updated.",
    deliveryActionFailed: "Could not update delivery.",
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
    deliveryOnlyHint: "Workers see only deliveries here. Meetings, project dates, and internal planning stay hidden.",
  },
  ru: {
    eyebrow: "Расписание",
    title: "Календарь команды",
    subtitle: "Один большой месяц на весь экран для встреч, заметок, проектных работ, доставок и дедлайнов.",
    today: "Сегодня",
    previousMonth: "Предыдущий месяц",
    nextMonth: "Следующий месяц",
    dateFrom: "От",
    dateTo: "До",
    resetRange: "Сбросить даты",
    generalCalendar: "Календарь команды",
    deliveryCalendar: "Календарь доставок",
    newItem: "Новая запись",
    addToDay: "Добавить в этот день",
    titleLabel: "Название",
    typeLabel: "Тип",
    projectLabel: "Проект",
    assigneeLabel: "Кому",
    driverLabel: "Водитель",
    deliveryPersonLabel: "Кто возьмёт / кому поручить",
    startLabel: "Начало",
    endLabel: "Конец",
    notesLabel: "Заметки",
    noProject: "Без проекта",
    noAssignee: "Без человека",
    noDriver: "Вся команда",
    allDeliveryPeople: "Оставьте пустым, если доставку может взять любой из команды.",
    deliveryTitlePlaceholder: "Что нужно доставить?",
    eventTitlePlaceholder: "Встреча, инспекция, выезд или заметка",
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
    clientMeeting: "Встреча с клиентом",
    workerMeeting: "Встреча с работником",
    inspection: "Инспекция",
    subcontractorMeeting: "Встреча с субконтрактором",
    siteVisit: "Выезд на объект",
    task: "Задача",
    note: "Заметка",
    delivery: "Доставка",
    deliveryStatus: "Статус доставки",
    deliveryOpen: "Свободно для команды",
    deliveryAssigned: "Назначено",
    deliveryClaimed: "Взял в работу",
    deliveryInProgress: "В дороге",
    deliveryDelivered: "Доставлено",
    takeDelivery: "Возьму",
    markDelivered: "Доставлено",
    deliveryActionSaved: "Доставка обновлена.",
    deliveryActionFailed: "Не удалось обновить доставку.",
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
    deliveryOnlyHint: "Рабочие видят здесь только доставки. Встречи, даты проектов и внутренние планы скрыты.",
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

function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : "";
}

function timeInputValue(value: string | null): string {
  return value && value.length >= 16 ? value.slice(11, 16) : "";
}

function withDateInputValue(value: string, date: string, fallbackTime: string): string {
  if (!date) return "";
  return `${date}T${timeInputValue(value) || fallbackTime}`;
}

function withTimeInputValue(value: string, time: string, fallbackDate: string, fallbackTime: string): string {
  const date = dateInputValue(value) || fallbackDate;
  if (!date) return "";
  return `${date}T${time || fallbackTime}`;
}

function dateFromIsoDay(dayIso: string, hour = 9): Date {
  const date = new Date(`${dayIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return new Date();
  date.setHours(hour, 0, 0, 0);
  return date;
}

function defaultItemForm(dayIso?: string, kind: ScheduleKind = "client_meeting"): ItemForm {
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

function monthStartIso(month: Date): string {
  return isoDay(new Date(month.getFullYear(), month.getMonth(), 1));
}

function monthEndIso(month: Date): string {
  return isoDay(new Date(month.getFullYear(), month.getMonth() + 1, 0));
}

function usScheduleDateLocale(locale: "en" | "ru"): "en-US" {
  switch (locale) {
    case "en":
    case "ru":
      return "en-US";
  }
}

function monthLabel(date: Date, locale: "en" | "ru"): string {
  return new Intl.DateTimeFormat(usScheduleDateLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(date);
}

function dayLongLabel(value: string, locale: "en" | "ru"): string {
  return new Intl.DateTimeFormat(usScheduleDateLocale(locale), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dateFromIsoDay(value, 12));
}

function dateOnlyLabel(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(dateFromIsoDay(value.slice(0, 10), 12));
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
  return new Intl.DateTimeFormat(usScheduleDateLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function entryTypeLabel(type: EntryType, text: ScheduleText): string {
  if (type === "client_meeting") return text.clientMeeting;
  if (type === "worker_meeting") return text.workerMeeting;
  if (type === "inspection") return text.inspection;
  if (type === "subcontractor_meeting") return text.subcontractorMeeting;
  if (type === "site_visit") return text.siteVisit;
  if (type === "meeting") return text.meeting;
  if (type === "task") return text.task;
  if (type === "note") return text.note;
  if (type === "delivery") return text.delivery;
  if (type === "project_start") return text.projectStart;
  return text.projectDeadline;
}

function deliveryStatusFromTask(
  task: Task,
  metadata: Record<string, unknown>,
): DeliveryStatus | null {
  if (metadata.schedule_kind !== "delivery") return null;
  if (task.status === "done" || task.completed_at) return "delivered";
  const raw = metadata.schedule_delivery_status;
  if (
    raw === "open" ||
    raw === "assigned" ||
    raw === "claimed" ||
    raw === "in_progress" ||
    raw === "delivered"
  ) {
    return raw;
  }
  if (task.assigned_to) return "assigned";
  return "open";
}

function deliveryStatusLabel(status: DeliveryStatus, text: ScheduleText): string {
  if (status === "open") return text.deliveryOpen;
  if (status === "assigned") return text.deliveryAssigned;
  if (status === "claimed") return text.deliveryClaimed;
  if (status === "in_progress") return text.deliveryInProgress;
  return text.deliveryDelivered;
}

function deliveryStatusTone(status: DeliveryStatus): CalendarEntry["tone"] {
  if (status === "delivered") return "green";
  if (status === "open") return "blue";
  return "yellow";
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
  if (
    kind === "client_meeting" ||
    kind === "worker_meeting" ||
    kind === "inspection" ||
    kind === "subcontractor_meeting" ||
    kind === "site_visit" ||
    kind === "meeting" ||
    kind === "task" ||
    kind === "note" ||
    kind === "delivery"
  ) {
    return kind;
  }
  return "task";
}

function isMeetingKind(kind: EntryType): boolean {
  return (
    kind === "meeting" ||
    kind === "client_meeting" ||
    kind === "worker_meeting" ||
    kind === "subcontractor_meeting"
  );
}

async function readRouteError(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return `Request failed (${response.status})`;
}

export default function SchedulePageClient() {
  const supabase = useMemo(() => createClient(), []);
  const { locale } = useTranslation();
  const text = TEXT[locale];
  const realtimeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimePendingWhileHiddenRef = useRef(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"item" | "dates" | "delivery" | null>(null);
  const [notice, setNotice] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<CalendarEntry | null>(null);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("general");
  const [anchorMonth, setAnchorMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [itemForm, setItemForm] = useState<ItemForm>(() => defaultItemForm());
  const [projectForm, setProjectForm] = useState<ProjectDateForm>({
    projectId: "",
    startDate: "",
    endDate: "",
  });
  const deliveryOnlyCalendar = currentProfile ? DELIVERY_ONLY_ROLES.has(currentProfile.role) : false;
  const canUseGeneralCalendar = !deliveryOnlyCalendar;
  const showProjectDateTools = canUseGeneralCalendar && calendarMode === "general";

  const weekdayLabels =
    locale === "ru"
      ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const monthGridStart = useMemo(() => startOfCalendarGrid(anchorMonth), [anchorMonth]);
  const monthDays = useMemo(() => {
    return Array.from({ length: 42 }, (_, index) => {
      const date = addDays(monthGridStart, index);
      return {
        date,
        iso: isoDay(date),
        inMonth: date.getMonth() === anchorMonth.getMonth(),
        isToday: isoDay(date) === isoDay(new Date()),
      };
    });
  }, [anchorMonth, monthGridStart]);
  const monthGridEnd = monthDays[monthDays.length - 1]?.iso ?? isoDay(monthGridStart);
  const loadStart = [isoDay(monthGridStart), rangeStart].filter(Boolean).sort()[0] ?? isoDay(monthGridStart);
  const loadEnd = [monthGridEnd, rangeEnd].filter(Boolean).sort().at(-1) ?? monthGridEnd;

  const loadSchedule = useCallback(async (options: { showLoading?: boolean } = {}) => {
    const showLoading = options.showLoading ?? true;
    if (showLoading) setLoading(true);
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
        .gte("due_date", loadStart)
        .lte("due_date", loadEnd)
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
  }, [loadEnd, loadStart, supabase, text.loadFailed]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSchedule();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadSchedule]);

  useEffect(() => {
    function scheduleLoad() {
      if (document.visibilityState !== "visible") {
        realtimePendingWhileHiddenRef.current = true;
        return;
      }
      if (realtimeTimerRef.current) return;
      if (isLiveRefreshBlocked() || selectedDay || selectedEntry) {
        realtimeTimerRef.current = setTimeout(() => {
          realtimeTimerRef.current = null;
          scheduleLoad();
        }, 2500);
        return;
      }
      realtimeTimerRef.current = setTimeout(() => {
        realtimeTimerRef.current = null;
        void loadSchedule({ showLoading: false });
      }, 1800);
    }

    const channel = supabase
      .channel("schedule-calendar-refresh")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, scheduleLoad)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, scheduleLoad)
      .subscribe();

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || !realtimePendingWhileHiddenRef.current) return;
      realtimePendingWhileHiddenRef.current = false;
      scheduleLoad();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (realtimeTimerRef.current) {
        clearTimeout(realtimeTimerRef.current);
        realtimeTimerRef.current = null;
      }
      realtimePendingWhileHiddenRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [loadSchedule, selectedDay, selectedEntry, supabase]);

  useEffect(() => {
    setItemForm((prev) => {
      const nextKind =
        calendarMode === "deliveries"
          ? "delivery"
          : prev.kind === "delivery" || prev.kind === "meeting"
            ? "client_meeting"
            : prev.kind;
      return prev.kind === nextKind ? prev : { ...prev, kind: nextKind };
    });
  }, [calendarMode]);

  useEffect(() => {
    if (!deliveryOnlyCalendar) return;
    setCalendarMode("deliveries");
    setItemForm((prev) => (prev.kind === "delivery" ? prev : { ...prev, kind: "delivery" }));
  }, [deliveryOnlyCalendar]);

  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);

  const activeProfiles = useMemo(() => {
    return profiles.filter((profile) => profile.is_active && CALENDAR_ROLES.includes(profile.role));
  }, [profiles]);

  const deliveryProfiles = useMemo(() => {
    return activeProfiles.filter((profile) => DELIVERY_ASSIGNEE_ROLES.has(profile.role));
  }, [activeProfiles]);

  const assignmentOptions =
    calendarMode === "deliveries" || deliveryOnlyCalendar || itemForm.kind === "delivery"
      ? deliveryProfiles
      : activeProfiles;

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
        const deliveryStatus = deliveryStatusFromTask(task, metadata);

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
          assigneeId: task.assigned_to,
          description: task.description,
          tone:
            deliveryStatus
              ? deliveryStatusTone(deliveryStatus)
              : isMeetingKind(kind)
                ? "blue"
                : kind === "site_visit"
                  ? "green"
                  : kind === "note"
                    ? "neutral"
                    : "yellow",
          status: task.status,
          deliveryStatus,
        };
      })
      .filter((entry): entry is CalendarEntry => entry !== null);

    const projectEntries = projects.flatMap((project): CalendarEntry[] => {
      const health = deriveProjectScheduleHealth({
        startDate: project.start_date,
        endDate: project.end_date,
      });
      const out: CalendarEntry[] = [];
      if (project.start_date && project.start_date >= loadStart && project.start_date <= loadEnd) {
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
          assigneeId: null,
          description: project.address,
          tone: "green",
          status: null,
          deliveryStatus: null,
        });
      }
      if (project.end_date && project.end_date >= loadStart && project.end_date <= loadEnd) {
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
          assigneeId: null,
          description: `${scheduleStateLabel(health.state, text)} · ${formatProjectCountdown(health, locale)}`,
          tone: health.tone,
          status: null,
          deliveryStatus: null,
        });
      }
      return out;
    });

    return [...taskEntries, ...projectEntries].sort((a, b) => {
      const aTime = a.startsAt ? new Date(a.startsAt).getTime() : 0;
      const bTime = b.startsAt ? new Date(b.startsAt).getTime() : 0;
      return aTime - bTime;
    });
  }, [loadEnd, loadStart, locale, profilesById, projects, projectsById, tasks, text]);

  const visibleEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (rangeStart && entry.dayIso < rangeStart) return false;
      if (rangeEnd && entry.dayIso > rangeEnd) return false;
      if (deliveryOnlyCalendar) return entry.type === "delivery";
      if (calendarMode === "deliveries") return entry.type === "delivery";
      if (entry.type === "delivery") return false;
      return true;
    });
  }, [calendarMode, deliveryOnlyCalendar, entries, rangeEnd, rangeStart]);

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
      ...defaultItemForm(
        day.iso,
        calendarMode === "deliveries" || deliveryOnlyCalendar
          ? "delivery"
          : prev.kind === "delivery" || prev.kind === "meeting"
            ? "client_meeting"
            : prev.kind,
      ),
      projectId: prev.projectId,
      assignedTo: prev.assignedTo,
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
        kind: calendarMode === "deliveries" || deliveryOnlyCalendar ? "delivery" : itemForm.kind,
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
      ...defaultItemForm(
        selectedDay?.iso,
        calendarMode === "deliveries" || deliveryOnlyCalendar
          ? "delivery"
          : prev.kind === "meeting"
            ? "client_meeting"
            : prev.kind,
      ),
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

  async function updateDeliveryStatus(action: "claim_delivery" | "complete_delivery", taskId: string) {
    setBusy("delivery");
    setNotice("");

    const response = await fetch("/api/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, taskId }),
    });

    if (!response.ok) {
      setNotice(`${text.deliveryActionFailed} ${await readRouteError(response)}`);
      setBusy(null);
      return;
    }

    setNotice(text.deliveryActionSaved);
    setBusy(null);
    setSelectedEntry(null);
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
    const isDeliveryForm = calendarMode === "deliveries" || deliveryOnlyCalendar;
    const effectiveKind = isDeliveryForm ? "delivery" : itemForm.kind;
    const fallbackDate = selectedDay?.iso ?? isoDay(new Date());

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
            placeholder={isDeliveryForm ? text.deliveryTitlePlaceholder : text.eventTitlePlaceholder}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {isDeliveryForm ? (
            <div className="grid gap-1 text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-[0.14em]">{text.typeLabel}</span>
              <div className="rounded-[var(--radius-md)] border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.12)] px-3 py-3 text-sm font-semibold text-[#60a5fa]">
                {text.delivery}
              </div>
            </div>
          ) : (
            <label className="grid gap-1 text-xs text-[var(--text-muted)]">
              <span className="uppercase tracking-[0.14em]">{text.typeLabel}</span>
              <select
                value={itemForm.kind === "meeting" ? "client_meeting" : itemForm.kind}
                onChange={(event) => setItemForm((prev) => ({ ...prev, kind: event.target.value as ScheduleKind }))}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              >
                {GENERAL_EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {entryTypeLabel(kind, text)}
                  </option>
                ))}
              </select>
            </label>
          )}

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
            {effectiveKind === "delivery" ? text.deliveryPersonLabel : text.assigneeLabel}
          </span>
          <select
            value={itemForm.assignedTo}
            onChange={(event) => setItemForm((prev) => ({ ...prev, assignedTo: event.target.value }))}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
          >
            <option value="">{effectiveKind === "delivery" ? text.noDriver : text.noAssignee}</option>
            {assignmentOptions.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.role}
              </option>
            ))}
          </select>
          {effectiveKind === "delivery" ? (
            <span className="text-[11px] leading-4 text-[var(--text-muted)]">{text.allDeliveryPeople}</span>
          ) : null}
        </label>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.startLabel}</span>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px] xl:grid-cols-2">
              <input
                type="date"
                value={dateInputValue(itemForm.startsAt)}
                onChange={(event) =>
                  setItemForm((prev) => ({
                    ...prev,
                    startsAt: withDateInputValue(prev.startsAt, event.target.value, "09:00"),
                  }))
                }
                required
                aria-label={text.startLabel}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <input
                type="time"
                value={timeInputValue(itemForm.startsAt)}
                onChange={(event) =>
                  setItemForm((prev) => ({
                    ...prev,
                    startsAt: withTimeInputValue(prev.startsAt, event.target.value, fallbackDate, "09:00"),
                  }))
                }
                required
                aria-label={`${text.startLabel} time`}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
          </label>
          <label className="grid gap-1 text-xs text-[var(--text-muted)]">
            <span className="uppercase tracking-[0.14em]">{text.endLabel}</span>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px] xl:grid-cols-2">
              <input
                type="date"
                value={dateInputValue(itemForm.endsAt)}
                onChange={(event) =>
                  setItemForm((prev) => ({
                    ...prev,
                    endsAt: withDateInputValue(prev.endsAt, event.target.value, "10:00"),
                  }))
                }
                aria-label={text.endLabel}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <input
                type="time"
                value={timeInputValue(itemForm.endsAt)}
                onChange={(event) =>
                  setItemForm((prev) => ({
                    ...prev,
                    endsAt: withTimeInputValue(
                      prev.endsAt,
                      event.target.value,
                      dateInputValue(prev.startsAt) || fallbackDate,
                      "10:00",
                    ),
                  }))
                }
                aria-label={`${text.endLabel} time`}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
            </div>
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
            onClick={() => setAnchorMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            title={text.previousMonth}
            aria-label={text.previousMonth}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="min-w-[220px] text-center text-2xl font-black capitalize text-[var(--text-primary)]">
            {monthLabel(anchorMonth, locale)}
          </div>
          <button
            type="button"
            onClick={() => setAnchorMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            title={text.nextMonth}
            aria-label={text.nextMonth}
            className="inline-flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] text-[var(--text-secondary)]"
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              const today = new Date();
              setAnchorMonth(new Date(today.getFullYear(), today.getMonth(), 1));
            }}
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
          )
            .filter(({ key }) => canUseGeneralCalendar || key === "deliveries")
            .map(({ key, label, icon: Icon }) => {
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
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {text.dateFrom}
            <input
              type="date"
              value={rangeStart}
              onChange={(event) => setRangeStart(event.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs normal-case tracking-normal text-[var(--text-primary)] outline-none"
            />
          </label>
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {text.dateTo}
            <input
              type="date"
              value={rangeEnd}
              onChange={(event) => setRangeEnd(event.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-2 text-xs normal-case tracking-normal text-[var(--text-primary)] outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setRangeStart("");
              setRangeEnd("");
            }}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]"
          >
            {text.resetRange}
          </button>
          {loading ? <span className="px-2 pb-2 text-xs text-[var(--text-muted)]">{text.loading}</span> : null}
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

      <section className="space-y-5">
        <div className="surface-card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-xl font-black capitalize text-[var(--text-primary)]">
                {monthLabel(anchorMonth, locale)}
              </h2>
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {dateOnlyLabel(monthStartIso(anchorMonth))} → {dateOnlyLabel(monthEndIso(anchorMonth))}
            </div>
          </div>
          <div className="grid grid-cols-7 border-b border-[var(--border-default)]">
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const dayEntries = entriesByDay.get(day.iso) ?? [];
              const outsideRange = (rangeStart && day.iso < rangeStart) || (rangeEnd && day.iso > rangeEnd);
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
                  className="min-h-[138px] cursor-pointer border-b border-r border-[var(--border-subtle)] p-2 outline-none transition hover:bg-[rgba(191,162,52,0.08)] md:min-h-[168px]"
                  style={{
                    background: day.inMonth ? "transparent" : "rgba(15, 17, 23, 0.24)",
                    opacity: outsideRange ? 0.42 : 1,
                  }}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span
                      className="inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold"
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
                      <span className="rounded-[var(--radius-pill)] bg-[rgba(191,162,52,0.16)] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-yellow)]">
                        {dayEntries.length}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {dayEntries.slice(0, 5).map((entry) => {
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
                          className="block w-full rounded-[var(--radius-sm)] border px-2 py-1 text-left"
                          style={style}
                        >
                          <div className="truncate text-[11px] font-semibold">{entry.title}</div>
                          <div className="mt-0.5 truncate text-[10px] opacity-80">
                            {time ? `${time} · ` : ""}
                            {entryTypeLabel(entry.type, text)}
                            {entry.deliveryStatus ? ` · ${deliveryStatusLabel(entry.deliveryStatus, text)}` : ""}
                          </div>
                        </button>
                      );
                    })}
                    {dayEntries.length === 0 ? (
                      <div className="pt-2 text-[10px] text-[var(--text-muted)]">{text.noEntries}</div>
                    ) : null}
                    {dayEntries.length > 5 ? (
                      <div className="text-[10px] font-semibold text-[var(--text-muted)]">
                        +{dayEntries.length - 5} {text.more}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={`grid gap-5 ${showProjectDateTools ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
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
            {deliveryOnlyCalendar ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-[rgba(59,130,246,0.28)] bg-[rgba(59,130,246,0.1)] p-3 text-xs leading-5 text-[#93c5fd]">
                {text.deliveryOnlyHint}
              </div>
            ) : null}
          </section>

          {showProjectDateTools ? (
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
          ) : null}

          {showProjectDateTools ? (
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
                            {dateOnlyLabel(project.start_date)} → {dateOnlyLabel(project.end_date)}
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
          ) : null}
        </div>
      </section>

      {selectedDay ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-3 pb-28 pt-3 sm:items-center sm:p-4"
          style={{ background: "rgba(0,0,0,0.58)" }}
          onClick={() => setSelectedDay(null)}
        >
          <div
            data-live-refresh-blocker="true"
            className="surface-card max-h-[calc(100dvh-1.5rem)] w-full max-w-[900px] overflow-y-auto p-4 pb-24 sm:pb-4"
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

            <div className={`mt-4 grid gap-4 ${showProjectDateTools ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "lg:grid-cols-[minmax(0,1fr)_360px]"}`}>
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
                                {entry.deliveryStatus ? ` · ${deliveryStatusLabel(entry.deliveryStatus, text)}` : ""}
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
                {showProjectDateTools ? (
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
                ) : null}
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
          <div
            data-live-refresh-blocker="true"
            className="surface-card w-full max-w-[560px] p-4"
            onClick={(event) => event.stopPropagation()}
          >
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
                    {selectedEntry.type === "delivery" ? text.deliveryPersonLabel : text.assigneeLabel}:
                  </span>{" "}
                  {selectedEntry.assigneeName}
                </div>
              ) : selectedEntry.type === "delivery" ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">{text.deliveryPersonLabel}:</span>{" "}
                  {text.noDriver}
                </div>
              ) : null}
              {selectedEntry.deliveryStatus ? (
                <div>
                  <span className="font-semibold text-[var(--text-primary)]">{text.deliveryStatus}:</span>{" "}
                  {deliveryStatusLabel(selectedEntry.deliveryStatus, text)}
                </div>
              ) : null}
              {selectedEntry.description ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-[var(--text-primary)]">
                  {selectedEntry.description}
                </div>
              ) : null}
            </div>
            {selectedEntry.type === "delivery" && selectedEntry.deliveryStatus !== "delivered" ? (
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {currentProfile && (!selectedEntry.assigneeId || selectedEntry.assigneeId === currentProfile.id) ? (
                  <button
                    type="button"
                    onClick={() => void updateDeliveryStatus("claim_delivery", selectedEntry.id)}
                    disabled={busy === "delivery"}
                    className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                    style={{ borderColor: "var(--brand-yellow)", color: "var(--brand-yellow)" }}
                  >
                    <Hand size={14} />
                    {busy === "delivery" ? text.saving : text.takeDelivery}
                  </button>
                ) : null}
                {currentProfile &&
                (selectedEntry.assigneeId === currentProfile.id ||
                  ["owner", "admin", "manager", "supervisor"].includes(currentProfile.role)) ? (
                  <button
                    type="button"
                    onClick={() => void updateDeliveryStatus("complete_delivery", selectedEntry.id)}
                    disabled={busy === "delivery"}
                    className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                    style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                  >
                    <CheckCircle2 size={14} />
                    {busy === "delivery" ? text.saving : text.markDelivered}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
