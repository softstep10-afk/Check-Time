# Deploy smoke — post-deploy checklist

Run this **after every production deploy**. It exists because two failures here have been real and
expensive: a service worker that made **SPA navigation** 5–23s while **direct URL loads stayed fast**
(they break independently — see `docs/handoff/PWA_TASK21_SW_FIX.md`), and stale-JS after deploy. Keep
it short; do the steps in order.

`PROD` below = the production URL (e.g. `https://check-time-five.vercel.app`).

---

## 0. Automated pre-check (30s, no browser)
```
PRODUCTION_URL=<PROD> npm run smoke:deploy
```
Confirms (unauthenticated): app is up, the SW script is served `no-store` with a build SHA, the
`/offline` shell is reachable, and the manifest is served. To assert the deploy actually took, pass the
new commit sha: `EXPECTED_SHA=<sha> PRODUCTION_URL=<PROD> npm run smoke:deploy`.
**This does not replace the browser steps below** — it can't see SPA navigation, auth, or install.

## 1. Both load paths (MANDATORY after any deploy touching SW / caching / region / infra)
They break independently — check **both**:
- [ ] **Direct URL load:** open `PROD/overview` fresh (or hard-refresh) → renders fast (< ~1.5s TTFB-ish).
- [ ] **SPA menu click:** from a loaded page, click a sidebar item (Overview → Projects → Team → Tasks).
      Each transition < ~1.5s warm.
- [ ] **DevTools → Network, filter Fetch/XHR:** during an SPA menu click, the RSC request (`?_rsc=`, type
      `text/x-component`) is served **from network** — the Size column must **not** say `(ServiceWorker)`.
- [ ] `/_next/static/**` chunks **may** show `(ServiceWorker)` — that's the only interception we want.

> If SPA clicks are slow but direct loads are fine → the SW is intercepting navigations/RSC again.
> Stop, do not roll out; see `PWA_TASK21_SW_FIX.md` and the `pwa-sw-navigation-guard` test.

## 2. Installed-PWA update path (Task 3)
On a device/desktop that already has the app **installed from the previous build**:
- [ ] Open the installed app (old build) while online.
- [ ] Focus it (or wait an update tick) → the **update banner** appears ("A new version is available").
- [ ] With **no queued offline work**: tap **Update now** → it reloads.
- [ ] After reload, confirm the running build changed: the served SW SHA now matches the new deploy
      (`npm run smoke:deploy` prints it; or Admin → Diagnostics shows `APP_BUILD_COMMIT_SHA`).
- [ ] With **queued work present** (e.g. a pending clock event): the banner shows "held for sync" and does
      **not** reload — queued work is never dropped by an update.

## 3. Worker path spot check (real login)
- [ ] Log in as a worker → `PROD/clock` loads (shift/project state renders).
- [ ] Clock in → the event reaches the server (a `time_events` row appears; the pending badge clears).
- [ ] Supabase logs: no new errors around the deploy time (project `vlrajjwbaxikbwvqdpft`).

## 4. Android Chrome standalone QA (short)
- [ ] Chrome → open `PROD` → menu → **Install app** (or the in-app "Установить приложение" prompt).
- [ ] Launch from the home-screen icon → opens **standalone** (no browser chrome), correct icon/name.
- [ ] Repeat step 1 (both load paths) and step 2 (update path) inside the installed app.
- [ ] Go offline (airplane mode) → `/offline` / cached worker surfaces render (no dino); reconnect → syncs.

## 5. iOS Add to Home Screen QA (short)
- [ ] Safari → open `PROD` → the iOS install hint shows (Share → **Add to Home Screen**).
- [ ] Add it → launch from the icon → opens standalone, correct icon/name/status bar.
- [ ] Basic worker flow works; offline shows the offline shell, not a Safari error page.
- [ ] (iOS storage is best-effort — don't rely on background sync; foreground reconnect drains queues.)

## 6. Crew rollout notes (plain language, for the owner)
Tell the crew, or just know what they'll see on the **next open after a deploy**:
- The app shows a small **"A new version is available"** banner. Tapping **Update now** reloads to the
  new version. It's safe to tap.
- If they have **unsynced work** (a clock in/out or photo saved while offline), the app will **not**
  auto-reload — it says the update is "held until your saved work has synced". Their queued work is never
  lost by an update.
- If they're **offline**, saved clock-ins/outs and photos stay on the phone and **sync automatically**
  when they get signal — no action needed, and no "session expired" bounce on reconnect.

---
Related: pre-deploy gates are `npm run smoke:core` + `npm run alpha7:predeploy`; this file is the
**post**-deploy check. Lessons encoded from `PWA_TASK21_SW_FIX.md`, `PWA_RECON.md`, and the perf handoffs.
