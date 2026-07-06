# PWA Task 3 — update-delivery mechanism

**Branch:** `feature/pwa-task2-serwist` (Task 3 stacked on the rebased Task 2 commits)
**Scope:** the update-delivery layer that makes the Task 2 service worker safe to ship — version
detection, `update()` polling, an in-app update banner, and previous-deploy cache cleanup. Source:
`docs/handoff/PWA_RECON.md` "Task 3" + "Update And Invalidation Strategy".

> Ships together with Task 2 as one deploy. No offline navigation fallback here (Task 4).

---

## Detection signal — why version-compare, not `waiting`
Task 2's worker uses `skipWaiting:true` + `clientsClaim`, so a new worker **activates immediately**
and takes control while the tab still runs the old JS (the recon's "old JS remains in memory until
reload"). There is normally no lingering `registration.waiting`. So the reliable "update available"
signal is a **build-SHA mismatch**: the worker reports its SHA via `GET_SW_VERSION` (Task 2); the
client compares it to the loaded app's `APP_BUILD_COMMIT_SHA`. Differ → a newer deploy is live.
`waiting`/`installing`/`controllerchange` are all still covered so detection is robust either way.

## What was added
| File | Purpose |
|---|---|
| `src/lib/pwa-update.ts` | pure helpers: `isNewerSwVersion(swVer,appVer)`, `hasPendingOfflineWork({...})` (unit-tested) |
| `src/lib/hooks/usePwaUpdate.ts` | reads the existing registration, polls `update()`, compares SHAs, returns sticky `updateAvailable` |
| `src/app/sw.ts` | `activate` handler deletes previous-deploy caches |
| `src/components/worker/WorkerShell.tsx` | the update banner (hook call + one derived flag + one JSX block) |
| `src/lib/i18n/translations.ts` | `pwa.updateAvailable`, `pwa.updateAction`, `pwa.updateHeldForSync` (ru+en) |

## Version comparison + `update()` polling (`usePwaUpdate`)
- Reads `process.env.APP_BUILD_COMMIT_SHA` (inlined by `next.config` `env`) as the loaded-app SHA.
- Gets the **existing** registration via `navigator.serviceWorker.ready` — it never re-registers
  (that stays in `ServiceWorkerRegistration`) and never reloads.
- Calls `registration.update()` on **app start**, and on window `online`, window `focus`, and
  `document` `visibilitychange`→visible. A `MIN_UPDATE_CHECK_INTERVAL_MS` (8s) throttle avoids the
  double-fire when `focus`+`visibilitychange` both hit on a tab switch.
- After each check (and on `controllerchange` / `updatefound`→`statechange`), queries the newest
  worker's SHA over a `MessageChannel` and sets a **sticky** `updateAvailable` when
  `isNewerSwVersion` is true. Missing/empty SHA never flags (no false positives).
- Production-gated (no worker in dev).

## Update banner (WorkerShell)
Rendered in the existing header banner stack, only when `updateAvailable`:
- **All queues empty** → "A new version is available." + a one-tap **"Update now"** button that
  `window.location.reload()`s (the new worker already controls the page, so a reload loads new JS).
- **Any queue non-empty** → "Update ready — it will apply once your saved work has synced." and
  **no reload button**. Never auto-reloads mid-sync.
- Pending-work is read from the existing WorkerShell state — the raw lengths of `offlineEventQueue`
  (`cc_offline_time_events`), `offlineActionQueue` (`cc_offline_field_actions`), and `offlineQueue`
  (`cc_offline_uploads`) — via `hasPendingOfflineWork`. Raw lengths by design: a failed/retrying item
  is still unsynced work. As queues drain the banner flips to the reloadable state on the next render.

## Previous-deploy cache cleanup (`sw.ts` `activate`)
```
keys.filter(k => k.startsWith("ct-app-") && !k.startsWith(`${CACHE_PREFIX}-`)).map(caches.delete)
```
Deletes caches from older deploys (`ct-app-<oldsha>-*`) while keeping this build's
`ct-app-<sha>-{precache,static,assets}`. **Cache Storage API only** — it never reads or clears
`localStorage`, so the offline queues (`cc_offline_*`) and field-cache snapshots are untouched. Runs
alongside Serwist's own `activate` listener (`clientsClaim` + precache pruning); worker listeners are
additive. **Verified in the built worker** (`caches.keys`/`caches.delete`/`ct-app-` present).

## RED LINE compliance
- WorkerShell change is purely additive: 2 imports, 1 hook call, 1 derived flag (reads existing
  state), 1 banner block. **No drain/offline/sync logic touched** — the existing queue banners and
  `drainOfflineQueue` are unchanged.
- No auto-reload anywhere; the only reload is a user tap, and only when queues are empty.
- SW cache cleanup never touches localStorage. No offline nav fallback (Task 4).

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (none new)
- `npm test` — 920 passed (129 files); +9 in `tests/lib/pwa-update.test.ts`
- `npm run smoke:core` — no failures, no warnings
- **Extra (not a gate):** `npm run build` succeeds; the `activate` cleanup compiled into the worker.

## ⚠️ Live-device check needed before the Task 2+3 deploy
The whole flow is **production-only** (the worker is prod-gated) and the mismatch→banner→reload loop
can only be exercised **across two real deploys**. Recommend the recon's installed-PWA smoke on a
device before/at ship:
1. Install the PWA on build A (Android Chrome standalone).
2. Deploy build B.
3. Focus the installed app → confirm the **"A new version is available."** banner appears.
4. With no queued work → tap **Update now** → confirm reload lands on build B (new
   `APP_BUILD_COMMIT_SHA`).
5. With a queued clock event/upload → confirm the banner shows **held-for-sync** and does **not**
   reload; after sync drains, confirm it flips to the reloadable state.
6. Confirm old `ct-app-<A>-*` caches are gone after B activates and the `cc_offline_*` queues survive.

Not merged/pushed at time of writing.
