# Push notifications — Phase 1 (infrastructure only)

**Branch:** `feature/push-phase1-infra` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `4001ead`)
**Scope:** the full send/subscribe pipe, with **no production triggers** — nothing sends a push except
the owner's manual `/api/worker/push/test`. Not merged/pushed.

## What the owner must do (in order — code → deploy → smoke → SQL)
1. **Generate VAPID keys** (once): `npx web-push generate-vapid-keys` → gives a public + private key.
2. **Add these env vars in Vercel** (Production, and Preview if used):

   | Env var | Value |
   |---|---|
   | `WEB_PUSH_VAPID_PUBLIC_KEY` | the VAPID **public** key |
   | `WEB_PUSH_VAPID_PRIVATE_KEY` | the VAPID **private** key (secret) |
   | `WEB_PUSH_CONTACT` | a contact, e.g. `mailto:owner@example.com` |
   | `NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY` | the **same public key** (exposed to the browser + SW) |

   No keys live in code. Until these are set, every send is a logged no-op.
3. **Deploy** this branch (after merge) and run `docs/DEPLOY_SMOKE.md` as usual.
4. **Apply the migration by hand** (mirror only — the app already no-ops until then):
   **`supabase/migrations/00046_push_subscriptions.sql`**
5. **Smoke the pipe** (below).

## Migration (mirror — owner applies)
`supabase/migrations/00046_push_subscriptions.sql` — table `push_subscriptions(id, profile_id →
profiles ON DELETE CASCADE, endpoint UNIQUE, p256dh, auth, user_agent, created_at, last_seen_at,
revoked_at NULL)` + a partial index for active-per-profile lookup. **RLS on, no client policy**;
`revoke all from anon, authenticated`; `grant … to service_role`. Same server-only shape as
`paid_api_usage` / the time_events write path — the browser never touches this table. Until it's
applied, all code paths detect `42P01`/`PGRST205` and log-once, never throw.

## Architecture (all new, channel-agnostic)
- **`src/lib/notifications/subscriptions.ts`** — service-role CRUD (`getActiveSubscriptions`,
  `upsertSubscription` (upsert on unique `endpoint`), `revokeByEndpoint`, `revokeById`). Graceful
  no-op via `isMissingTableError`.
- **`src/lib/notifications/web-push.ts`** — the one channel adapter today. VAPID from env only; silent
  no-op (`status: "skipped"`, log once) when unconfigured; **404/410 → `status: "gone"`** so the caller
  revokes the dead subscription.
- **`src/lib/notifications/send.ts`** — `sendNotificationToProfile(profileId, {title, body, url, tag})`:
  resolves the profile's active subscriptions → fans out to adapters → revokes `gone` ones → returns a
  count summary. A second channel (FCM/APNs) slots in here. Never throws.
- **Routes** (`src/app/api/worker/push/`): `subscribe` (auth-gated, upserts this device's sub for the
  caller), `unsubscribe` (revokes by endpoint), `test` (auth-gated, sends **only to the caller** —
  the owner's smoke tool). All model the `clock-in` auth boundary (`getUser` → 401; service-role writes).
- **SW (`src/app/sw.ts`)** — **additive** `push` / `notificationclick` / `pushsubscriptionchange`
  listeners. No `fetch`/`respondWith`/matcher/caching change → the Task 2.1 guardrail is untouched
  (verified: guardrail test green, built worker still has `precacheAndRoute`=0, `NavigationRoute`=0,
  nav/RSC + `sameOrigin` guards). `notificationclick` focuses an open tab (and navigates) or opens the
  url. `pushsubscriptionchange` re-subscribes using a build-injected VAPID key (via the serwist route's
  esbuild `define`) and re-posts to `/subscribe`.
- **Client** — `src/lib/push-client.ts` (support/permission/subscribe/opt-out helpers) +
  `src/components/worker/PushNotifications.tsx` (a **non-nagging** one-time-dismissible prompt when
  permission is undecided, plus a persistent **"Push-уведомления"** toggle). Mounted once in
  `WorkerShell` (2-line diff). Per-device opt-out is remembered; permission-denied is quiet (shows a
  small "blocked in browser settings" hint, no repeats). New `push.*` i18n (ru + en).

## Owner smoke (after env + migration)
1. Log in as a worker; the shell shows the **Push-уведомления** toggle (and, if undecided, a small
   "Turn on push notifications?" prompt).
2. Tap **Enable** / the toggle → grant the browser permission. A `push_subscriptions` row appears.
3. In the browser console **while logged in**, run:
   `await fetch("/api/worker/push/test", { method: "POST" }).then(r => r.json())`
   → you should receive a "Test notification — push is working" notification; the JSON reports
   `{ candidates, sent, revoked, errored, skipped }`.
4. If `skipped: true` → the VAPID env isn't set. If `candidates: 0` → no active subscription for you.

## RED LINE compliance
- **No production triggers** — no message/task/any hook calls `sendNotificationToProfile`; only the
  `/push/test` route does. No manager pages, payroll, or offline-queue schemas touched.
- `sw.ts` fetch/caching untouched (additive listeners only); Task 2.1 guardrail test unchanged + green.
- WorkerShell change is 2 lines (import + mount).

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 966 passed (+12: `push-send`, `push-phase1-source`)
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; the 3 push routes build; the worker inspection shows the guardrail holds
  and the push listeners are compiled in.
- `npm run smoke:deploy` — N/A pre-deploy (skipped, per the task).

Not merged/pushed at time of writing.
