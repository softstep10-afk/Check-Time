# Server Timezone Batch 2

Date: 2026-07-05
Branch: `fix/server-tz-batch2`
Base: `origin/claude/owner-dashboard-cleanup-rebased` at `1636b7a`

## Scope

Display-formatting only. This batch pins the two remaining inline server-side timestamp formatters from `docs/handoff/SERVER_TZ_FIX.md` to the org timezone.

No parsing, duration math, day-key math, database logic, routes, RLS, migrations, merge, push, or deploy changes.

## Changes

- `src/app/(manager)/command-center/page.tsx`
  - Imported `ORG_TIMEZONE` from `@/lib/worker-utils`.
  - Added `timeZone: ORG_TIMEZONE` to `auditDateFormatter` for audit-log timestamps.

- `src/app/(manager)/archive/projects/[id]/page.tsx`
  - Imported `ORG_TIMEZONE` from `@/lib/worker-utils`.
  - Added `timeZone: ORG_TIMEZONE` to inline `toLocaleString()` calls for:
    - session clock-in
    - session clock-out
    - task `completed_at`

## Verification

- `npx tsc --noEmit` — passed.
- `npm run lint` — passed with 7 baseline warnings, 0 errors.
- `npm test` — passed, 124 files / 886 tests.
- `npm run smoke:core` — passed, no warnings or failures.
  - First attempt in `ct-codex` failed because `.env.local` was absent.
  - Retried after temporarily copying the ignored `.env.local` from the sibling worktree; removed it after the smoke run.
- `git diff --check` — passed. Windows CRLF normalization warnings only.

## Stop Point

Stopped after gates. No merge, push, or deploy performed.
