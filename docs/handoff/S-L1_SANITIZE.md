# S-L1 Sanitize AI Route Errors

Date: 2026-07-05
Branch: `fix/s-l1-sanitize-ai-errors`
Base: `claude/owner-dashboard-cleanup-rebased`

## Scope

Sanitized client-facing caught error messages in the `ai/*` API routes and
`worker/jarvis` by routing them through `safeClientErrorMessage`.

Changed files:

- `src/app/api/ai/actions/create-task/route.ts`
- `src/app/api/ai/daily-report/route.ts`
- `src/app/api/ai/memory/route.ts`
- `src/app/api/ai/photo-analysis/route.ts`
- `src/app/api/ai/settings/route.ts`
- `src/app/api/ai/voice-command/route.ts`
- `src/app/api/worker/jarvis/route.ts`

## Notes

- Preserved existing HTTP status codes.
- Preserved existing JSON contracts.
- Preserved paid API limiter behavior, including 429 responses and `Retry-After`.
- Left server-side logging behavior intact.
- No DB/RLS/schema changes.
- `.env.local` already existed in this worktree; no temporary env copy was created or deleted.
- Stopped before merge/push.

## Verification

- `npx tsc --noEmit` passed.
- `npm run lint` passed with 7 pre-existing warnings, 0 errors.
- `npm test` passed: 121 test files, 878 tests.
- `npm run smoke:core` passed: 0 failures, 0 warnings.

