/**
 * Worker hour-summary buckets for the manager Worker Profile and the
 * worker-side Hours/Journal pages.
 *
 * Two product behaviours live here:
 *
 *   1. Time-window buckets — today, yesterday, current week, previous
 *      week, current month, total worked. Computed from session
 *      durations only; payroll closures and adjustments are layered
 *      on separately so the manager can see "raw hours" vs "what's
 *      payable now".
 *
 *   2. Paid / closed visibility — manager-side "reset to zero" writes
 *      a negative time_events.adjust event with metadata.kind = "reset_to_zero"
 *      AND an explicit reason "Period closed, hours paid". A separate
 *      payroll_closures table also records "closed_through" timestamps
 *      from the pay_periods → paid bridge (mirrorPaidToClosures). Either
 *      source means "these hours are no longer in the unpaid pool". The
 *      helper splits them out so the UI can show:
 *
 *        worked_total   = sessions before any reduction
 *        paid_or_closed = adjustments + closure cutoffs
 *        unpaid         = worked_total - paid_or_closed (clamped at 0)
 *
 *      This is what makes a worker like Vasya — whose week shows 0m even
 *      though he has sessions — readable. The closed-period reset is the
 *      reason; surfacing it as its own card prevents the impression that
 *      the data was lost.
 *
 * Pure logic — every input is plain data. No DB / React. Easy to test.
 */

export interface SessionLike {
  /** ISO timestamp of clock-in. */
  clockInTime: string;
  /** ISO timestamp of clock-out, or null when still open. */
  clockOutTime: string | null;
  /** Pre-computed minutes for the closed window OR up-to-now for open. */
  durationMinutes: number;
}

export interface AdjustmentLike {
  /** ISO timestamp the adjustment was written. */
  eventTime: string;
  /** Signed minutes — negative for "took away", positive for "credit". */
  minutes: number;
  /** Free-form reason. Matches metadata.reason on the adjust time_event. */
  reason: string;
  /**
   * Optional kind from time_events.metadata.kind. The reset-to-zero flow
   * stamps this as "reset_to_zero" so we can identify "closed-period"
   * adjustments distinct from one-off bonus / penalty corrections.
   */
  kind?: string | null;
}

export interface PayrollClosureLike {
  /** ISO timestamp marking everything <= it as paid for this profile. */
  closedThrough: string;
}

export interface WorkerHourBuckets {
  /** Sessions with clockInTime within today (00:00 → now). */
  todayMinutes: number;
  /** Sessions with clockInTime within yesterday (24h before today). */
  yesterdayMinutes: number;
  /** Sessions whose clockInTime falls in the current Mon–Sun window. */
  currentWeekMinutes: number;
  /** Sessions whose clockInTime falls in the previous Mon–Sun window. */
  previousWeekMinutes: number;
  /** Sessions whose clockInTime falls in the current calendar month. */
  currentMonthMinutes: number;
  /** Total of every session's durationMinutes regardless of date. */
  totalWorkedMinutes: number;
  /**
   * Sum of *positive* adjustment minutes plus the *absolute* of any
   * paid/closed adjustments — represents "hours moved into the paid /
   * closed bucket" (a reset_to_zero of −50h shows as +50h here). UI
   * labels this as "Paid / closed".
   */
  paidOrClosedMinutes: number;
  /** Sum of every adjustment row, signed. Useful for an audit total. */
  adjustmentsTotalMinutes: number;
  /**
   * Hours still pending payroll = totalWorkedMinutes - paidOrClosedMinutes.
   * Clamped at 0 — adjustments that exceed worked hours mean the worker
   * has already been paid in advance, not that they owe negative time.
   */
  unpaidMinutes: number;
}

const RESET_KINDS = new Set(["reset_to_zero", "period_closed"]);

/**
 * Did this adjustment originate from a paid/closed-period reset?
 *
 * Two signals:
 *   1. metadata.kind in {"reset_to_zero","period_closed"} (canonical)
 *   2. reason text matches the localised reset reasons (legacy rows
 *      that pre-date the kind tag).
 */
export function isPaidOrClosedAdjustment(adj: AdjustmentLike): boolean {
  if (adj.kind && RESET_KINDS.has(adj.kind)) return true;
  const reason = (adj.reason ?? "").toLowerCase();
  if (!reason) return false;
  // English + Russian reset_to_zero reasons (member.resetReason key).
  // Keep both — we don't know which locale the manager was on when the
  // row was written.
  if (reason.includes("period closed")) return true;
  if (reason.includes("hours paid")) return true;
  if (reason.includes("период закрыт")) return true;
  if (reason.includes("часы оплачены")) return true;
  return false;
}

function startOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMondayWeek(d: Date): Date {
  const next = startOfDay(d);
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function startOfMonth(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  next.setDate(1);
  return next;
}

/**
 * Compute every hour bucket from the same session/adjustment/closure
 * arrays the worker shell already loads. `now` is parametrised so tests
 * can pin a deterministic clock.
 */
export function deriveWorkerHourBuckets(args: {
  sessions: SessionLike[];
  adjustments: AdjustmentLike[];
  closures?: PayrollClosureLike[];
  now?: Date;
}): WorkerHourBuckets {
  const now = args.now ?? new Date();

  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);
  const currentWeekStart = startOfMondayWeek(now);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const currentMonthStart = startOfMonth(now);

  let todayMinutes = 0;
  let yesterdayMinutes = 0;
  let currentWeekMinutes = 0;
  let previousWeekMinutes = 0;
  let currentMonthMinutes = 0;
  let totalWorkedMinutes = 0;

  for (const session of args.sessions) {
    const inDate = new Date(session.clockInTime);
    const minutes = session.durationMinutes;
    totalWorkedMinutes += minutes;
    if (inDate >= todayStart) {
      todayMinutes += minutes;
    } else if (inDate >= yesterdayStart) {
      yesterdayMinutes += minutes;
    }
    if (inDate >= currentWeekStart) {
      currentWeekMinutes += minutes;
    } else if (inDate >= previousWeekStart) {
      previousWeekMinutes += minutes;
    }
    if (inDate >= currentMonthStart) {
      currentMonthMinutes += minutes;
    }
  }

  let paidOrClosedMinutes = 0;
  let adjustmentsTotalMinutes = 0;
  for (const adj of args.adjustments) {
    adjustmentsTotalMinutes += adj.minutes;
    if (isPaidOrClosedAdjustment(adj)) {
      // A reset_to_zero is recorded as a NEGATIVE minutes value; the
      // paid/closed bucket should display it as POSITIVE hours moved
      // out of unpaid. abs() lets one-off positive credits land in the
      // bucket cleanly too if a manager ever uses kind=period_closed
      // for a forward-credit.
      paidOrClosedMinutes += Math.abs(adj.minutes);
    }
  }

  // payroll_closures rows do NOT carry a minute count — they only mark a
  // cutoff timestamp. Sum of session minutes whose clockOutTime ≤
  // closedThrough, on a per-closure basis, would double-count if a
  // worker has multiple closures. Keep the closure data available for
  // UI presentation and rely on the reset_to_zero adjustment as the
  // accounting source-of-truth.
  void args.closures;

  const unpaidMinutes = Math.max(0, totalWorkedMinutes - paidOrClosedMinutes);

  return {
    todayMinutes,
    yesterdayMinutes,
    currentWeekMinutes,
    previousWeekMinutes,
    currentMonthMinutes,
    totalWorkedMinutes,
    paidOrClosedMinutes,
    adjustmentsTotalMinutes,
    unpaidMinutes,
  };
}
