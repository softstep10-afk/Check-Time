# Heavy Reads Batch 1 - C-H3 / C-M1 / C-M3

Date: 2026-07-05
Branch: `hygiene/heavy-reads-batch1`
Base: `origin/claude/owner-dashboard-cleanup-rebased` at `cce83e0`

## Scope

Fixed the three July 3 audit heavy-read areas:

- C-H3 annual report: `src/app/(manager)/reports/annual/AnnualReportClient.tsx`
- C-M1 schedule: `src/app/(manager)/schedule/SchedulePageClient.tsx` and `src/app/api/schedule/route.ts`
- C-M3 location-data: `src/app/(manager)/location-data/page.tsx`

Not touched: worker clock/shell/overlays, overview page, payroll routes.

Receipts C-M2 note: no dedicated receipt surface was changed. The annual report receipt read was changed only because it is part of C-H3 material-cost aggregation.

## Changes

Annual report:

- Added `src/app/api/reports/annual/route.ts`.
- Moved raw annual `time_events`, receipt `media`, and `store_visits` processing out of the browser and into a finance-gated API route.
- Client now fetches one aggregate payload and renders the same worker/project/month/store report rows, CSV, and PDF from those aggregates.
- Replaced annual `select("*")` reads with explicit columns:
  - `projects`: `id, name, address, status, start_date, end_date`
  - `time_events`: `profile_id, project_id, event_type, event_time`
  - `media`: `project_id, metadata, created_at`
  - `store_visits`: `worker_id, worker_name, store_id, store_name, store_chain, duration_seconds`
- Annual time events are also filtered to `clock_in`, `clock_out`, `auto_out`, matching what the old client code actually used.

Schedule:

- Replaced schedule client `projects.select("*")` with `id, name, address, status, site_point, start_date, end_date`.
- Replaced schedule client `tasks.select("*")` with `id, project_id, assigned_to, title, description, priority, status, due_date, completed_at, metadata`.
- Replaced schedule API write-return `select("*")` calls with the same narrow project/task return shapes.

Location data:

- Added `src/app/api/location-data/mileage/route.ts`.
- Replaced the browser pull of up to `20000` `worker_live_locations` rows with an API route that returns mileage summaries plus scalar counts.
- Server route always applies a bounded date window. Missing/invalid dates fall back to the current month through today.
- Server route pages GPS reads internally in `1000`-row chunks and selects only `worker_id, lat, lng, accuracy, recorded_at` for mileage math.
- Browser now receives summary rows only; no raw GPS point rows are shipped to the page.

## Reduction Measurements

No Supabase MCP/query credentials were available in this worktree, so these measurements are code-path/query-shape reductions rather than production data counts. The new annual API returns `sourceRowCounts` at runtime so production can compare actual source rows without sending raw rows to the browser.

| Page | Before | After | Row-count reduction | Payload reduction |
| --- | --- | --- | --- | --- |
| Annual report / C-H3 | Browser received raw annual `time_events` rows, receipt `media` rows, and `store_visits` rows. | Browser receives aggregate arrays only (`workerHours`, `projectHours`, monthly counts/materials, store breakdowns). | Raw `time_events`/`media`/`store_visits` rows to browser: 100% removed. DB source rows still read server-side for exact aggregates; `time_events` source rows are additionally reduced to payroll event types only. | Column width reduced: `projects` 18 -> 6 (-66.7%), `time_events` 17 -> 4 (-76.5%), `media` 16 -> 3 (-81.3%), `store_visits` 11 -> 6 (-45.5%). |
| Schedule / C-M1 | Client read active projects and date-window tasks with `select("*")`. | Same visible row sets, narrow columns only. | Rows unchanged intentionally: project selectors/deadlines still need all active non-archived projects; tasks still need the visible calendar date window. | Column width reduced: `projects` 18 -> 7 (-61.1%), `tasks` 18 -> 10 (-44.4%). Write-return payloads use the same narrow shapes. |
| Location-data / C-M3 | Browser read up to `20000` raw GPS point rows, 9 columns each. | Browser receives one summary row per tracked mileage person plus scalar totals/oldest/estimated size. | Raw GPS point rows to browser: 100% removed (`<=20000` -> `0`). Summary rows are bounded by tracked mileage people. | Browser raw GPS payload removed. Server-side GPS scan width reduced from 9 columns -> 5 (-44.4%) and is restricted to mileage roles plus the selected/effective date window. |

## Gates

- `npx tsc --noEmit`: pass
- `npm run lint`: pass, with existing warnings only (7 warnings, 0 errors)
- `npm test`: pass, 124 files / 886 tests
- `npm run smoke:core`: pass after `.env.local` was placed in this worktree. Checked at `2026-07-05T22:29:44.039Z`; failures `[]`, warnings `[]`.

## Profile-Rates Source Guard

`tests/lib/profile-rates-source.test.ts` was updated because the annual report profile read moved out of `AnnualReportClient.tsx` and into `src/app/api/reports/annual/route.ts`.

The old assertion required `AnnualReportClient.tsx` to contain `PROFILE_SELECT_WITHOUT_RATE` / `profilesWithoutRates`. Keeping that assertion would either fail the suite or force a stale client-side profile read back into the annual report, which is opposite of this batch's goal.

The updated guard is still about the same safety boundary: it now asserts the annual client does not read `profiles`, the annual API route uses `ANNUAL_PROFILE_SELECT = "id, name, role"`, and the route does not select `hourly_rate` or `pin_hash`.

This is not a payroll-rates behavior change; it is a source-test path correction required by moving and narrowing the annual report read.

## Commits

- `492ac44` - `perf(annual-report): aggregate heavy reads server-side`
- `6d1db21` - `perf(location-data): aggregate mileage reads server-side`
- `2510095` - `perf(schedule): narrow calendar read payloads`

This handoff report is committed separately after those code commits so it can include their hashes.

## Stop Point

No merge, push, or deploy performed.
