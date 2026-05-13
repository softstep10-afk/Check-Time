import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, FolderKanban, ListChecks, RadioTower } from "lucide-react";
import {
  buildCommandCenterBase,
  buildCommandCenterModel,
  type CommandCenterOnSiteSession,
} from "@/lib/command-center-model";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { createClient } from "@/lib/supabase/server";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import {
  deriveGpsFreshness,
  formatGpsAge,
  type GpsFreshness,
} from "@/lib/gps-freshness";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { SHIFT_REVIEW_COLOR, type ShiftReviewStatus } from "@/lib/shift-review";
import { formatDurationCompact, formatEventTime } from "@/lib/worker-utils";

export const revalidate = 0;

const COPY = {
  en: {
    eyebrow: "Manager Command Center",
    title: "What needs attention now",
    description: "A focused manager queue built from live shifts, GPS freshness, travel gaps, closed-shift review, and priority tasks.",
    backOverview: "Back to overview",
    openTimeline: "Open timeline",
    openPayroll: "Open payroll",
    openTasks: "Open tasks",
    openProjects: "Open projects",
    actions: "Actions",
    critical: "Critical",
    liveCrew: "Live crew",
    priorityTasks: "Priority tasks",
    travelGaps: "Travel gaps",
    closedReview: "Closed shifts to review",
    actionQueue: "Action queue",
    actionQueueEmpty: "No manager actions need attention right now.",
    liveShiftReview: "Live shift review",
    noLiveShifts: "Nobody is clocked in right now.",
    projectPressure: "Project pressure",
    noProjectPressure: "No active project pressure right now.",
    payrollReadiness: "Payroll readiness",
    payrollReady: "No closed-shift payroll blockers found in the current active history.",
    since: "Since",
    duration: "Duration",
    gps: "GPS",
    review: "Review",
    next: "Open",
    onSite: "on site",
    activeProjects: "active projects",
    noAddress: "No address",
    noSignal: "no live signal",
    openShift: "Open shift",
    closedShift: "Closed shift",
    tasks: "tasks",
    crew: "crew",
    warnings: "warning",
    low: "low",
  },
  ru: {
    eyebrow: "Менеджерский командный центр",
    title: "Что требует внимания сейчас",
    description: "Сфокусированная очередь менеджера из живых смен, свежести GPS, перерывов между объектами, проверки закрытых смен и приоритетных задач.",
    backOverview: "Назад в обзор",
    openTimeline: "Открыть хронологию",
    openPayroll: "Открыть зарплату",
    openTasks: "Открыть задачи",
    openProjects: "Открыть проекты",
    actions: "Действия",
    critical: "Критично",
    liveCrew: "На смене",
    priorityTasks: "Приоритетные задачи",
    travelGaps: "Перерывы между объектами",
    closedReview: "Закрытые смены на проверку",
    actionQueue: "Очередь действий",
    actionQueueEmpty: "Сейчас нет действий, требующих внимания менеджера.",
    liveShiftReview: "Живые смены",
    noLiveShifts: "Сейчас никто не на смене.",
    projectPressure: "Нагрузка по объектам",
    noProjectPressure: "Сейчас нет заметной нагрузки по активным объектам.",
    payrollReadiness: "Готовность к зарплате",
    payrollReady: "В текущей активной истории нет блокеров по закрытым сменам для payroll.",
    since: "С",
    duration: "Длительность",
    gps: "GPS",
    review: "Проверка",
    next: "Открыть",
    onSite: "на объекте",
    activeProjects: "активных объектов",
    noAddress: "Адрес не указан",
    noSignal: "нет live-сигнала",
    openShift: "Открытая смена",
    closedShift: "Закрытая смена",
    tasks: "задач",
    crew: "бригада",
    warnings: "предупреждений",
    low: "низкий риск",
  },
} as const;

async function loadGpsFreshness(
  supabase: Awaited<ReturnType<typeof createClient>>,
  onSiteSessions: CommandCenterOnSiteSession[],
): Promise<Map<string, GpsFreshness>> {
  const freshnessByProfileId = new Map<string, GpsFreshness>();
  if (onSiteSessions.length === 0) return freshnessByProfileId;

  try {
    const profileIds = onSiteSessions.map((session) => session.profileId);
    const { data: liveRows, error } = await supabase
      .from("worker_live_locations")
      .select("worker_id, recorded_at")
      .in("worker_id", profileIds)
      .order("recorded_at", { ascending: false })
      .limit(profileIds.length * 5);
    if (error || !liveRows) return freshnessByProfileId;

    const seen = new Set<string>();
    const lastByWorker = new Map<string, string>();
    for (const row of liveRows as Array<{ worker_id: string; recorded_at: string }>) {
      if (seen.has(row.worker_id)) continue;
      seen.add(row.worker_id);
      lastByWorker.set(row.worker_id, row.recorded_at);
    }
    for (const session of onSiteSessions) {
      freshnessByProfileId.set(
        session.profileId,
        deriveGpsFreshness({
          lastUpdateAt: lastByWorker.get(session.profileId) ?? null,
          shiftStartAt: session.clockInTime,
        }),
      );
    }
  } catch {
    return freshnessByProfileId;
  }

  return freshnessByProfileId;
}

function statCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: "neutral" | "good" | "warning" | "critical";
}) {
  const color =
    tone === "critical" ? "var(--red)" :
    tone === "warning" ? "#f59e0b" :
    tone === "good" ? "var(--green)" :
    "var(--text-primary)";
  const border =
    tone === "critical" ? "rgba(212, 81, 94, 0.42)" :
    tone === "warning" ? "rgba(245, 158, 11, 0.34)" :
    "var(--border-default)";

  return (
    <div className="rounded-[var(--radius-md)] border p-4" style={{ borderColor: border, background: "var(--bg-card)" }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 font-mono text-3xl font-bold" style={{ color }}>{value}</div>
      <div className="mt-2 text-xs leading-5 text-[var(--text-secondary)]">{detail}</div>
    </div>
  );
}

export default async function CommandCenterPage() {
  const locale = await getServerLocale();
  const text = COPY[locale];
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getManagerWorkspaceData();
  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const base = buildCommandCenterBase(data, { includeFinancials: managerHasFinanceAccess });
  const freshnessByProfileId = await loadGpsFreshness(supabase, base.onSiteSessions);
  const shiftReviewLabel: Record<ShiftReviewStatus, string> = {
    normal: t("shiftReview.normal"),
    long_shift: t("shiftReview.longShift"),
    gps_stale: t("shiftReview.gpsStale"),
    gps_lost: t("shiftReview.gpsLost"),
    no_gps: t("shiftReview.noGps"),
    needs_review: t("shiftReview.needsReview"),
    video_missing: t("shiftReview.videoMissing"),
  };
  const model = buildCommandCenterModel({
    base,
    gpsFreshnessByProfileId: freshnessByProfileId,
    queueLimit: 24,
    labels: {
      actionShift: t("overview.actionShift"),
      actionTravelGap: t("overview.actionTravelGap"),
      actionTask: t("overview.actionTask"),
      generalTask: t("common.generalTask"),
      shiftReviewLabel,
    },
  });
  const pressureProjects = model.projectSummaries
    .filter((project) => (
      project.onSiteWorkerCount > 0 ||
      project.openTaskCount > 0 ||
      project.extremeShiftCount > 0 ||
      project.longShiftCount > 0
    ))
    .sort((left, right) => {
      if (right.extremeShiftCount !== left.extremeShiftCount) return right.extremeShiftCount - left.extremeShiftCount;
      if (right.openTaskCount !== left.openTaskCount) return right.openTaskCount - left.openTaskCount;
      return right.onSiteWorkerCount - left.onSiteWorkerCount;
    })
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-5">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {text.eyebrow}
          </p>
          <h1 className="mt-2 text-[30px] font-bold text-[var(--text-primary)]">{text.title}</h1>
          <p className="mt-1 max-w-[80ch] text-sm leading-6 text-[var(--text-secondary)]">
            {text.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/overview" className="button-base button-secondary px-3 py-2 text-xs">
            {text.backOverview}
          </Link>
          <Link href="/timeline" className="button-base button-secondary px-3 py-2 text-xs">
            {text.openTimeline}
          </Link>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {statCard({
          label: text.actions,
          value: model.commandQueue.totalCount,
          detail: `${model.commandQueue.warningCount} ${text.warnings} · ${model.commandQueue.lowCount} ${text.low}`,
          tone: model.commandQueue.totalCount > 0 ? "warning" : "good",
        })}
        {statCard({
          label: text.critical,
          value: model.criticalActionCount,
          detail: model.criticalActionCount > 0 ? text.actionQueue : text.actionQueueEmpty,
          tone: model.criticalActionCount > 0 ? "critical" : "good",
        })}
        {statCard({
          label: text.liveCrew,
          value: model.stats.onSiteCount,
          detail: `${model.projectsWithCrewCount} ${text.activeProjects} · ${model.stats.todayHours.toFixed(1)}h`,
          tone: model.stats.onSiteCount > 0 ? "neutral" : "good",
        })}
        {statCard({
          label: text.priorityTasks,
          value: model.highPriorityTaskCount,
          detail: `${model.urgentTasks.length} ${text.tasks}`,
          tone: model.highPriorityTaskCount > 0 ? "warning" : "good",
        })}
        {statCard({
          label: text.travelGaps,
          value: model.travelGaps.length,
          detail: model.travelGaps.length > 0 ? t("overview.actionTravelGap") : text.actionQueueEmpty,
          tone: model.travelGaps.some((gap) => gap.severity === "critical") ? "critical" : model.travelGaps.length > 0 ? "warning" : "good",
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
        <div className="surface-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ListChecks size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.actionQueue}</h2>
            </div>
            {model.primaryAction ? (
              <Link
                href={model.primaryAction.href}
                className="rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold"
                style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
              >
                {text.next}
              </Link>
            ) : null}
          </div>
          <div className="mt-4 space-y-2">
            {model.commandQueue.allItems.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-secondary)]">
                {text.actionQueueEmpty}
              </div>
            ) : (
              model.commandQueue.allItems.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid gap-3 rounded-[var(--radius-md)] border px-3 py-3 transition hover:border-[var(--brand-yellow)] md:grid-cols-[140px_minmax(0,1fr)_auto]"
                  style={{ borderColor: "var(--border-default)", background: "rgba(15, 17, 23, 0.44)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }} />
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: item.color }}>
                      {item.label}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.title}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{item.detail}</div>
                  </div>
                  <div className="self-center text-xs font-semibold text-[var(--brand-yellow)]">{text.next}</div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="space-y-5">
          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <RadioTower size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.liveShiftReview}</h2>
            </div>
            <div className="mt-4 space-y-2">
              {model.onSiteSessions.length === 0 ? (
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                  {text.noLiveShifts}
                </div>
              ) : (
                model.onSiteSessions.map((session) => {
                  const review = model.shiftReviewByProfileId.get(session.profileId);
                  const freshness = freshnessByProfileId.get(session.profileId);
                  const reviewColor = review ? SHIFT_REVIEW_COLOR[review.status] : "var(--text-muted)";
                  return (
                    <Link
                      key={session.id}
                      href={`/team/${session.profileId}`}
                      className="block rounded-[var(--radius-md)] border p-3"
                      style={{ borderColor: "var(--border-default)", background: "rgba(15, 17, 23, 0.44)" }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{session.profileName}</div>
                          <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                            {session.projectName} · {session.projectAddress ?? text.noAddress}
                          </div>
                        </div>
                        <div className="font-mono text-sm font-bold text-[var(--text-primary)]">
                          {formatDurationCompact(session.todayMinutes)}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                        <div className="rounded-[var(--radius-sm)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <span className="text-[var(--text-muted)]">{text.since}: </span>
                          <span className="text-[var(--text-secondary)]">{formatEventTime(session.clockInTime)}</span>
                        </div>
                        <div className="rounded-[var(--radius-sm)] bg-[var(--bg-primary)] px-2 py-1.5">
                          <span className="text-[var(--text-muted)]">{text.gps}: </span>
                          <span className="text-[var(--text-secondary)]">{freshness ? formatGpsAge(freshness.ageMs) : text.noSignal}</span>
                        </div>
                      </div>
                      <div className="mt-2 text-xs font-semibold" style={{ color: reviewColor }}>
                        {review ? shiftReviewLabel[review.status] : text.review}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          <section
            className="rounded-[var(--radius-lg)] border p-4"
            style={{
              borderColor: model.closedShiftAlerts.length > 0 ? "rgba(212, 81, 94, 0.32)" : "var(--border-default)",
              background: model.closedShiftAlerts.length > 0 ? "rgba(212, 81, 94, 0.06)" : "var(--bg-card)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {model.closedShiftAlerts.length > 0 ? (
                  <AlertTriangle size={18} style={{ color: "var(--red)" }} />
                ) : (
                  <CheckCircle2 size={18} style={{ color: "var(--green)" }} />
                )}
                <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.payrollReadiness}</h2>
              </div>
              <Link href="/payroll" className="text-xs font-semibold text-[var(--brand-yellow)]">
                {text.openPayroll}
              </Link>
            </div>
            <div className="mt-4 space-y-2">
              {model.closedShiftAlerts.length === 0 ? (
                <div className="text-sm leading-6 text-[var(--text-secondary)]">{text.payrollReady}</div>
              ) : (
                model.closedShiftAlerts.slice(0, 5).map((session) => (
                  <Link key={session.id} href={`/team/${session.profileId}`} className="block rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{session.profileName}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{session.projectName}</div>
                      </div>
                      <div className="font-mono text-xs font-bold text-[var(--text-primary)]">
                        {formatDurationCompact(session.durationMinutes)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs font-semibold" style={{ color: SHIFT_REVIEW_COLOR[session.review.status] }}>
                      {shiftReviewLabel[session.review.status]}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FolderKanban size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.projectPressure}</h2>
            </div>
            <Link href="/projects" className="text-xs font-semibold text-[var(--brand-yellow)]">{text.openProjects}</Link>
          </div>
          <div className="mt-4 space-y-2">
            {pressureProjects.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {text.noProjectPressure}
              </div>
            ) : (
              pressureProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="grid gap-3 rounded-[var(--radius-md)] border p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  style={{ borderColor: "var(--border-default)", background: "rgba(15, 17, 23, 0.44)" }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{project.name}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{project.address ?? text.noAddress}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
                    <span>{project.onSiteWorkerCount} {text.crew}</span>
                    <span>{project.openTaskCount} {text.tasks}</span>
                    <span className="font-mono">{formatDurationCompact(project.weekMinutes)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock3 size={18} className="text-[var(--brand-yellow)]" />
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.priorityTasks}</h2>
            </div>
            <Link href="/tasks" className="text-xs font-semibold text-[var(--brand-yellow)]">{text.openTasks}</Link>
          </div>
          <div className="mt-4 space-y-2">
            {model.urgentTasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {text.actionQueueEmpty}
              </div>
            ) : (
              model.urgentTasks.slice(0, 8).map((task) => {
                const project = task.project_id ? model.projectsById.get(task.project_id) : null;
                const effectiveStatus = getEffectiveTaskStatus(task);
                return (
                  <Link
                    key={task.id}
                    href={task.project_id ? `/projects/${task.project_id}#tasks` : "/tasks"}
                    className="block rounded-[var(--radius-md)] border p-3"
                    style={{ borderColor: "var(--border-default)", background: "rgba(15, 17, 23, 0.44)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                        <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                          {project?.name ?? t("common.generalTask")} · {effectiveStatus}
                        </div>
                      </div>
                      <span
                        className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                        style={{
                          background: task.priority === "urgent" ? "rgba(212, 81, 94, 0.15)" : "rgba(245, 158, 11, 0.16)",
                          color: task.priority === "urgent" ? "var(--red)" : "#f59e0b",
                        }}
                      >
                        {task.priority}
                      </span>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
