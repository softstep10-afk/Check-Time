export type ProjectScheduleTone = "neutral" | "green" | "yellow" | "red";

export type ProjectScheduleState =
  | "unscheduled"
  | "not_started"
  | "on_track"
  | "half_elapsed"
  | "almost_due"
  | "overdue";

export interface ProjectScheduleInput {
  startDate: string | null | undefined;
  endDate: string | null | undefined;
}

export interface ProjectScheduleHealth {
  state: ProjectScheduleState;
  tone: ProjectScheduleTone;
  startAt: Date | null;
  endAt: Date | null;
  elapsedPercent: number | null;
  remainingPercent: number | null;
  remainingMs: number | null;
  overdueMs: number | null;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function parseDateOnly(value: string | null | undefined, endOfDay = false): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

export function deriveProjectScheduleHealth(
  input: ProjectScheduleInput,
  now = new Date(),
): ProjectScheduleHealth {
  const startAt = parseDateOnly(input.startDate, false);
  const endAt = parseDateOnly(input.endDate, true);

  if (!startAt && !endAt) {
    return {
      state: "unscheduled",
      tone: "neutral",
      startAt,
      endAt,
      elapsedPercent: null,
      remainingPercent: null,
      remainingMs: null,
      overdueMs: null,
    };
  }

  if (!endAt) {
    return {
      state: "unscheduled",
      tone: "neutral",
      startAt,
      endAt,
      elapsedPercent: null,
      remainingPercent: null,
      remainingMs: null,
      overdueMs: null,
    };
  }

  const remainingMs = endAt.getTime() - now.getTime();
  if (remainingMs < 0) {
    return {
      state: "overdue",
      tone: "red",
      startAt,
      endAt,
      elapsedPercent: startAt ? 100 : null,
      remainingPercent: 0,
      remainingMs: 0,
      overdueMs: Math.abs(remainingMs),
    };
  }

  if (!startAt) {
    return {
      state: "on_track",
      tone: "green",
      startAt,
      endAt,
      elapsedPercent: null,
      remainingPercent: null,
      remainingMs,
      overdueMs: null,
    };
  }

  if (now.getTime() < startAt.getTime()) {
    return {
      state: "not_started",
      tone: "green",
      startAt,
      endAt,
      elapsedPercent: 0,
      remainingPercent: 100,
      remainingMs,
      overdueMs: null,
    };
  }

  const totalMs = Math.max(DAY_MS, endAt.getTime() - startAt.getTime());
  const elapsedMs = Math.max(0, now.getTime() - startAt.getTime());
  const elapsedPercent = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  const remainingPercent = Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));

  if (remainingPercent <= 10 || elapsedPercent >= 90) {
    return {
      state: "almost_due",
      tone: "red",
      startAt,
      endAt,
      elapsedPercent,
      remainingPercent,
      remainingMs,
      overdueMs: null,
    };
  }

  if (elapsedPercent >= 50) {
    return {
      state: "half_elapsed",
      tone: "yellow",
      startAt,
      endAt,
      elapsedPercent,
      remainingPercent,
      remainingMs,
      overdueMs: null,
    };
  }

  return {
    state: "on_track",
    tone: "green",
    startAt,
    endAt,
    elapsedPercent,
    remainingPercent,
    remainingMs,
    overdueMs: null,
  };
}

export function countdownParts(ms: number | null): { days: number; hours: number } | null {
  if (ms === null) return null;
  const totalHours = Math.max(0, Math.ceil(ms / HOUR_MS));
  return {
    days: Math.floor(totalHours / 24),
    hours: totalHours % 24,
  };
}

export function formatProjectCountdown(
  health: Pick<ProjectScheduleHealth, "remainingMs" | "overdueMs">,
  locale: "en" | "ru" = "en",
): string {
  const source = health.overdueMs ?? health.remainingMs;
  const parts = countdownParts(source);
  if (!parts) return locale === "ru" ? "без дедлайна" : "no deadline";

  const body =
    locale === "ru"
      ? `${parts.days}д ${parts.hours}ч`
      : `${parts.days}d ${parts.hours}h`;

  if (health.overdueMs !== null && health.overdueMs !== undefined) {
    return locale === "ru" ? `просрочен ${body}` : `overdue ${body}`;
  }

  return body;
}

export function projectScheduleToneStyle(tone: ProjectScheduleTone): {
  background: string;
  color: string;
  borderColor: string;
} {
  if (tone === "green") {
    return {
      background: "rgba(15, 168, 120, 0.14)",
      color: "var(--green)",
      borderColor: "rgba(15, 168, 120, 0.28)",
    };
  }

  if (tone === "yellow") {
    return {
      background: "rgba(245, 158, 11, 0.14)",
      color: "#f59e0b",
      borderColor: "rgba(245, 158, 11, 0.3)",
    };
  }

  if (tone === "red") {
    return {
      background: "rgba(212, 81, 94, 0.14)",
      color: "var(--red)",
      borderColor: "rgba(212, 81, 94, 0.32)",
    };
  }

  return {
    background: "rgba(107, 114, 128, 0.12)",
    color: "var(--text-secondary)",
    borderColor: "var(--border-default)",
  };
}
