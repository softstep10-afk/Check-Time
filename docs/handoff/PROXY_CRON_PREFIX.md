# Proxy cron prefix — one-line auth-gate fix

**Branch:** `fix/proxy-cron-prefix` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `ef0071c`)
**Date:** 2026-07-06

## Problem (found by live smoke)
`/api/cron/geofence-scan` never reached its handler in prod. `src/proxy.ts` is THE
auth gate; its `PUBLIC_PREFIXES` had no cron entry, so Vercel's cron invocations —
which carry no user session — hit the gate, matched no public prefix, and were
307-redirected to `/login`. The geofence-scan handler (and its `CRON_SECRET` bearer
check) never ran.

## Fix (the only source change)
Added `"/api/cron/"` to `PUBLIC_PREFIXES` in `src/proxy.ts`, with a comment noting
that cron routes self-protect via `CRON_SECRET` (a bearer check inside the handler) —
that bearer check is the security boundary, not the session gate. The trailing slash
scopes the match to the `/api/cron/` namespace only.

Nothing else in `proxy.ts` changed (RED LINE respected).

## `/api/keepalive` — verified, left AS-IS
`/api/keepalive` is `GET() => new Response(null, { status: 204 })`. It is also caught
by the gate today and 307-redirected to `/login`, yet still fulfils its warm-up
purpose: the cron ping spins the deployment up and runs the proxy either way, so the
function stays warm regardless of whether the 204 handler itself is reached. It lives
at `/api/keepalive` (not under `/api/cron/`), so the new prefix does not touch it.

Decision: **leave as-is.** There is no behavior requirement either way, and moving it
would require relocating the route or adding a second public prefix — scope beyond this
one-line fix. If a future cleanup wants keepalive to return its real 204 to the cron,
relocate it under `/api/cron/` or add `/api/keepalive` to `PUBLIC_PREFIXES` then.

## Test
Extended the existing functional guardrail suite
`tests/lib/auth-route-guards.test.ts` (it drives the real `proxy` with a mocked
`getUser`), adding two anonymous-in-production cases:
- `/api/cron/geofence-scan` → **no redirect** (public; handler + `CRON_SECRET` own the boundary).
- `/api/worker/shell-data` → still **redirected to `/login`** (non-cron `/api/*` stays gated).

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 pre-existing warnings, none in changed files) |
| `npm test` | 999 passed / 999 (141 files; +2 new) |
| `npm run smoke:core` | 0 failures, 0 warnings |

Stopped here — not merged, pushed, or deployed.
