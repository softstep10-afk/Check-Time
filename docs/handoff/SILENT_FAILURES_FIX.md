# Silent Failures Fix — C-M6/M7/M10

Date: 2026-07-05
Branch: `fix/silent-failures-c-m6-m7-m10`
Base: `claude/owner-dashboard-cleanup-rebased` (`01e388d`)

## Scope

Fixed the three silent-failure items from `AUDIT_2026-07-03` without changing successful-path behavior:

- C-M6: offline media upload drain failures now stay queued with retry state and are visible to the worker.
- C-M7: manager force-checkout now verifies side-effect writes and reports partial failures.
- C-M10: supply-store active toggle now checks and surfaces update errors before changing local UI state.

No migrations, RLS changes, route permission changes, or deploy/merge/push were performed.

## Point Diffs

- `src/lib/offline-uploads.ts`
  - Added `OfflineUploadStatus = "pending" | "syncing" | "retry"`.
  - New queued uploads start as `pending`.
  - Legacy queued uploads without status are normalized as `pending`.
  - Added `markOfflineUploadStatus()` and `countRetryOfflineUploads()`.

- `src/components/worker/WorkerShell.tsx`
  - Media drain marks each full-payload upload as `syncing` before the upload attempt.
  - Storage upload failures now mark the item `retry`, increment retry count, preserve last error, and keep the item in localStorage.
  - Media row insert failures now do the same instead of silently continuing.
  - Worker sees `uploads.syncFailed` in the existing banner/pill area when queued media cannot sync.
  - Successful upload+insert still removes the item exactly as before.

- `src/lib/store-visits.ts`
  - `closeOpenStoreVisits()` now returns `{ ok, failures }`.
  - Select/delete/update/fallback-update errors are recorded per operation.
  - The helper still does not throw, so worker clock-out remains non-blocking.

- `src/components/manager/ForceCheckoutButton.tsx`
  - Primary `time_events` insert failure still blocks force checkout.
  - After primary success, profile cleanup, store visit cleanup, worker notification, and audit log writes are checked.
  - Any side-effect failure produces a visible partial-failure result for the manager instead of a false success.
  - Full success still shows the existing success result.

- `src/lib/audit.ts`
  - `logAudit()` remains best-effort and non-throwing.
  - It now returns `{ ok: true }` or `{ ok: false, errorMessage }` so force checkout can report audit partial failure.
  - Existing `void logAudit(...)` callers remain compatible.

- `src/app/(manager)/stores/page.tsx`
  - Store active toggle now captures the Supabase update result.
  - On error, it shows the page message and leaves local `stores` state unchanged.
  - On success, it updates local state as before.

- `src/lib/i18n/translations.ts`
  - Added copy for upload sync failure, force-checkout partial failures, and store toggle failure.

- Tests added:
  - `tests/lib/offline-uploads.test.ts`
  - `tests/lib/store-visits.test.ts`
  - `tests/lib/silent-failures-source.test.ts`

## Verification

- Targeted tests:
  - `npx vitest run tests/lib/offline-uploads.test.ts tests/lib/store-visits.test.ts tests/lib/silent-failures-source.test.ts`
  - Result: passed, 8 tests.

- Full gates:
  - `npx tsc --noEmit` — passed.
  - `npm run lint` — passed with 7 warnings, no errors. Warnings are pre-existing baseline-style warnings in unrelated files plus the existing `WorkerShell` unused import warning.
  - `npm test` — passed, 124 files / 886 tests.
  - `npm run smoke:core` — passed, no failures or warnings.

- Diff sanity:
  - `git diff --check` — passed. Windows CRLF normalization warnings only.

## Supabase Logs

Could not complete the CLAUDE.md Supabase log check from this session:

- Tool discovery exposed no Supabase MCP log tool.
- Repo has no Supabase log-check script.
- `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` were not present in environment or `.env.local`.
- `.env.local` does contain the app Supabase URL and service role key, which was enough for `smoke:core` to read prod data successfully, but not enough to query platform logs.

## Stop Point

Stopped before merge/push as requested.
