# PWA Task 7 — deploy smoke procedure + field checklist

**Branch:** `feature/pwa-task7-deploy-smoke` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `dcdfad3`)
**Type:** docs + one small optional script. **No app behavior change.** Not merged/pushed.

## Deliverables
1. **`docs/DEPLOY_SMOKE.md`** — the canonical post-deploy checklist (actionable, not an essay). Encodes
   the repo's hard-won lessons:
   - **Both load paths, always** — a direct URL load and an **SPA menu click** break *independently*
     (the reverted SW made SPA nav 5–23s while direct loads stayed fast — `PWA_TASK21_SW_FIX.md`). The
     check includes verifying the RSC request (`?_rsc=`, `text/x-component`) is served **from network,
     not `(ServiceWorker)`**.
   - **Installed-PWA update path** (Task 3): old build → deploy → focus → update banner → **Update now**
     → reload → new `APP_BUILD_COMMIT_SHA` confirmed; and the **queue-gated** behavior (won't auto-reload
     with pending offline work).
   - **Worker spot check**: `/clock` loads, clock-in reaches the server, Supabase logs clean.
   - **Android Chrome standalone QA** + **iOS Add to Home Screen QA** (short).
   - **Crew rollout notes** in plain language (update banner, queue protection, offline sync — no
     "session expired" bounce on reconnect).
2. **`scripts/deploy-smoke.mjs` + `npm run smoke:deploy`** — added (see decision below).

## Script decision: ADDED (cheap, reliable, validated)
I added it because a genuinely useful, browser-free, dep-free check turned out to be feasible. It uses
global `fetch` (Node 18+, same as the other smoke scripts) and the existing `PRODUCTION_URL` convention —
**no new deps, no browser automation**.

**What it checks (all unauthenticated):**
- `/serwist/sw.js` → 200, `Cache-Control: no-store`, `Content-Type: application/javascript`, contains the
  `ct-app-` versioned cache prefix, and embeds a 40-hex **build SHA** (printed). This is the reliable
  build-stamp probe — the SW route bypasses the auth proxy (`.js` extension) and is public.
- `/offline` → 200 (the Task 4 offline shell is reachable).
- `/manifest.json` → 200 and `display: "standalone"`.
- `/` → responds (redirect or 200, **not** 5xx) — the app is up.
- Optional deploy-took assertions: `EXPECTED_SHA=<sha>` (served SHA must equal it) and/or `PREV_SHA=<sha>`
  (served SHA must differ).

**Validated against live prod** (read-only GETs): `PRODUCTION_URL=… npm run smoke:deploy` → **8/8 passed**,
and the extracted SHA matched the deployed commit — so the probe is accurate.

**What it deliberately does NOT do** (and why the doc's browser steps remain mandatory): it cannot see
**SPA navigation** (the exact thing that broke — needs DevTools Network on a menu click), **auth** (`/clock`
and `/api/keepalive` are proxy-gated → they redirect to `/login` for a headless script, so asserting 200
there would be misleading), or **install/standalone/update-banner** (device-only). The script's own output
says as much and points back to `docs/DEPLOY_SMOKE.md`.

## Files changed (point diff)
- New: `docs/DEPLOY_SMOKE.md`, `scripts/deploy-smoke.mjs`.
- Changed: `package.json` (+1 script line, `smoke:deploy`).
- No source/app code touched.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (the script lints clean)
- `npm test` — 954 passed
- `npm run smoke:core` — no failures, no warnings
- (Bonus) `npm run smoke:deploy` against prod — 8/8 passed

Not merged/pushed at time of writing.
