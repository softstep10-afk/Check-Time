# Shift rows — add local calendar date

**Branch:** `feature/shift-row-dates` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** display-only. Two point diffs, plus their `worker-utils` imports. No behavior/data/logic
changes.

## Problem
Recent-shifts rows on `TeamMemberPage` ("Оперативная сводка" → "Последние смены") showed only
`clock-in → clock-out` times, so shifts from different days were indistinguishable.

## Formatter used
`formatEventDate` from `src/lib/worker-utils.ts` — the existing shared date-only formatter
(`Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" })`):
locale-aware (renders ru on ru devices, en on en), date-only so no AM/PM concern. It is the
sibling of `formatEventTime` already used in these rows.

## Changes
1. **`TeamMemberPage.tsx`** (primary) — the summary "Последние смены" row now prefixes the date:
   `{formatEventDate(clockInTime)} · {formatEventTime(clockInTime)} → {formatEventTime(clockOutTime)}`.
2. **`PayrollCalculator.tsx`** — the per-shift breakdown rows span a whole pay **period** (multiple
   days) and used the same time-only `clock-in → clock-out` pattern, so a date span was added to
   each row for the same reason. Display only; no payroll math touched.

## Considered and intentionally skipped (date would be redundant)
- **DayDetailModal** — inherently scoped to a single calendar day (it filters sessions to one
  `date`); every row is the same day, so a per-row date adds noise, not clarity.
- **Overview dashboard lists** (`overview/page.tsx`) — both are on-site/today snapshots
  (live `onSiteSessions` and a `todayMinutes` table), i.e. single-day/live, so a date is redundant.
- **The fuller recent-shifts list lower on `TeamMemberPage`** (~L2698) already renders the date via
  `formatDateTime` (month + day + time), so no change needed.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 878 passed (121 files)
- `npm run smoke:core` — no failures, no warnings
- `npm run alpha7:predeploy` — passed (run because PayrollCalculator is payroll-adjacent)

Not merged/pushed at time of writing.
