"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, FolderKanban, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { WorkerGpsCheckMap } from "@/components/maps/WorkerGpsCheckMap";
import { WorkerSessionMeta, useWorkerShell } from "@/components/worker/WorkerShell";
import { CheckoutModal } from "@/components/worker/CheckoutModal";
import {
  formatDateTime,
  formatDurationCompact,
  formatElapsedSeconds,
} from "@/lib/worker-utils";
import { useTranslation } from "@/lib/i18n";
import { isDriverTimeProject } from "@/lib/driver-time-projects";

export function ClockPage() {
  const router = useRouter();
  const {
    shell,
    activeSeconds,
    busyAction,
    lastGpsCheck,
  } = useWorkerShell();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const activeProject = useMemo(
    () =>
      shell.projects.find((project) => project.id === shell.clockState.currentProjectId) ?? null,
    [shell.clockState.currentProjectId, shell.projects],
  );
  const activeProjectGpsNotRequired = isDriverTimeProject(activeProject);
  const lastClosedSession =
    shell.sessions.find((session) => session.clockOutTime !== null) ?? null;

  // Detect the clocked-in → clocked-out transition to show the "Смена
  // завершена" success screen for 3 seconds. `wasClockedInRef` tracks
  // the previous render's value so we don't fire on the initial mount
  // when isClockedIn is already false.
  const wasClockedInRef = useRef<boolean>(shell.clockState.isClockedIn);
  const [justCheckedOut, setJustCheckedOut] = useState(false);
  useEffect(() => {
    if (wasClockedInRef.current && !shell.clockState.isClockedIn) {
      // This effect intentionally reacts to a clock-state transition from WorkerShell.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJustCheckedOut(true);
      const id = setTimeout(() => setJustCheckedOut(false), 3000);
      wasClockedInRef.current = shell.clockState.isClockedIn;
      return () => clearTimeout(id);
    }
    wasClockedInRef.current = shell.clockState.isClockedIn;
  }, [shell.clockState.isClockedIn]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaySummary = useMemo(() => {
    const closedToday = shell.sessions.filter(
      (s) => s.clockOutTime && s.clockInTime.slice(0, 10) === todayIso,
    );
    const totalMinutes = closedToday.reduce((acc, s) => acc + s.durationMinutes, 0);
    const projectNames = Array.from(
      new Set(closedToday.map((s) => s.projectName).filter(Boolean)),
    );
    return { totalMinutes, projectNames, count: closedToday.length };
  }, [shell.sessions, todayIso]);
  const showGpsCheck = lastGpsCheck?.action === "clock_in";
  const gpsTone =
    showGpsCheck && lastGpsCheck.withinFence === false ? "danger" : "success";
  const { t } = useTranslation();

  if (justCheckedOut && lastClosedSession) {
    const startIso = lastClosedSession.clockInTime;
    const endIso = lastClosedSession.clockOutTime;
    return (
      <div className="space-y-4">
        <section
          className="surface-card p-6 text-center"
          style={{
            borderColor: "rgba(15, 168, 120, 0.35)",
            boxShadow: "0 0 0 1px rgba(15, 168, 120, 0.18), 0 0 28px rgba(15, 168, 120, 0.2)",
          }}
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "rgba(15, 168, 120, 0.18)" }}>
            <CheckCircle2 size={30} className="text-[var(--green)]" />
          </div>
          <h2 className="mt-3 text-2xl font-bold text-[var(--text-primary)]">
            {t("clock.shiftCompleteTitle")}
          </h2>
          <div className="mt-4 font-mono text-[36px] font-bold leading-none" style={{ color: "var(--green)" }}>
            {formatDurationCompact(lastClosedSession.durationMinutes)}
          </div>
          <p className="mt-2 text-sm font-semibold text-[var(--text-primary)]">
            {lastClosedSession.projectName}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {formatDateTime(startIso)} → {endIso ? formatDateTime(endIso) : "—"}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section
        className="surface-card p-4"
        style={{
          boxShadow:
            shell.clockState.isClockedIn
              ? "inset 0 1px 3px rgba(0,0,0,0.3), 0 14px 28px rgba(0,0,0,0.2)"
              : "inset 0 1px 3px rgba(0,0,0,0.3), 0 10px 20px rgba(0,0,0,0.18)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: shell.clockState.isClockedIn
              ? "linear-gradient(90deg, transparent, rgba(46, 166, 122, 0.42), transparent)"
              : "linear-gradient(90deg, transparent, rgba(212, 81, 94, 0.34), transparent)",
          }}
        />

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {t("clock.shiftStatus")}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {shell.clockState.isClockedIn ? t("clock.onTheClock") : t("clock.offTheClock")}
            </h2>
          </div>
          <div
            className="status-pill"
            data-tone={shell.clockState.isClockedIn ? "success" : "danger"}
          >
            {shell.clockState.isClockedIn ? t("common.live") : t("clock.ready")}
          </div>
        </div>

        <div
          className="surface-panel relative mt-5 overflow-hidden rounded-[var(--radius-lg)] p-4 text-center"
          style={{
            boxShadow:
              shell.clockState.isClockedIn
                ? "inset 0 1px 3px rgba(0,0,0,0.38), 0 10px 18px rgba(0,0,0,0.16)"
                : "inset 0 1px 3px rgba(0,0,0,0.26)",
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px"
            style={{
              background: shell.clockState.isClockedIn
                ? "linear-gradient(90deg, transparent, rgba(46, 166, 122, 0.5), transparent)"
                : "linear-gradient(90deg, transparent, rgba(212, 81, 94, 0.38), transparent)",
            }}
          />
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("clock.elapsed")}
          </div>
          {shell.clockState.isClockedIn && todaySummary.count > 0 ? (
            <p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">
              {t("clock.todayInline")}: {(todaySummary.totalMinutes / 60).toFixed(1)}h
            </p>
          ) : null}
          <div
            className={`mt-2 font-[var(--font-mono)] text-[48px] font-semibold leading-none text-[var(--brand-yellow)] ${
              shell.clockState.isClockedIn ? "clock-pulse" : ""
            }`}
          >
            {formatElapsedSeconds(activeSeconds)}
          </div>
          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {shell.clockState.isClockedIn && activeProject
              ? activeProject.name
              : t("clock.selectProject")}
          </p>
          {shell.clockState.isClockedIn ? (() => {
            // Derive live GPS status from the last clock-in check. If GPS
            // returned a point at all (lastGpsCheck.accuracy present), we
            // treat the shift as GPS-tracked. Outside-fence is still
            // "active" — the fence check is a check-in gate, not a live
            // disconnect. A totally missing lastGpsCheck means either the
            // worker has no GPS hardware or permission was denied.
            const hasGps = Boolean(lastGpsCheck && lastGpsCheck.accuracy !== null);
            const gpsColor = hasGps || activeProjectGpsNotRequired ? "var(--green)" : "var(--red)";
            const gpsLabel = activeProjectGpsNotRequired
              ? t("projects.driverTimeGpsNotRequired")
              : hasGps
                ? t("clock.gpsActive")
                : t("clock.gpsOff");
            return (
              <div className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: gpsColor }}>
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: gpsColor, boxShadow: hasGps ? `0 0 6px ${gpsColor}` : undefined }}
                />
                {gpsLabel}
              </div>
            );
          })() : null}
        </div>

        {shell.clockState.isClockedIn && activeProject ? (
          <div
            id="active-project"
            className="surface-panel mt-4 p-3"
            style={{
              borderColor: "var(--green)",
              boxShadow: "0 0 0 1px rgba(15, 168, 120, 0.18), 0 0 14px rgba(15, 168, 120, 0.16)",
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {activeProject.name}
                  </span>
                  <span
                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                    style={{ background: "rgba(15, 168, 120, 0.16)", color: "var(--green)" }}
                  >
                    {t("clock.activeProjectBadge")}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {activeProject.address ?? t("clock.currentSite")}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--text-muted)]">
                {activeProjectGpsNotRequired
                  ? t("projects.driverTimeGpsNotRequired")
                  : activeProject.site
                    ? `${activeProject.radius_m}${t("clock.radiusM")}`
                    : t("clock.gpsOnly")}
              </div>
            </div>
          </div>
        ) : shell.projects.length === 0 ? (
          // Worker has no allowed projects at all — keep the manager-action
          // hint visible. Going to /my-projects would just show the same
          // empty state.
          <div
            className="surface-panel mt-4 p-4"
            style={{
              borderColor: "rgba(245, 158, 11, 0.3)",
              background: "rgba(245, 158, 11, 0.06)",
            }}
          >
            <div className="text-sm font-semibold" style={{ color: "#f59e0b" }}>
              {t("clock.noProjectsTitle")}
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {t("clock.noProjectsHint")}
            </p>
          </div>
        ) : (
          // Worker is off-shift but has allowed projects. Project browsing
          // and Check In live on the Projects tab now — surface a single
          // compact CTA that lands on /my-projects.
          <Link
            href="/my-projects"
            className="surface-panel mt-4 flex items-center justify-between gap-3 p-3"
            style={{
              borderColor: "rgba(245, 158, 11, 0.35)",
              background: "rgba(245, 158, 11, 0.08)",
            }}
          >
            <div className="flex items-start gap-2">
              <FolderKanban size={18} className="mt-0.5 shrink-0" style={{ color: "#f59e0b" }} />
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {t("clock.chooseProjectTitle")}
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  {t("clock.chooseProjectHint")}
                </p>
              </div>
            </div>
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-semibold"
              style={{ borderColor: "rgba(245, 158, 11, 0.5)", color: "#f59e0b" }}
            >
              {t("clock.goToProjects")}
              <ArrowRight size={11} />
            </span>
          </Link>
        )}

        {shell.clockState.isClockedIn ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setCheckoutOpen(true)}
              disabled={busyAction === "clock-out"}
              className="w-full rounded-[var(--radius-md)] text-base font-bold uppercase tracking-[0.08em] disabled:opacity-60"
              style={{
                height: 64,
                background: "#ef4444",
                color: "white",
                letterSpacing: "0.08em",
              }}
            >
              {busyAction === "clock-out" ? t("clock.closingShift") : t("clock.endShiftCta")}
            </button>
          </div>
        ) : null}
        <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />

        {shell.profile.require_video ? (
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            {t("clock.videoRequired")}
          </p>
        ) : null}
      </section>

      {/* Driver receipt shortcut */}
      {shell.profile.role === "driver" && shell.clockState.isClockedIn && shell.clockState.currentProjectId ? (
        <section className="surface-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t("receipts.title")}
              </p>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {shell.clockState.currentProjectName}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/journal`)}
              className="button-base button-primary shrink-0 px-3 py-2"
            >
              {t("receipts.addReceipt")}
            </button>
          </div>
        </section>
      ) : null}

      {showGpsCheck && lastGpsCheck ? (
        <section className="surface-card surface-card--muted p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t("clock.gpsCheck")}
              </p>
              <h3 className="mt-1 flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
                {gpsTone === "success" ? (
                  <CheckCircle2 size={18} className="text-[var(--green)]" />
                ) : (
                  <Navigation size={18} className="text-[var(--red)]" />
                )}
                {lastGpsCheck.site
                  ? lastGpsCheck.withinFence === false
                    ? `${t("clock.outsideProject")} ${lastGpsCheck.projectName}`
                    : `${t("clock.withinProject")} ${lastGpsCheck.projectName}`
                  : `${t("clock.gpsCaptured")} ${lastGpsCheck.projectName}`}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {lastGpsCheck.site && lastGpsCheck.distanceMeters !== null
                  ? `${lastGpsCheck.distanceMeters}${t("clock.fromSiteCenter")} ${Math.round(lastGpsCheck.accuracy)}m.`
                  : `${t("clock.gpsRecorded")} ${formatDateTime(lastGpsCheck.capturedAt)}.`}
              </p>
            </div>
            <div className="status-pill" data-tone={gpsTone}>
              {lastGpsCheck.withinFence === false ? t("clock.moveCloser") : t("clock.verified")}
            </div>
          </div>

          {lastGpsCheck.site ? (
            <div className="mt-4 h-[160px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)]">
              <WorkerGpsCheckMap gpsCheck={lastGpsCheck} />
            </div>
          ) : (
            <div className="surface-panel mt-4 flex items-center gap-2 px-3 py-3 text-sm text-[var(--text-secondary)]">
              <MapPin size={16} className="text-[var(--brand-yellow)]" />
              {t("clock.gpsNoFence")}
            </div>
          )}
        </section>
      ) : null}

      {shell.clockState.pendingCheckoutEventId && shell.profile.require_video ? (
        <section className="surface-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t("clock.nextStep")}
              </p>
              <h3 className="mt-1 text-lg font-bold text-[var(--text-primary)]">
                {t("clock.uploadCheckoutVideo")}
              </h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {t("clock.hoursClosedFinish")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/journal")}
              className="button-base button-primary shrink-0 px-3 py-2"
            >
              {t("clock.openJournal")}
            </button>
          </div>
        </section>
      ) : null}

      {!shell.clockState.isClockedIn && todaySummary.count > 0 ? (
        <section
          className="surface-card p-4"
          style={{
            borderColor: "rgba(15, 168, 120, 0.35)",
            boxShadow: "0 0 0 1px rgba(15, 168, 120, 0.14), 0 0 14px rgba(15, 168, 120, 0.12)",
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {t("clock.todaySummary")}
          </p>
          <div className="mt-2 font-mono text-[32px] font-bold leading-none" style={{ color: "var(--green)" }}>
            {formatDurationCompact(todaySummary.totalMinutes)}
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            {todaySummary.projectNames.length > 0
              ? todaySummary.projectNames.join(", ")
              : t("clock.todaySummaryNoProject")}
          </p>
          <p className="mt-2 text-sm font-semibold" style={{ color: "var(--green)" }}>
            {t("clock.goodWork")}
          </p>
        </section>
      ) : null}

      {lastClosedSession ? (
        <section className="surface-card surface-card--muted p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
                {t("clock.lastShift")}
              </p>
              <div className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                {lastClosedSession.projectName}
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-[var(--brand-yellow)]">
                {formatDurationCompact(lastClosedSession.durationMinutes)}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <ShieldCheck size={14} className="text-[var(--brand-yellow)]" />
              {t("clock.closed")}
            </div>
          </div>
          <div className="mt-3">
            <WorkerSessionMeta
              start={lastClosedSession.clockInTime}
              end={lastClosedSession.clockOutTime}
              duration={lastClosedSession.durationMinutes}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
