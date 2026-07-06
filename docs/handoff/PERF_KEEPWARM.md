# Perf keep-warm cron

Branch: `perf/keep-warm-cron` off `origin/claude/owner-dashboard-cleanup-rebased` at `3a65076`.

## Change

Added a purpose-built keep-warm endpoint:

- `src/app/api/keepalive/route.ts`
- `GET /api/keepalive`
- returns `204`
- no auth
- no DB
- no cookies/session reads
- no request parsing

Added `vercel.json` with a Vercel Cron entry:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/keepalive",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

## Vercel docs check

Sources checked:

- https://vercel.com/docs/cron-jobs
- https://vercel.com/docs/cron-jobs/usage-and-pricing

Relevant findings:

- Vercel Cron jobs can be configured in `vercel.json`.
- Vercel invokes the configured path with an HTTP `GET`.
- Pro supports up to 100 cron jobs per project, a one-minute minimum interval, and per-minute scheduling precision.
- Vercel cron expressions always run in UTC.

## Schedule choice

Used `*/5 * * * *` 24/7.

Reason: the crew timezone is `America/Los_Angeles`, but Vercel cron is UTC-only. A working-hours-only cron would either drift during daylight saving changes or require multiple/manual schedule changes. Since the endpoint is a no-op 204 and Pro supports this interval, the simpler 24/7 five-minute keep-warm is the lower-risk configuration.

## Scope

Touched only:

- `src/app/api/keepalive/route.ts`
- `vercel.json`
- `docs/handoff/PERF_KEEPWARM.md`

No app data paths, auth, DB, worker/offline/PWA logic, or manager pages were changed.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | passed |
| `npm run lint` | passed with 7 existing warnings |
| `npm test` | passed: 129 files / 920 tests |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |

STOP: no merge, push, or deploy.

## ИТОГ

Branch: `perf/keep-warm-cron`
Commit: recorded in final chat after commit
Report: `docs/handoff/PERF_KEEPWARM.md`

Gates:
- `npx tsc --noEmit` — passed
- `npm run lint` — passed, 7 existing warnings
- `npm test` — passed, 129 files / 920 tests
- `npm run smoke:core` — passed, `failures: []`, `warnings: []`

Plan summary:
- Added `GET /api/keepalive` as a trivial 204 endpoint with no auth/DB/session work.
- Added `vercel.json` cron for `/api/keepalive` every 5 minutes.
- Used 24/7 schedule because Vercel cron is UTC-only and LA working hours would be DST-fragile.

Questions: Task B prompt is cut off after `WorkerProjectView.tsx,`; need the rest before starting the separate Task B branch.
