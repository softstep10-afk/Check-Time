import Link from "next/link";
import { ProjectsStatusMap } from "@/components/maps/ProjectsStatusMap";
import { FullscreenMapWrapper } from "@/components/maps/FullscreenMapWrapper";
import { ForceCheckoutButton } from "@/components/manager/ForceCheckoutButton";
import { EventFeed, type FeedEvent } from "@/components/manager/EventFeed";
import { OverviewLiveIndicator } from "@/components/manager/OverviewLiveIndicator";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  getOverviewStats,
} from "@/lib/manager-utils";
import { formatDurationCompact, formatEventTime } from "@/lib/worker-utils";
import { getServerLocale, serverT } from "@/lib/i18n/server";
import {
  GPS_STATUS_COLOR,
  deriveWorkerGpsStatus,
  type WorkerGpsStatus,
} from "@/lib/gps-status";

export const revalidate = 60;

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const priorityRank = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
} as const;

function hoursColor(minutes: number): string {
  const h = minutes / 60;
  if (h > 12) return "#ef4444";
  if (h > 9) return "#f59e0b";
  return "var(--green)";
}

export default async function OverviewPage() {
  const locale = await getServerLocale();
  const t = (key: Parameters<typeof serverT>[1]) => serverT(locale, key);
  const data = await getManagerWorkspaceData();
  const sessions = buildManagerSessions(data);
  const projectSummaries = buildProjectSummaries(data, sessions);
  const profileSummaries = buildProfileSummaries(data, sessions);
  const stats = getOverviewStats(data, sessions, projectSummaries, profileSummaries);
  const liveProfiles = profileSummaries.filter((profile) => profile.isOnSite).slice(0, 6);
  const urgentTasks = [...data.tasks]
    .filter((task) => task.status !== "done" && task.status !== "cancelled")
    .sort((left, right) => {
      const priorityGap = priorityRank[left.priority] - priorityRank[right.priority];
      if (priorityGap !== 0) {
        return priorityGap;
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    })
    .slice(0, 8);
  const busiestProjects = [...projectSummaries]
    .sort((left, right) => {
      if (right.onSiteWorkerCount !== left.onSiteWorkerCount) {
        return right.onSiteWorkerCount - left.onSiteWorkerCount;
      }

      return right.weekMinutes - left.weekMinutes;
    })
    .slice(0, 6);

  // ── Currently on site: open sessions with project + GPS info ──
  const projectsById = new Map(data.projects.map((p) => [p.id, p]));
  const clockInEventsById = new Map(
    data.timeEvents
      .filter((e) => e.event_type === "clock_in")
      .map((e) => [e.id, e]),
  );
  const onSiteSessions = sessions
    .filter((s) => s.isOpen)
    .map((session) => {
      const project = projectsById.get(session.projectId);
      const clockInEvent = clockInEventsById.get(session.clockInEventId);
      const todayMinutes = session.durationMinutes;
      const gpsStatus = deriveWorkerGpsStatus({
        clockInGpsPoint: clockInEvent?.gps_point,
        projectSitePoint: project?.site_point,
        projectRadiusM:
          (project as { gps_radius_m?: number | null } | undefined)?.gps_radius_m ??
          project?.radius_m,
      });
      return {
        ...session,
        projectAddress: project?.address ?? null,
        gpsStatus,
        todayMinutes,
      };
    });

  const gpsStatusLabel: Record<WorkerGpsStatus, string> = {
    on_site: t("gpsStatus.onSite"),
    no_gps: t("gpsStatus.noGps"),
    off_site: t("gpsStatus.offSite"),
    no_fence: t("gpsStatus.noFence"),
  };

  // ── Travel gap detection: gaps > 60 min between clock_out → clock_in for same worker today ──
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayClockEvents = data.timeEvents
    .filter((e) => {
      if (e.event_type !== "clock_in" && e.event_type !== "clock_out") return false;
      return new Date(e.event_time).getTime() >= todayStart.getTime();
    })
    .sort((a, b) => new Date(a.event_time).getTime() - new Date(b.event_time).getTime());

  const eventsByWorker = new Map<string, typeof todayClockEvents>();
  for (const e of todayClockEvents) {
    const list = eventsByWorker.get(e.profile_id) ?? [];
    list.push(e);
    eventsByWorker.set(e.profile_id, list);
  }

  type TravelGap = {
    id: string;
    profileId: string;
    workerName: string;
    fromProject: string;
    toProject: string;
    gapMinutes: number;
    outTime: string;
    inTime: string;
  };

  const travelGaps: TravelGap[] = [];
  for (const [profileId, events] of eventsByWorker) {
    const profile = data.profiles.find((p) => p.id === profileId);
    const workerName = profile?.name ?? "Unknown";
    for (let i = 0; i < events.length - 1; i++) {
      const out = events[i];
      const next = events[i + 1];
      if (out.event_type !== "clock_out" || next.event_type !== "clock_in") continue;
      const gapMs = new Date(next.event_time).getTime() - new Date(out.event_time).getTime();
      const gapMinutes = Math.round(gapMs / 60_000);
      if (gapMinutes > 60) {
        const fromProject = projectsById.get(out.project_id)?.name ?? "Unknown";
        const toProject = projectsById.get(next.project_id)?.name ?? "Unknown";
        travelGaps.push({
          id: `${out.id}-${next.id}`,
          profileId,
          workerName,
          fromProject,
          toProject,
          gapMinutes,
          outTime: out.event_time,
          inTime: next.event_time,
        });
      }
    }
  }
  travelGaps.sort((a, b) => b.gapMinutes - a.gapMinutes);

  const workersWithGaps = new Set(travelGaps.map((g) => g.profileId));

  // ── Unified event feed (last 15) ──
  const profilesById = new Map(data.profiles.map((p) => [p.id, p]));
  const feedEvents: FeedEvent[] = [];

  // Time events → clock_in, clock_out, force_checkout, adjust
  for (const e of data.timeEvents) {
    const profile = profilesById.get(e.profile_id);
    const project = projectsById.get(e.project_id);
    const isForce = e.event_type === "auto_out" && (e.metadata as Record<string, unknown>)?.force_checkout === true;
    const kind: FeedEvent["kind"] =
      isForce ? "force_checkout"
        : e.event_type === "clock_in" ? "clock_in"
        : e.event_type === "clock_out" || e.event_type === "auto_out" ? "clock_out"
        : e.event_type === "adjust" ? "adjust"
        : "clock_in"; // fallback for break_start/end
    if (e.event_type === "break_start" || e.event_type === "break_end") continue;
    feedEvents.push({
      id: e.id,
      kind,
      actorName: profile?.name ?? "Unknown",
      actorId: e.profile_id,
      description: "",
      projectName: project?.name ?? null,
      projectId: e.project_id,
      timestamp: e.event_time,
      href: project ? `/projects/${e.project_id}` : null,
    });
  }

  // Tasks → assigned, started, completed
  for (const task of data.tasks) {
    if (!task.deleted_at) {
      const project = task.project_id ? projectsById.get(task.project_id) : null;

      // Assignment event — emitted whenever a task has an assigner + assignee.
      // Without a full audit history we treat task.created_at as the assignment time.
      if (task.assigned_to && task.assigned_by) {
        const assigner = profilesById.get(task.assigned_by);
        const assignee = profilesById.get(task.assigned_to);
        feedEvents.push({
          id: `task-assign-${task.id}`,
          kind: "task_assigned",
          actorName: assigner?.name ?? "Unknown",
          actorId: task.assigned_by,
          description: assignee ? `${task.title} → ${assignee.name}` : task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.created_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      }

      if (task.status === "done" && task.completed_at) {
        const actor = task.completed_by ? profilesById.get(task.completed_by) : null;
        feedEvents.push({
          id: `task-done-${task.id}`,
          kind: "task_completed",
          actorName: actor?.name ?? "Unknown",
          actorId: task.completed_by ?? "",
          description: task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.completed_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      } else if (task.status === "in_progress") {
        feedEvents.push({
          id: `task-start-${task.id}`,
          kind: "task_started",
          actorName: task.assigned_to ? (profilesById.get(task.assigned_to)?.name ?? "Unknown") : "Unknown",
          actorId: task.assigned_to ?? "",
          description: task.title,
          projectName: project?.name ?? null,
          projectId: task.project_id,
          timestamp: task.updated_at,
          href: task.project_id ? `/projects/${task.project_id}` : null,
        });
      }
    }
  }

  // Media → uploaded
  for (const m of data.media) {
    const actor = m.uploaded_by ? profilesById.get(m.uploaded_by) : null;
    const project = m.project_id ? projectsById.get(m.project_id) : null;
    feedEvents.push({
      id: `media-${m.id}`,
      kind: "media_uploaded",
      actorName: actor?.name ?? "Unknown",
      actorId: m.uploaded_by ?? "",
      description: m.filename ?? m.media_type,
      projectName: project?.name ?? null,
      projectId: m.project_id,
      timestamp: m.created_at,
      href: m.project_id ? `/projects/${m.project_id}` : null,
    });
  }

  // Store visits → only kept (closed) ones with real duration.
  for (const v of data.storeVisits) {
    if (!v.exited_at || !v.duration_seconds) continue;
    const actor = profilesById.get(v.worker_id);
    const minutes = Math.max(1, Math.round(v.duration_seconds / 60));
    const chain = v.store_chain || "store";
    const store = v.store_name || chain;
    feedEvents.push({
      id: `store-visit-${v.id}`,
      kind: "store_visit",
      actorName: actor?.name ?? v.worker_name ?? "Unknown",
      actorId: v.worker_id,
      description: `${chain} (${store}) — ${minutes} min`,
      projectName: v.source_project_name ?? null,
      projectId: v.source_project_id,
      timestamp: v.exited_at,
      href: v.source_project_id ? `/projects/${v.source_project_id}` : null,
    });
  }

  feedEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const recentFeed = feedEvents.slice(0, 15);

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <div className="flex items-center gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("overview.title")}
          </p>
          <OverviewLiveIndicator />
        </div>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {data.org.name}
        </h1>
        <p className="max-w-[64ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("overview.description")}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.onSite")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.onSiteCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.crewCount} {t("overview.totalCrewProfiles")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.today")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.todayHours.toFixed(2)}h</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.activeProjectCount} {t("overview.activeProjects")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.unpaid")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
            {currency.format(stats.unpaidAmount)}
          </div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{stats.unpaidHours.toFixed(2)}{t("payroll.hPendingPayroll")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("overview.materials")}</div>
          <div
            className="mt-2 font-mono text-[28px] font-bold"
            style={{ color: "var(--brand-yellow)" }}
          >
            {currency.format(stats.receiptTotal)}
          </div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("overview.materialsCaption")}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("common.tasks")}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{stats.openTaskCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("overview.openFieldItems")}</div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.activeSiteMap")}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {t("overview.mapDesc")}
            </p>
          </div>
          <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openProjects")}
          </Link>
        </div>
        <FullscreenMapWrapper projects={projectSummaries} />
      </section>

      {/* ── Currently on site table ── */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.currentlyOnSite")}</h2>
          <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openTeam")}
          </Link>
        </div>
        {onSiteSessions.length === 0 ? (
          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
            {t("overview.nobodyClockedIn")}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]"
                  style={{ borderBottom: "1px solid var(--border-default)" }}
                >
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colName")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colProject")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colSince")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colHours")}</th>
                  <th className="pb-3 pr-4 font-semibold">{t("overview.colGps")}</th>
                  <th className="pb-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {onSiteSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-[var(--border-subtle)]"
                  >
                    <td className="py-3 pr-4">
                      <Link href={`/team/${session.profileId}`} className="font-semibold text-[var(--text-primary)]">
                        {session.profileName}
                      </Link>
                      {workersWithGaps.has(session.profileId) ? (
                        <span
                          className="ml-1.5 inline-block h-2 w-2 rounded-full"
                          style={{ background: "#f59e0b" }}
                          title={t("overview.travelGaps")}
                        />
                      ) : null}
                      <span
                        className="ml-2 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                        style={{
                          background: "rgba(191, 162, 52, 0.12)",
                          color: "var(--brand-yellow)",
                        }}
                      >
                        {session.profileRole}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Link href={`/projects/${session.projectId}`} className="text-[var(--text-primary)]">
                        {session.projectName}
                      </Link>
                      {session.projectAddress ? (
                        <div className="mt-0.5 text-xs text-[var(--text-muted)]">{session.projectAddress}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      {formatEventTime(session.clockInTime)}
                    </td>
                    <td className="py-3 pr-4 whitespace-nowrap font-semibold" style={{ color: hoursColor(session.todayMinutes) }}>
                      {formatDurationCompact(session.todayMinutes)}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold"
                        style={{ color: GPS_STATUS_COLOR[session.gpsStatus] }}
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: GPS_STATUS_COLOR[session.gpsStatus] }}
                        />
                        {gpsStatusLabel[session.gpsStatus]}
                      </span>
                    </td>
                    <td className="py-3">
                      <ForceCheckoutButton
                        orgId={data.org.id}
                        managerId={data.manager.id}
                        profileId={session.profileId}
                        projectId={session.projectId}
                        workerName={session.profileName}
                        projectName={session.projectName}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Travel gaps ── */}
      <section
        className="rounded-[var(--radius-lg)] border p-4"
        style={{
          background: "rgba(245, 158, 11, 0.06)",
          borderColor: "rgba(245, 158, 11, 0.25)",
        }}
      >
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <h2 className="text-lg font-bold" style={{ color: "#f59e0b" }}>{t("overview.travelGaps")}</h2>
        </div>
        <div className="mt-4 space-y-2">
          {travelGaps.length === 0 ? (
            <div className="text-sm text-[var(--text-secondary)]">
              {t("overview.noGaps")}
            </div>
          ) : (
            travelGaps.map((gap) => (
              <div
                key={gap.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5"
                style={{ background: "rgba(245, 158, 11, 0.08)" }}
              >
                <div className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Link href={`/team/${gap.profileId}`} className="font-semibold text-[var(--text-primary)]">
                    {gap.workerName}
                  </Link>
                  <span className="text-[var(--text-muted)]">&mdash;</span>
                  <span className="text-[var(--text-secondary)]">
                    {t("overview.gapFrom")} <span className="font-medium text-[var(--text-primary)]">{gap.fromProject}</span>
                  </span>
                  <span className="text-[var(--text-secondary)]">→</span>
                  <span className="text-[var(--text-secondary)]">
                    {t("overview.gapTo")} <span className="font-medium text-[var(--text-primary)]">{gap.toProject}</span>
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]">
                    {formatEventTime(gap.outTime)} - {formatEventTime(gap.inTime)}
                  </span>
                  <span
                    className="whitespace-nowrap rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold"
                    style={{ background: "rgba(245, 158, 11, 0.18)", color: "#f59e0b" }}
                  >
                    {formatDurationCompact(gap.gapMinutes)} {t("overview.gapDuration")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Unified event feed (last 15) ── */}
      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("feed.title")}</h2>
          <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.fullTimeline")}
          </Link>
        </div>
        <div className="mt-4">
          <EventFeed events={recentFeed} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.liveCrew")}</h2>
            <Link href="/team" className="text-sm font-semibold text-[var(--brand-yellow)]">
              {t("overview.openTeam")}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {liveProfiles.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("overview.nobodyClockedIn")}
              </div>
            ) : (
              liveProfiles.map((profile) => (
                <Link
                  key={profile.id}
                  href={`/team/${profile.id}`}
                  className="block rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{profile.name}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        {profile.role}
                      </div>
                    </div>
                    <div className="text-sm font-semibold text-[var(--brand-yellow)]">
                      {profile.currentSessionMinutes === null
                        ? t("common.live")
                        : formatDurationCompact(profile.currentSessionMinutes)}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[var(--text-secondary)]">
                    {profile.currentProjectName ?? t("common.projectNotResolved")}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.urgentQueue")}</h2>
            <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
              {t("overview.openTimeline")}
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {urgentTasks.length === 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-primary)] p-3 text-sm text-[var(--text-secondary)]">
                {t("overview.noOpenTasks")}
              </div>
            ) : (
              urgentTasks.map((task) => (
                <div
                  key={task.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</div>
                      <div className="mt-1 text-xs text-[var(--text-secondary)]">
                        {task.project_id ? (
                          <Link href={`/projects/${task.project_id}`} className="text-[var(--brand-yellow)]">
                            {t("common.openProject")}
                          </Link>
                        ) : (
                          t("common.generalTask")
                        )}
                        {" • "}
                        {task.status}
                      </div>
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--brand-yellow)]">
                      {task.priority}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("overview.projectLoad")}</h2>
          <Link href="/projects" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("overview.openProjects")}
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {busiestProjects.map((project) => (
            <Link
              key={project.id}
              href={`/projects/${project.id}`}
              className="block rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{project.name}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {project.address ?? t("common.noAddress")}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--text-secondary)]">
                  <div>{project.onSiteWorkerCount} {t("common.live").toLowerCase()}</div>
                  <div>{project.assignedWorkerCount} {t("overview.assigned")}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--text-secondary)]">
                <span className="font-mono">{formatDurationCompact(project.weekMinutes)} {t("common.thisWeek").toLowerCase()}</span>
                <span className="font-mono">{project.openTaskCount} {t("overview.openTasks")}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
