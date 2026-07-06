# PWA / Offline Boot Reconnaissance

Branch: `codex/agents-md`
Date: 2026-07-04
Scope: read-only research against this worktree after adding the standing `AGENTS.md` reply rule.

## Executive Recommendation

Use Serwist for the service worker, specifically the Turbopack-compatible integration path if this app keeps the default Next 16 dev/build pipeline. Do not use the old `next-pwa` package, and do not hand-roll the whole service worker beyond a very small registration/update UI layer.

Rationale:

- The app is Next 16.2.3 App Router on Vercel (`package.json`) and has no PWA dependency today.
- Next's own PWA guide covers manifest and manual service worker registration, including `updateViaCache: "none"` and no-store service-worker headers, and points to Serwist as an offline-support option.
- Serwist has current Next/Turbopack documentation for Next 15+ with generated precache manifests, route handler serving, `skipWaiting`, `clientsClaim`, `navigationPreload`, and runtime caching hooks.
- Old `next-pwa` is not a good default for this app: the commonly referenced `next-pwa` package is stale, and App Router HTML/RSC caching defaults are too risky around Supabase auth, worker RLS data, payroll, signed media URLs, and role-gated routes.
- A fully hand-rolled worker makes the highest-risk part of this feature - Next asset graph plus deploy invalidation - custom code. It is only reasonable if the scope is install prompt only, not offline route boot.

Important nuance: use Serwist for build-time asset discovery and cache plumbing, but keep runtime caching rules extremely narrow. This app should not become an offline data cache through the service worker. Existing localStorage queues and snapshots are the offline data layer.

Primary sources:

- Next PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Next manifest convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
- Serwist Next Turbopack guide: https://serwist.pages.dev/docs/next/turbo
- Serwist Next guide: https://serwist.pages.dev/docs/next/getting-started

## Codebase Facts Verified

- `package.json`: Next `16.2.3`, React `19.2.4`, Vercel-style app, no PWA/SW library installed.
- `next.config.ts`: injects `APP_BUILD_COMMIT_SHA`, `APP_BUILD_COMMIT_REF`, `APP_BUILD_TIME`, `APP_DEPLOY_ENV`, and `APP_DEPLOYMENT_URL`. These are the right version inputs for service-worker cache names and update prompts.
- `public/manifest.json`: exists with `name`, `short_name`, `start_url: "/"`, `display: "standalone"`, theme/background colors, and 192/512 icons. It does not currently declare maskable icon purpose.
- `src/app/layout.tsx`: metadata already points to `/manifest.json` and has Apple web app metadata.
- `src/proxy.ts`: Supabase session refresh and route protection run in Next 16 Proxy. It excludes `_next/static`, `_next/image`, `favicon.ico`, `manifest.json`, and file assets. Protected routes redirect to `/login` when no user is present.
- `src/app/(worker)/layout.tsx`: worker routes wrap children in `WorkerShell` and call `getWorkerShellBootstrapData()` on the server.
- Worker boot routes:
  - `/clock` -> `src/app/(worker)/clock/page.tsx` -> `ClockPage`.
  - `/my-tasks` -> `src/app/(worker)/my-tasks/page.tsx` -> `TasksPage`.
  - `/my-projects` -> `src/app/(worker)/my-projects/page.tsx` -> `WorkerProjectsList`.
  - `/project/[id]` -> `src/app/(worker)/project/[id]/page.tsx` -> server Supabase reads plus `WorkerProjectView`.
- `src/components/worker/WorkerShell.tsx`: already tracks online/offline state, refreshes `/api/worker/shell-data` with `cache: "no-store"`, shows offline/sync banners, queues actions, and drains queues when back online.
- Offline data already exists in localStorage:
  - `cc_offline_time_events` in `src/lib/offline-time-events.ts`: clock-in/out queue, deduped with `metadata.client_event_id`, drained through guarded worker API routes.
  - `cc_offline_field_actions` in `src/lib/offline-field-actions.ts`: `task_claim`, `task_status`, and `message_send` queue.
  - `cc_offline_uploads` in `src/lib/offline-uploads.ts`: media upload queue; files up to 10 MB stored as data URLs, larger files degrade to thumbnail/metadata and require re-pick.
  - `cc_offline_field_cache:v1` in `src/lib/offline-field-cache.ts`: snapshots for `worker-tasks`, `material-tasks`, `worker-projects`, `worker-project-detail`, `worker-task-detail`, and `worker-messages`; it scrubs keys matching token/secret/signed-url patterns.
- `src/components/worker/TasksPage.tsx`, `WorkerProjectsList.tsx`, `WorkerProjectView.tsx`, and `WorkerMessagesPage.tsx` already read/write offline snapshots.
- `src/lib/supabase/client.ts`: `authAwareFetch` dispatches `check-time:auth-expired` only for Supabase REST/storage 401/403 or anon-key fallback, and explicitly skips classification for auth endpoints, non-Supabase REST/storage, status `0`, and `navigator.onLine === false`.
- `src/app/providers.tsx`: listens for `check-time:auth-expired` and redirects to `/login?expired=1`.

## Library Choice

Recommendation: Serwist, not old `next-pwa`, not fully hand-rolled.

Use Serwist for:

- Build-time precache manifest generation for hashed `/_next/static/**` chunks, CSS, and font/media assets.
- Versioned cache names keyed by `APP_BUILD_COMMIT_SHA`.
- A typed service worker with explicit runtime routes.
- Navigation fallback routing for worker routes only.
- Standard lifecycle helpers such as `skipWaiting`, `clientsClaim`, and cleanup of old caches.

Use app code, not Serwist defaults, for:

- The update prompt and reload policy.
- Deciding when pending localStorage queues make automatic reload unsafe.
- Enforcing no service-worker caching for auth, Supabase, payroll, signed URLs, AI, media transcode, and API responses.

Avoid old `next-pwa` because:

- The app is on Next 16 App Router; stale packages tend to lag around RSC, route handlers, Turbopack, and Vercel behavior.
- This app must not accidentally cache authenticated HTML/RSC or API data.
- Any package that provides broad default runtime caching is a liability unless almost all runtime caching is disabled.

Avoid a fully hand-rolled worker because:

- The hard part is not writing `fetch` listeners; it is keeping Next build assets, dynamic App Router navigation, and deploy invalidation correct.
- The top operational risk is stale JS after deploy, and custom asset discovery would increase that risk.

## Precache Scope

First principle: the PWA should make the worker shell boot offline after a previous successful online visit. It should not make Supabase data or authenticated API responses available via service-worker cache.

Precache these asset classes:

- Generated Next static assets needed by the worker shell and selected pages: `/_next/static/**`, CSS, Next font files, and chunk files for `WorkerShell`, `ClockPage`, `TasksPage`, `WorkerProjectsList`, `WorkerProjectView`, `OfflineCacheNotice`, and shared worker components.
- Public PWA assets: `/manifest.json`, `/icon-192.png`, `/icon-512.png`, `/favicon.ico`.
- A dedicated offline worker boot document or route shell with no embedded user data, for example `/offline/worker-shell`.
- Minimal local UI assets required by the offline shell, including locally bundled fonts/icons already emitted into `/_next/static/**`.

Navigation route matchers that should be bootable offline:

- `/clock`
- `/my-tasks`
- `/my-projects`
- `/project/:id`

Recommended route-shell approach:

- Do not cache the authenticated server-rendered HTML/RSC payload for each worker page as the durable offline fallback.
- Instead, add a small worker offline boot route/shell in implementation that is safe to precache because it contains no Supabase rows, no cookies, and no signed URLs.
- When offline and the navigation request matches `/clock`, `/my-tasks`, `/my-projects`, or `/project/:id`, serve that offline boot shell. The client shell can read localStorage snapshots and queues, then render the requested screen or a cached-detail fallback.
- Preserve the intended URL so the crew still sees the expected path. Use history replacement or a query parameter inside the shell if needed.

Why this matters: `src/app/(worker)/layout.tsx` currently depends on server Supabase auth/bootstrap data. Direct offline navigation cannot run that server code, and caching that server response would cache user-specific worker data. A separate no-data boot shell avoids that tradeoff.

Must never be cached by the service worker:

- Any `/api/**` response, including `/api/worker/shell-data`, `/api/worker/clock-in`, `/api/worker/clock-out`, `/api/worker/claim-task`, `/api/worker/task-status`, `/api/media/transcode`, AI routes, geocode routes, payroll routes, and auth routes.
- Supabase Auth, REST, Realtime, and Storage traffic: `/auth/v1/**`, `/rest/v1/**`, `/storage/v1/**`.
- Any response containing RSC/flight data tied to cookies/session, including requests with `?_rsc=`, `RSC`, `Next-Router-State-Tree`, `Next-Url`, or `text/x-component`.
- Manager/owner/payroll/archive/admin route documents or data.
- Payroll data, labor rates, project cost/profit views, annual report data, audit data.
- Signed Supabase Storage URLs and Mux signed playback URLs. The repo has many `createSignedUrl(s)` calls with short expirations.
- Uploaded media bytes and previews fetched from signed URLs.
- Google Maps scripts, map tiles, directions URLs, geocoding responses, and external navigation pages.
- Provider/AI responses and voice/audio/transcode payloads.

Runtime network strategy:

- `NetworkOnly` for all `/api/**`, Supabase, signed URLs, and external providers.
- `CacheFirst` only for immutable build assets and public static PWA assets.
- Navigation fallback only for the explicit worker offline route set, only while offline or after network failure, and only to the no-data offline worker boot shell.

## Update And Invalidation Strategy

This is the top operational risk. A deploy must not leave crews running stale JS in the installed PWA.

Use the existing build metadata:

- Cache names should include `APP_BUILD_COMMIT_SHA`.
- The service worker should expose its build/version to controlled clients.
- The client should compare the active SW version to `APP_BUILD_COMMIT_SHA` from the loaded app.

Registration:

- Register the service worker with `scope: "/"`.
- Use `updateViaCache: "none"` so the browser does not reuse an old worker script from HTTP cache.
- Serve the worker script with `Content-Type: application/javascript; charset=utf-8`.
- Serve the worker script with `Cache-Control: no-cache, no-store, must-revalidate`.

Lifecycle:

- Use `skipWaiting` and `clients.claim` so new workers can activate promptly.
- Pair activation with an in-app update prompt. `clients.claim` makes the new worker control pages, but old JS remains in memory until reload.
- Do not silently reload while a worker is entering a shift, uploading media, or draining queued actions.

Recommended UX:

- When a new SW is installed, show a persistent update banner in `WorkerShell`.
- If all local queues are empty, allow a one-tap "Update app" that reloads immediately; optionally auto-reload on next idle/focus.
- If any of these are non-empty, do not auto-reload: `cc_offline_time_events`, `cc_offline_field_actions`, `cc_offline_uploads`.
- For pending queues, show "Update available after sync" or allow manual update with clear copy that unsynced work is still stored locally.

Stale-JS prevention hooks:

- Call `registration.update()` on app start, `online`, `focus`, and `visibilitychange` to visible.
- Consider a low-frequency interval while the app is open, for example every 15 minutes, only when visible.
- On SW activate, delete old `ct-app-${oldCommit}` caches but never touch localStorage queues/snapshots.
- For Vercel deploy smoke, include an installed-PWA check: load old build, deploy new build, return to app, confirm update banner and successful reload to new `APP_BUILD_COMMIT_SHA`.

## Interaction Map

Offline boot flow:

1. The crew member must have visited the worker app online at least once after the PWA feature ships.
2. Online visits populate localStorage snapshots via `saveOfflineSnapshot()`:
   - `worker-tasks`
   - `material-tasks`
   - `worker-projects`
   - `worker-project-detail`
   - `worker-task-detail`
   - `worker-messages`
3. The service worker precaches the no-data worker boot shell and static chunks.
4. The crew opens `/clock`, `/my-tasks`, `/my-projects`, or `/project/:id` offline.
5. The service worker serves the offline boot shell and static assets.
6. Client code reads localStorage snapshots and queues, then renders cached worker state with existing offline notices.
7. Network data calls fail normally; they are not fulfilled from service-worker cache.

Existing queues:

- Clock-in/out:
  - Online path posts to `/api/worker/clock-in` or `/api/worker/clock-out`.
  - Offline/network-failed path queues in `cc_offline_time_events`.
  - Drain sorts by event time and replays through guarded worker API routes.
  - Dedup uses `metadata.client_event_id`.
- Field actions:
  - `task_claim`, `task_status`, and `message_send` queue in `cc_offline_field_actions`.
  - Drain replays through worker API routes or Supabase inserts, with retry/failure status.
- Uploads:
  - `cc_offline_uploads` stores small files as data URLs and large files as thumbnail-only placeholders.
  - Drain uploads to Supabase Storage, inserts media rows, and kicks `/api/media/transcode` for queued videos.
- Snapshots:
  - `cc_offline_field_cache:v1` provides offline read surfaces.
  - Secret-looking fields are scrubbed, including token/secret/signed-url/public-url keys.

Auth-aware fetch interaction:

- `authAwareFetch` already avoids false session-expiry redirects when `navigator.onLine === false` or response status is `0`.
- The service worker must preserve that model by failing network data requests offline, not returning cached 401/403/HTML/API responses.
- `Providers` listens for `check-time:auth-expired` and redirects to `/login?expired=1`, so false positives would be disruptive in the field.

Supabase token refresh interaction:

- Supabase token refresh cannot happen while fully offline.
- If the session is still valid in browser storage/cookies, the app can render cached shell data while offline.
- If the token expires during offline use, queued work must remain in localStorage and the UI must not redirect just because refresh failed offline.
- On reconnect, allow Supabase refresh/first authenticated request to run. If it fails with a real online 401/403, the existing auth-expired path should send the user to login.
- Queues must survive login and drain after reauth. Do not clear localStorage queues on auth-expired redirect.

Proxy/session interaction:

- `src/proxy.ts` refreshes Supabase session cookies on server requests when online.
- Offline navigation fallback bypasses the network and therefore bypasses Proxy. That is acceptable only because the fallback shell contains no protected data; protected data comes from same-device localStorage snapshots already created by a prior authenticated session.

## Android Install Path

Current state:

- `public/manifest.json` exists and is linked from `src/app/layout.tsx`.
- Icons exist at `/icon-192.png` and `/icon-512.png`.
- Apple web app metadata exists.

Recommended manifest updates:

- Consider `start_url: "/clock"` or `"/clock?source=pwa"` for worker install flow. If managers also install the app, keep `/` role-aware but add a worker-only install prompt that explains it opens the clock.
- Set `scope: "/"`.
- Keep `display: "standalone"`.
- Add maskable icons or add `"purpose": "any maskable"` if the existing assets are visually safe inside Android adaptive icon masks.
- Keep theme/background colors aligned with the current dark shell.

Android install prompt:

- Add a small client component mounted in the worker shell or clock route.
- Listen for `beforeinstallprompt`.
- Store the event, show an "Install app" action only to worker/crew users and only after login.
- On tap, call `prompt()` and inspect `userChoice`.
- Hide permanently after accepted, and throttle after dismissal.
- Listen for `appinstalled` to record dismissal/accepted state in localStorage.

iOS caveats:

- Safari iOS does not support the same `beforeinstallprompt` flow.
- Use a short manual instruction path: Share -> Add to Home Screen.
- Treat iOS offline storage as best-effort; quotas and eviction are stricter than Android Chrome.
- Do not depend on Background Sync for queue drain; the existing foreground `online` listener/drain model is safer across iOS and Android.

## Ordered Implementation Breakdown

Task 1: Manifest and install prompt hardening

- Update manifest fields/icons for install quality.
- Add worker-only install prompt for Android.
- Add iOS install hint.
- No service-worker caching yet.
- Gates: typecheck, lint, unit tests, mobile manual install smoke.

Task 2: Serwist skeleton and service-worker registration

- Add Serwist dependency and Next 16/Turbopack-compatible config.
- Register service worker from a small client component.
- Add no-store headers for SW route/script.
- Expose SW build version using `APP_BUILD_COMMIT_SHA`.
- Runtime caching still disabled except static build/public assets.

Task 3: Update prompt and stale-JS prevention

- Add version comparison and `registration.update()` hooks on start/focus/online/visible.
- Add `WorkerShell` update banner.
- Block auto-reload while localStorage queues are non-empty.
- Delete old versioned caches on activate.
- Add tests for version-state logic where practical.

Task 4: Offline worker boot shell

- Add a no-data offline boot route/shell safe to precache.
- Add Serwist navigation fallback only for `/clock`, `/my-tasks`, `/my-projects`, and `/project/:id`.
- Do not cache authed route HTML/RSC.
- Client boot reads localStorage profile/snapshot metadata enough to render WorkerShell offline.
- Confirm direct offline launch does not hit `/login` or show a blank page.

Task 5: Worker surfaces offline QA

- Verify `/clock` renders cached shift/project state and can queue clock-in/out.
- Verify `/my-tasks` renders `worker-tasks` cache and queues task actions.
- Verify `/my-projects` renders `worker-projects` cache.
- Verify `/project/:id` renders cached project detail or a clear cached-empty state.
- Verify maps/directions degrade gracefully; no attempt to cache Google Maps.

Task 6: Queue reconnect and auth-expiry hardening

- Confirm queued shifts/actions/uploads survive app reload, SW update, and auth-expired redirect.
- Ensure online reconnect drains only after auth is valid.
- Confirm offline network failures do not dispatch `check-time:auth-expired`.
- Confirm real online expired sessions still redirect to `/login?expired=1`.

Task 7: Deploy smoke and field checklist

- Add smoke procedure for installed PWA update across Vercel deploy.
- Check old build -> deploy -> update banner -> reload -> new build stamp.
- Android Chrome standalone QA.
- iOS Add to Home Screen QA.
- Document owner/crew rollout notes.

## Suggested Acceptance Gates

- `npx tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run smoke:core`
- Manual Android Chrome:
  - Install from `/clock`.
  - Open installed app online.
  - Go offline.
  - Kill app.
  - Reopen installed app to `/clock`.
  - Queue a clock event.
  - Restore network.
  - Confirm sync.
- Manual stale deploy check:
  - Install PWA on build A.
  - Deploy build B.
  - Focus installed app.
  - Confirm update prompt and reload to build B.

## Main Risks

1. Stale JS after deploy. Mitigation: no-store SW script, `updateViaCache: "none"`, commit-based cache names, update prompt, and explicit smoke.
2. Accidental caching of authenticated data. Mitigation: no runtime caching for `/api/**`, Supabase, RSC/flight, signed URLs, manager/payroll/admin routes.
3. Offline direct navigation blank screen. Mitigation: dedicated no-data offline worker boot shell, not cached protected HTML.
4. Expired token while offline. Mitigation: keep offline UI local, preserve queues, reauth on reconnect if needed.
5. Android/iOS behavioral differences. Mitigation: Android install prompt, iOS manual install hint, no dependency on background sync.

## Bottom Line

Build the PWA as an offline boot and update-delivery layer, not as a network data cache. Serwist should own precache/version plumbing; the existing localStorage snapshots and queues should remain the source of offline data. The implementation should start with install/update mechanics, then add a no-data worker fallback shell for `/clock`, `/my-tasks`, `/my-projects`, and `/project/:id`, with strict network-only rules for everything authenticated or signed.
