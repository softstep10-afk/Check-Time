"use client";

import { WorkerSessionMeta, useWorkerShell } from "@/components/worker/WorkerShell";
import {
  formatDateTime,
  formatDurationCompact,
  formatEventDate,
} from "@/lib/worker-utils";
import { useTranslation } from "@/lib/i18n";

export function HoursPage() {
  const { shell, muted, toggleMute } = useWorkerShell();
  const { t } = useTranslation();
  const groupedSessions = shell.sessions.reduce<Map<string, typeof shell.sessions>>(
    (groups, session) => {
      const key = formatEventDate(session.clockInTime);
      const list = groups.get(key) ?? [];
      list.push(session);
      groups.set(key, list);
      return groups;
    },
    new Map(),
  );

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("hours.personalLedger")}
        </p>
        <h2 className="mt-1 text-xl font-bold text-[var(--text-primary)]">
          {t("hours.hoursFromLog")}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t("hours.description")}
        </p>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <span aria-hidden>{muted ? "🔇" : "🔊"}</span>
              <span>{t("messages.silentMode")}</span>
            </div>
            <p className="mt-1 max-w-[42ch] text-xs text-[var(--text-secondary)]">
              {t("messages.silentModeHelp")}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleMute}
            role="switch"
            aria-checked={muted}
            aria-label={t("messages.silentMode")}
            className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors"
            style={{ background: muted ? "var(--brand-yellow)" : "var(--border-default)" }}
          >
            <span
              className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: muted ? "translateX(22px)" : "translateX(4px)" }}
            />
          </button>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="metric-panel rounded-[var(--radius-md)] p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("common.today")}
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">
              {formatDurationCompact(shell.summary.todayMinutes)}
            </div>
          </div>
          <div className="metric-panel rounded-[var(--radius-md)] p-3">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("common.thisWeek")}
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">
              {formatDurationCompact(shell.summary.weekMinutes)}
            </div>
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-bold text-[var(--text-primary)]">{t("common.sessions")}</div>
          <div className="text-xs text-[var(--text-muted)]">{shell.sessions.length} {t("hours.entries")}</div>
        </div>

        <div className="mt-4 space-y-5">
          {shell.sessions.length === 0 ? (
            <div className="surface-panel p-4 text-sm text-[var(--text-secondary)]">
              {t("hours.noHours")}
            </div>
          ) : (
            Array.from(groupedSessions.entries()).map(([day, sessions]) => (
              <div key={day}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {day}
                </div>
                <div className="space-y-3">
                  {sessions.map((session, index) => (
                    <div
                      key={session.id}
                      className="surface-panel p-3"
                      style={{
                        background:
                          index % 2 === 0
                            ? "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(15,17,23,0.96))"
                            : "rgba(15, 17, 23, 0.82)",
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-base font-semibold text-[var(--text-primary)]">
                            {session.projectName}
                          </div>
                          <div className="mt-1 text-xs text-[var(--text-secondary)]">
                            {session.clockOutTime
                              ? formatDateTime(session.clockOutTime)
                              : t("hours.stillRunning")}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-base font-bold text-[var(--text-primary)]">
                            {formatDurationCompact(session.durationMinutes)}
                          </div>
                          {session.checkoutStatus !== "not_required" ? (
                            <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-[var(--brand-yellow)]">
                              {session.checkoutStatus}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3">
                        <WorkerSessionMeta
                          start={session.clockInTime}
                          end={session.clockOutTime}
                          duration={session.durationMinutes}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {shell.adjustments.length > 0 ? (
        <section className="surface-card surface-card--muted p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-lg font-bold text-[var(--text-primary)]">
              {t("hours.adjustments")}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {shell.adjustments.length} {t("hours.entries")}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {shell.adjustments.map((adj) => {
              const positive = adj.minutes >= 0;
              const sign = positive ? "+" : "−";
              const absMin = Math.abs(adj.minutes);
              return (
                <div
                  key={adj.id}
                  className="surface-panel flex items-start justify-between gap-3 p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {adj.projectName ?? t("common.general")}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                      {formatDateTime(adj.eventTime)}
                    </div>
                    {adj.reason ? (
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">{adj.reason}</p>
                    ) : null}
                  </div>
                  <span
                    className="shrink-0 whitespace-nowrap font-mono text-sm font-bold"
                    style={{ color: positive ? "var(--green)" : "var(--red)" }}
                  >
                    {sign}{formatDurationCompact(absMin)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
