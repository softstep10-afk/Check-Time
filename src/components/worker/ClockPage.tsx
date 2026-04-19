"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MapPin, Navigation, ShieldCheck } from "lucide-react";
import { WorkerGpsCheckMap } from "@/components/maps/WorkerGpsCheckMap";
import { WorkerSessionMeta, useWorkerShell } from "@/components/worker/WorkerShell";
import {
  formatDateTime,
  formatDurationCompact,
  formatElapsedSeconds,
} from "@/lib/worker-utils";
import { useTranslation } from "@/lib/i18n";

export function ClockPage() {
  const router = useRouter();
  const {
    shell,
    activeSeconds,
    busyAction,
    clockIn,
    clockOut,
    lastGpsCheck,
  } = useWorkerShell();
  const [manualProjectId, setManualProjectId] = useState<string>(
    shell.projects[0]?.id ?? "",
  );
  const selectedProjectId =
    shell.clockState.currentProjectId ?? manualProjectId ?? shell.projects[0]?.id ?? "";

  const activeProject = useMemo(
    () =>
      shell.projects.find((project) => project.id === shell.clockState.currentProjectId) ?? null,
    [shell.clockState.currentProjectId, shell.projects],
  );
  const lastClosedSession =
    shell.sessions.find((session) => session.clockOutTime !== null) ?? null;
  const showGpsCheck = lastGpsCheck?.action === "clock_in";
  const gpsTone =
    showGpsCheck && lastGpsCheck.withinFence === false ? "danger" : "success";
  const { t } = useTranslation();

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
          <div
            className={`mt-2 font-[var(--font-mono)] text-[40px] font-medium leading-none text-[var(--brand-yellow)] ${
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
        </div>

        {shell.clockState.isClockedIn && activeProject ? (
          <div className="surface-panel mt-4 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {activeProject.name}
                </div>
                <div className="mt-1 text-xs text-[var(--text-secondary)]">
                  {activeProject.address ?? t("clock.currentSite")}
                </div>
              </div>
              <div className="text-right text-xs text-[var(--text-muted)]">
                {activeProject.site ? `${activeProject.radius_m}${t("clock.radiusM")}` : t("clock.gpsOnly")}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {shell.projects.length === 0 ? (
              <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
                {t("clock.noProjects")}
              </div>
            ) : (
              shell.projects.map((project) => {
                const selected = selectedProjectId === project.id;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setManualProjectId(project.id)}
                    className="surface-panel w-full p-3 text-left"
                    style={{
                      borderColor: selected ? "var(--border-active)" : "var(--border-default)",
                      background: selected
                        ? "linear-gradient(180deg, rgba(191, 162, 52, 0.12), rgba(15, 17, 23, 0.95))"
                        : "var(--bg-primary)",
                      boxShadow: selected
                        ? "inset 0 1px 0 rgba(255,255,255,0.03), inset 0 0 0 1px rgba(191, 162, 52, 0.18), 0 8px 18px rgba(0,0,0,0.16)"
                        : "inset 0 1px 0 rgba(255,255,255,0.02)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          {project.name}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-secondary)]">
                          {project.address ?? t("clock.assignedSite")}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-[var(--text-muted)]">
                        {project.site ? `${project.radius_m}${t("clock.radiusM")}` : t("clock.openSite")}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => void clockIn(selectedProjectId)}
            disabled={
              shell.clockState.isClockedIn ||
              !selectedProjectId ||
              busyAction === "clock-in" ||
              shell.projects.length === 0
            }
            className="button-base button-success w-full"
          >
            {busyAction === "clock-in" ? t("clock.checkingLocation") : t("clock.clockIn")}
          </button>
          <button
            type="button"
            onClick={() => void clockOut()}
            disabled={!shell.clockState.isClockedIn || busyAction === "clock-out"}
            className="button-base button-danger w-full"
          >
            {busyAction === "clock-out" ? t("clock.closingShift") : t("clock.clockOut")}
          </button>
        </div>

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

      {shell.clockState.pendingCheckoutEventId ? (
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
