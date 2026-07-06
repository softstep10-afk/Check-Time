# PWA Task 5 — worker surfaces offline QA

**Branch:** `feature/pwa-task5-offline-qa` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `5d72ab3`, PWA re-release live)
**Type:** verify-and-fix. Traced each surface's offline path end-to-end; pinned correct behavior with
tests; fixed one real (minor) gap with a point diff. Not merged/pushed.

## Findings table (surface × expected × actual × action)

| Surface | Expected | Actual (traced) | Action |
|---|---|---|---|
| **/clock** | cached shift/project renders offline; clock in/out → `cc_offline_time_events` with `client_event_id` dedup; no blank; no false auth-expired | `ClockPage` reads shift/project/session **only** from `useWorkerShell()` — no page-level fetch, so no blank when offline. `WorkerShell` generates a `crypto.randomUUID()` `client_event_id`, takes an offline-first path (`!navigator.onLine` → queue immediately) via `queueOfflineEvent`, and overlays queued events onto the shell (`applyQueuedEventsToShell`). `authAwareFetch`→`shouldSkipAuthExpiredClassification` returns true when `navigator.onLine===false` or `status===0` → no false `check-time:auth-expired` redirect. | **VERIFIED** — added `offline-time-events.test.ts` (queue had no unit test) + source proofs |
| **/my-tasks** | `worker-tasks` snapshot renders; claim/status → `cc_offline_field_actions` | `TasksPage` reads `worker-tasks`/`worker-projects` snapshots; `OfflineCacheNotice`/empty state; actions queue via WorkerShell field-actions | **VERIFIED** — already pinned by `offline-readable-cache-source.test.ts` + `offline-field-actions.test.ts` |
| **/my-projects** | `worker-projects` snapshot renders | `WorkerProjectsList` reads `worker-projects`; notice/empty state; can open a cached project summary offline | **VERIFIED** — already pinned by `offline-readable-cache-source.test.ts` |
| **/project/:id** | cached detail via `worker-project-detail`, or a clear "cached unavailable" state; never crash/blank | `WorkerProjectView` saves on online, loads on offline; render branches: cached snapshot → cached-unavailable notice → normal (no blank/crash) | **VERIFIED** — already pinned by `offline-readable-cache-source.test.ts` |
| **Maps/directions** | no SW caching of Google Maps; no uncaught errors; sane fallback (address text ok) | SW runtime matchers are **all `sameOrigin`-gated**, so cross-origin `maps.googleapis.com` can **never** be cached (confirmed in the built worker: `sameOrigin`×5, and no `googleapis` string). `ProjectNavigationActions` is pure (URL builders + deep-link `<a href>` + copyable address) — **no** script load, offline-safe. `MapProvider` handles `loadError`/`!isLoaded` gracefully (no uncaught error) **but** showed a misleading "check API key/billing" message when the real cause was being offline. | **FIXED** (map fallback) + **VERIFIED** (SW/directions) |

## The one fix (point diff)
`src/components/maps/GoogleMaps.tsx` — when the Maps script fails to load **and** `navigator.onLine === false`,
show `offlineUnavailable` ("Map unavailable while you're offline." / ru) instead of the API-key/billing
message. A worker offline at a job site no longer sees a "check billing" error. +6/−1 lines, +1 COPY key.
Directions/address fallback already exists via `ProjectNavigationActions` (copy destination works offline).

## Tests added
- `tests/lib/offline-time-events.test.ts` — pins the `/clock` queue (there was no unit test): queue write
  under `cc_offline_time_events`, read-back, accumulate distinct `client_event_id`s (clock-in then
  clock-out), remove/patch **by `client_event_id` only** (dedup identity), and event-time ascending sort
  for correct replay order. Exercises the public API only — **no schema/drain change**.
- `tests/lib/pwa-task5-offline-qa-source.test.ts` — source proofs for paths not otherwise covered:
  `/clock` queue + shell overlay + shell-only render; the offline auth-expired guard in
  `supabase/client.ts`; SW matchers `sameOrigin`-gated (Maps never cached) + directions purity + the
  offline map fallback.

## RED LINE compliance
- **Untouched:** `sw.ts` (git diff empty), the Task 2.1 guardrail test, SW registration/update code,
  the `cc_offline_*` queue **schemas and drain semantics** (tests use the public API only), manager
  pages, and api route logic. No RLS/api changes were needed (no gap required one).

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 943 passed (134 files; +14 across 2 new files)
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; built worker re-inspected: `precacheAndRoute`=0, `NavigationRoute`=0,
  `createHandlerBoundToURL`=0, nav/RSC guards present, `sameOrigin` gating present — Task 2.1 guardrail
  conditions hold.

## Minimal device checklist (owner — installed PWA, real device)
Everything above is verified in code/tests; these confirm the real-device offline reality:
1. Open the app online once (SW active). Go offline (airplane mode).
2. **/clock:** shift/project state still shows (from cache); tap clock-in → it shows "pending sync"
   (queued), no spinner-forever, no login bounce. Tap clock-out → also queued.
3. **/my-tasks:** cached task list shows with the "cached — saved at …" notice; claim/complete a task →
   queued (no error toast).
4. **/my-projects:** cached project list shows; open one → cached summary shows (or a clear
   "cached data unavailable", never a blank/crash).
5. **/project/:id:** cached detail shows, or the "cached unavailable" notice.
6. **Map (clock fence / project):** shows "Map unavailable while you're offline" — **not** an
   API-key/billing error; the "Copy destination / Go" navigation buttons still work (address copyable).
7. Reconnect → queued clock/task/upload work drains and syncs; still no false "session expired" bounce.

Not merged/pushed at time of writing.
