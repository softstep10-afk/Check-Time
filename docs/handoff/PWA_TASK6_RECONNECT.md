# PWA Task 6 — queue reconnect & auth-expiry hardening

**Branch:** `feature/pwa-task6-reconnect-hardening` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `4971ea0`)
**Type:** verify-and-fix (same discipline as Task 5). Traced each invariant; pinned the ones that hold;
fixed the one real gap with a point diff. Not merged/pushed.

## Findings table

| # | Invariant | Traced actual | Action |
|---|---|---|---|
| 1 | Queued work survives reload / SW-update-reload / auth-expired redirect; **nothing clears the queues on logout** | `handleSignOut` calls `clearOfflineSnapshotsForActor` (which removes **only** `cc_offline_field_cache:*` keys — verified it leaves `cc_offline_time_events`/`_field_actions`/`_uploads` intact), then `signOut`+`/login`. The auth-expired handler is `router.push("/login?expired=1")` — no localStorage touch. SW-update reload is `location.reload()` (localStorage persists) and is queue-gated by Task 3. `persist()` only `removeItem`s an **empty** queue. | **VERIFIED** + pinned |
| 2 | Reconnect drain replays **only** after auth is valid | **GAP** → **FIXED.** The auto-drain effect fired `drainOfflineQueue()` on reconnect with **no auth gate**. On an expired session the replays 401'd; time-events/uploads recovered (re-drained on next pass) but **field actions were marked `"failed"` and then permanently skipped** by the drain filter (`status !== "failed"`) — real data loss for queued task claims/status/messages. | **FIXED** |
| 3 | Offline / status-0 failures never dispatch `check-time:auth-expired` | `shouldSkipAuthExpiredClassification` returns true on `navigator.onLine === false` and `response.status === 0`. | **VERIFIED** + pinned (new behavior tests) |
| 4 | A **real** online 401/403 still redirects to `/login?expired=1` | `authAwareFetch`: online + Supabase-REST 401/403 with `bodyLooksAuthExpired` (or anon-key fallback) → `dispatchAuthExpired` → providers → `/login?expired=1`. | **VERIFIED** (existing tests kept) |
| 5 | After successful re-login, queues drain normally | Consequence of the fix: post-reauth the mount + `online` effects call `drainOfflineQueue()` again, the gate now passes, replays succeed. | **VERIFIED** + pinned |

## The one fix (point diff)
`src/components/worker/WorkerShell.tsx` — `drainOfflineQueue()` now verifies the session **before** any
replay:
```ts
const { data: { user: drainUser }, error: drainAuthError } = await supabase.auth.getUser();
if (drainAuthError || !drainUser) return;   // leave every queued item intact for a post-reauth drain
```
Placed after the empty-check and **before** `setDraining(true)` / the replay loops, so an expired session
aborts the drain without firing a single 401 — queued work stays exactly as it was. `getUser()` hits the
Auth endpoint, which `authAwareFetch` never classifies as auth-expired, so the gate can't false-fire; the
auth-expired redirect is driven by the next authenticated call (e.g. the shell-data refresh) as before.
No queue schema/drain-format change, no api/RLS change.

## Tests
- `tests/lib/supabase-client-auth-expired.test.ts` (**extended**, invariant 3): +`navigator.onLine === false`
  and +`status === 0` cases → **no** dispatch. (Invariant 4's online-401→dispatch and anon-key cases were
  already pinned and are kept.)
- `tests/lib/pwa-reconnect-hardening.test.ts` (**new**):
  - Invariant 1 (behavior): `clearOfflineSnapshotsForActor` removes the snapshot key but leaves all three
    `cc_offline_*` **queue** keys byte-for-byte intact.
  - Invariant 1 (source): `handleSignOut` uses the snapshot-only clear and there is no `localStorage.clear`
    / raw `cc_offline_*` removal; the auth-expired handler pushes `/login?expired=1` without touching
    localStorage.
  - Invariant 2 (source): the `getUser()` gate exists inside `drainOfflineQueue` **before** `setDraining`.
  - Invariant 5 (source): the `online` auto-drain trigger is present (post-reauth drain path).

## RED LINE compliance
- **Untouched:** queue storage formats/schemas (tests use public API / key constants only), `sw.ts`, the
  Task 2.1 guardrail test, api routes, RLS. No api/RLS change was required for the gap.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 950 passed (135 files; +7)
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; built worker inspected: `precacheAndRoute`=0, `NavigationRoute`=0, nav/RSC +
  `sameOrigin` guards present — Task 2.1 guardrail holds; `sw.ts` and the guardrail test are unchanged.

## Needs device confirmation (owner — installed PWA, real device)
The code path is unit-covered; these confirm real-device timing/behavior:
1. Clock in/out offline (queues an event). Let the session **expire** (or simulate: stay offline past the
   token lifetime), then go **back online**. Expect: **no** "session expired" bounce *from the drain*, the
   queued event stays "pending" (not "failed"), no error toast.
2. Re-login. Expect the pending clock event + any queued task action/upload to drain and sync, and the
   pending badges clear.
3. Trigger a genuine online 401 (e.g. revoke the session server-side while online) → confirm it **still**
   redirects to `/login?expired=1` (invariant 4 not weakened).
4. Reload / SW-update-reload with queued work present → queued items still listed afterward.

**Residual (minor, flagged):** if the session expires **mid-drain** (valid at the gate, expires during the
replay loop), a field action can still hit the "failed"-then-skipped path. Rare; the gate covers the stated
"reconnect with an already-expired session" scenario. A fuller fix (treat 401/403 during replay as
retryable) would need the drain to thread the HTTP status into its catch — out of scope for this point diff.

Not merged/pushed at time of writing.
