# Alpha-7 Payroll / Salary Archive Audit

Mode: read-only code audit.  
Date: 2026-05-22.  
Production URL: https://check-time-five.vercel.app

## Confirmation

- No payroll behavior was changed.
- No payroll calculation, paid-period logic, salary archive, shift history, worker hours, rates, clock-in/out, GPS/geofence, RLS, Storage policy, schema, migration, or production data changes were made.
- No SQL was run.
- Direct SQL Supabase Step 0 remains blocked, so applied production migrations and production policies are not confirmed by this audit.

## Files Inspected

- `src/app/(manager)/payroll/page.tsx`
- `src/app/(manager)/payroll/history/page.tsx`
- `src/app/api/payroll/run/route.ts`
- `src/app/api/payroll/export/route.ts`
- `src/app/api/team/pay-worker/route.ts`
- `src/components/manager/PayrollCalculator.tsx`
- `src/components/manager/ConfirmPayrollButton.tsx`
- `src/components/worker/HoursPage.tsx`
- `src/components/worker/WorkerShell.tsx`
- `src/lib/archive-utils.ts`
- `src/lib/manager-data.ts`
- `src/lib/manager-utils.ts`
- `src/lib/payroll-period-utils.ts`
- `src/lib/payroll-export-utils.ts`
- `src/lib/payroll-audit-utils.ts`
- `src/lib/worker-hour-summary.ts`
- `tests/lib/archive-utils.test.ts`
- `tests/lib/payroll-period-utils.test.ts`
- `tests/lib/payroll-export-utils.test.ts`
- `tests/lib/payroll-audit-utils.test.ts`
- `tests/lib/worker-hour-summary.test.ts`
- `supabase/migrations/00001_foundation.sql`
- `supabase/migrations/00003_schema_gap.sql`
- `supabase/migrations/00023_archive_foundation.sql`
- `supabase/migrations/00024_worker_own_payroll_closures.sql`
- `supabase/migrations/00025_payroll_idempotency.sql`

## How Payroll Is Calculated In Code

Primary manager payroll screen:

- `src/app/(manager)/payroll/page.tsx` loads the payroll page only after `hasFinanceAccess` passes; otherwise it redirects to `/overview`.
- It passes profiles, sessions, GPS flags, shift-review acknowledgements, and payroll closures into `PayrollCalculator`.
- `getPayrollPageData` loads:
  - profiles
  - projects
  - last 90 days of `time_events`
  - recent `payroll_runs`
  - recent `payroll_closures`

Session construction:

- `buildManagerSessions` pairs `clock_in` with the next `clock_out` or `auto_out`.
- Open shifts are represented with duration through now.
- Sessions are the source of worked minutes.

Draft payroll calculation:

- `PayrollCalculator.buildWorkerLines` calculates worker-period lines from sessions inside the selected period.
- Already closed/paid minutes are excluded using each worker's latest `payroll_closures.closed_through`.
- Billable transfer gaps are added through `buildBillableTransferGapRows`.
- Overtime is split at 40 hours with 1.5x multiplier.
- Pay-period review rows are stored in `pay_period_items`.
- The manager can add bonus/reimbursement/deduction adjustments to pay-period items.

Pay period status:

- `rollupPayPeriodStatus` keeps a period in `draft` until payable workers are approved or paid.
- It becomes `approved` when every payable worker is approved or paid.
- It becomes `paid` only when every payable worker is paid.

Immutable payroll ledger:

- `pay_periods/pay_period_items` are the review screen.
- `payroll_runs/payroll_line_items/payroll_closures` are the immutable ledger/archive source.
- When a pay period is marked paid, `mirrorPaidToPayrollLedger` writes/updates the ledger first, then flips review rows to paid.
- This preserves the invariant that a visible paid row should have a closure/ledger row.

Direct payroll run routes:

- `/api/payroll/run` calculates a preview from manager sessions and writes a confirmed payroll run, line items, and closures.
- `/api/team/pay-worker` does the same for a single selected worker from the team member profile.
- Both require finance access and block unreviewed suspicious shifts before payment.

## Where Paid Periods Are Stored And Used

Review model:

- `pay_periods`
  - period label, dates, status, approval info, paid timestamp, metadata.
- `pay_period_items`
  - one worker row per pay period, rate, regular/overtime hours, gross/net totals, adjustments, status.

Ledger model:

- `payroll_runs`
  - period start/end, run status, totals, run actor, metadata.
- `payroll_line_items`
  - worker/project split, hours, rate, amount, event ids, session ids.
- `payroll_closures`
  - worker paid cutoff (`closed_through`) used to keep paid hours out of new unpaid drafts.

Worker hours:

- `WorkerShell` subscribes to `payroll_closures` for the current worker.
- `HoursPage` calls `deriveWorkerHourBuckets` to show paid/closed vs unpaid/open hours.
- `worker-hour-summary` treats the latest closure cutoff as paid/closed, while review-required sessions remain unpaid until reviewed.

## Where Archive Is Shown

Archive page:

- `src/app/(manager)/archive/page.tsx`
- Uses `buildPaidPayrollArchive` when the viewer has finance access.
- Non-finance viewers get archived project history but no payroll archive rows/amounts.

Payroll history page:

- `src/app/(manager)/payroll/history/page.tsx`
- Requires finance access.
- Shows `pay_periods` and direct `payroll_runs`.
- Direct ledger runs linked to a pay period through `metadata.pay_period_id` are not duplicated as separate history rows.

Annual report:

- `src/app/(manager)/reports/annual/page.tsx`
- Uses `getArchivePageData` and `buildPaidPayrollArchive` for paid payroll summaries when finance access allows it.

Archive helper behavior:

- `buildPaidPayrollArchive` includes:
  - paid pay period items when the period/item is paid.
  - closed ledger line items when the run status is `paid`, `confirmed`, or `exported`.
- It skips pay period items backed by a linked payroll ledger run to avoid double counting.
- It can hide gross amounts when `includeFinancials` is false.

## How Shifts Feed Payroll

- Raw shift history is stored as `time_events`.
- `clock_in` plus `clock_out`/`auto_out` becomes a manager session.
- Payroll drafts use sessions filtered by the selected period and by latest closure cutoff.
- The selected period is inclusive of the day boundaries.
- Closed payroll periods write `payroll_closures.closed_through` so future drafts exclude those minutes.
- Shift-review flags come from `shift-review` helpers and are used to block payment when sessions need review.
- Worker-side hour buckets also use closures so paid/closed periods remain visible but no longer look unpaid.

## Recent Commit Review

Recent Alpha-7 commits from the current branch did not modify payroll calculation or archive code:

- `d2fec22 docs(alpha7): audit archive and trash behavior`
- `df20735 fix(alpha7): redact sensitive logs and errors`
- `19c5279 fix(alpha7): add org guards to elevated project routes`
- `24f1b01 fix(alpha7): restore mobile navigation and realtime task updates`
- `9bc31b0 fix(forms): allow high precision coordinate inputs`

Path diff checks from `0ca85ea` through current HEAD found no changes in:

- `src/app/api/payroll`
- `src/app/api/team/pay-worker/route.ts`
- `src/components/manager/PayrollCalculator.tsx`
- `src/components/manager/ConfirmPayrollButton.tsx`
- `src/lib/payroll-period-utils.ts`
- `src/lib/payroll-export-utils.ts`
- `src/lib/payroll-audit-utils.ts`
- `src/lib/archive-utils.ts`
- `src/app/(manager)/payroll`

Older payroll-specific commits exist in history, including:

- `c9d7adf fix(payroll): keep suspicious shifts unpaid until reviewed`
- `9652f96 feat(payroll): require reviewed shifts before payment`
- `5c51c61 fix(core): tighten payroll closure and archive audit flows`
- `a613245 feat(payroll): enrich payment audit trail`
- `ea72ab2 feat(payroll): track external payment references`
- `ad02f34 chore(payroll): add database idempotency guard`
- `4f3c9e8 fix(payroll): prevent duplicate paid periods`
- `d2c641e fix(payroll): exclude closed hours from new drafts`
- `8bb1fc8 fix(payroll): close paid worker balances`
- `71e5b2d fix(payroll): sync paid periods to ledger`

## Existing Tests

Payroll/archive behavior is already covered by focused unit tests:

- `tests/lib/payroll-period-utils.test.ts`
  - status rollup
  - paid worker id selection
  - closure guard for already-paid workers
  - project-split ledger line drafts
- `tests/lib/archive-utils.test.ts`
  - paid payroll archive from pay period items
  - paid payroll archive from ledger lines
  - linked ledger preferred over pay-period item totals
  - finance-hidden archive amounts
  - date/worker/project filters
- `tests/lib/payroll-export-utils.test.ts`
  - BigBooks CSV escaping and fields
- `tests/lib/payroll-audit-utils.test.ts`
  - payroll action audit payload totals
- `tests/lib/worker-hour-summary.test.ts`
  - closure cutoffs move old sessions out of unpaid
  - review-required sessions stay unpaid
  - paid/closed adjustments avoid double counting

## Confirmed Safety In Local Code

- Payroll pages and export/run routes are finance-gated.
- Archive payroll amounts are finance-gated.
- Paid periods remain readable through Archive and `/payroll/history`.
- Worker Hours shows paid/closed vs unpaid/open without exposing pay amounts.
- Normal Trash code inspected in the archive audit does not touch payroll tables.
- Recent Alpha-7 fixes did not change payroll calculation files.
- Payment flows check suspicious/unreviewed shifts before marking rows paid.
- Pay-period payment writes ledger/closures before flipping visible review rows to paid.

## Risk Areas

1. Direct SQL remains blocked.
   - Cannot confirm whether `00024_worker_own_payroll_closures.sql` is applied in production.
   - Cannot confirm whether `00025_payroll_idempotency.sql` is applied in production.
   - Cannot confirm actual production RLS for `pay_periods`, `pay_period_items`, `payroll_runs`, `payroll_line_items`, or `payroll_closures`.

2. App-side and DB-side idempotency may differ in production.
   - Local code has app-side duplicate/closure guards.
   - Local migration `00025` adds database duplicate/overlap protection.
   - If `00025` is not applied, production relies more heavily on app-side guards.

3. There are two payroll write models.
   - Review model: `pay_periods/pay_period_items`.
   - Ledger model: `payroll_runs/payroll_line_items/payroll_closures`.
   - Code intentionally bridges them, but any future change must preserve this relationship.

4. Rate fallback differs by path.
   - `PayrollCalculator.buildWorkerLines` uses `profile.hourly_rate` and falls back to `0`.
   - `computePayrollPreview` uses `profile.hourly_rate` with fallback to `project.rate`.
   - If production workers can have `hourly_rate = null`, these paths may calculate differently.
   - Changing this would be a payroll calculation change and requires owner approval.

5. Payroll page time window is bounded.
   - `getPayrollPageData` loads last 90 days of `time_events`.
   - Direct `/api/payroll/run` routes load up to 4999 `time_events`.
   - Very old unpaid hours could require explicit owner-approved handling if this becomes a real data issue.

6. Direct payroll run routes still exist.
   - `/api/payroll/run` and `/api/team/pay-worker` can write ledger rows when finance access passes.
   - They appear intentional and guarded, but should remain in the mutation surface map for future audits.

## Unknowns Due To Blocked Direct SQL

- Whether production has the latest payroll RLS policies.
- Whether production has worker-visible payroll closure policy from `00024`.
- Whether production has duplicate/overlap indexes and trigger from `00025`.
- Whether production has old rows that violate the intended idempotency constraints.
- Whether production has all pay period and archive indexes from `00023`.

## Fixes Requiring Owner Approval

- Any change to payroll calculation or rate fallback behavior.
- Any change to paid-period status transitions.
- Any change to worker-hour paid/unpaid rules.
- Any change to shift review requirements before payment.
- Any change to payroll archive visibility or finance access.
- Applying or repairing payroll migrations in production.
- Directly editing payroll production data.
- Reworking the two-model review/ledger architecture.

## Manual QA Recommendations

- Open Payroll as owner/admin/finance user and confirm paid periods are visible.
- Open `/payroll/history` and confirm old paid periods/ledger runs appear.
- Open Archive and confirm payroll archive appears only for finance-authorized users.
- Open Archive as a non-finance manager and confirm payroll amounts are hidden.
- Open a worker Hours page and confirm paid/closed vs unpaid/open buckets still make sense.
- Confirm a paid period still links back to `/payroll?period=<id>`.
- Do not create new production payments during QA unless the owner explicitly approves a safe QA record.

## Conclusion

Local code shows payroll and salary archive behavior preserved:

- paid periods remain in payroll history/archive areas;
- paid payroll archive is not driven by Trash;
- worker hour history remains visible;
- current Alpha-7 commits did not change payroll calculation files.

The main remaining payroll risk is not an observed local regression. It is blocked verification: production database policies, indexes, triggers, and applied migrations still require Direct SQL Supabase Step 0.
