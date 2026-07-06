# PWA Task 2.1 — service worker navigation-safety fix

**Branch:** `fix/pwa-task21-sw-navigation` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `2b62ed3`, the revert)
**Why:** the first PWA release was reverted from prod today (`2b62ed3`) because the SW strangled
client-side SPA navigation — menu clicks took 5-23s while direct URL loads stayed fast.

> Still parked. Do NOT merge/push/deploy. This makes the SW safe to *re-release* with Task 3; the
> mandatory device smoke below must pass first.

## Branch setup (re-applying PWA on top of the revert)
`origin/claude/...` is at `2b62ed3`, which reverted the PWA merge (`142a421`). Because the PWA branch
is already an *ancestor* of that revert, a plain rebase would be a no-op (it would just fast-forward to
the revert and drop the files). So I **reverted the revert** — `git revert 2b62ed3` — which re-applies
Task 2+3 verbatim on top of the current base (streaming/hygiene work included). That was clean (no
conflicts; commit `Reapply "merge: PWA Task 2+3"`). The Task 2.1 fix sits on top of it.

## Root cause (diagnosed from the generated worker, not guessed)
Built the reverted SW and inspected `.next/server/app/serwist/sw.js.body`:
1. The router only `respondWith`s on a route match (`s && e.respondWith(s)`), so interception came
   from a **matcher**, not a blanket handler.
2. The worker's only navigation guard was `request.destination !== "document"`. **RSC soft-navigation
   fetches are not `document`** — their `destination` is `""` and `mode` is `cors`/`same-origin` — so
   that guard did **not** exclude RSC/flight traffic.
3. Serwist's `PrecacheRoute` registered with Workbox navigation URL heuristics `cleanURLs:true` +
   `directoryIndex:"index.html"`, which evaluate navigation/RSC URLs against the (build-dependent)
   precache manifest. Any navigable/flight entry landing in that glob-built manifest makes the SW
   `respondWith` soft-nav RSC and buffer Next's **streamed** flight payload → SPA navigation serialized
   behind the worker, hence 5-23s soft-nav vs. fast direct document loads (a different code path).

**In two lines:** the SW's navigation exclusion (`destination !== "document"`) missed RSC, and its
precache route carried navigation heuristics — so navigation/RSC requests were processed by SW routing
and their streamed responses buffered, instead of being ignored outright.

## The fix (`src/app/sw.ts`)
1. **Removed precache entirely.** No `precacheEntries` → no `PrecacheRoute` → no
   `cleanURLs`/`directoryIndex` navigation heuristics, and interception is now *strictly*
   `/_next/static/**` + the named PWA assets (the old glob also precached `vercel.svg`, `next.svg`,
   etc. — gone). The two `CacheFirst` routes cache `/_next/static/**` and `manifest.json`/icons/favicon
   on first fetch instead; versioned per-SHA cache names keep this safe across deploys.
2. **Comprehensive navigation + RSC predicate** `isNavigationOrRscRequest(request, url)` covering
   `mode==="navigate"`, `destination==="document"`, the `RSC` / `Next-Router-State-Tree` / `Next-Url`
   headers, the `?_rsc=` param, and `Accept: text/x-component`.
3. **Every runtime matcher requires `!isNavigationOrRscRequest(...)`.** No catch-all, no default
   handler, no `fallbacks`, no `NavigationRoute`. So the router never matches a navigation/RSC request
   → never `respondWith`s it → browser-native, streaming preserved.

**Update-delivery (Task 3) untouched and still works:** it relies on the `GET_SW_VERSION` postMessage +
`registration.update()` + `activate` cache cleanup — none of which depend on intercepting navigations.
All of that is retained.

## Build-inspection evidence (generated worker)
- `precacheAndRoute` = **0**; the internal `addToPrecacheList(e)` is guarded by `e && e.length>0` and
  `e` (the precache list) is now absent → never called. **Zero** `url:"/_next"` / `/manifest` / `/icon`
  manifest entries embedded. (`directoryIndex`/`cleanURLs` appear only as dead, unregistered library
  code.)
- Both runtime matchers present with the guard inlined: `pathname.startsWith("/_next/static/")` and the
  `manifest.json|icon-…|favicon.ico` regex, each gated by the nav/RSC predicate.
- Guard strings present in the worker: `Next-Router-State-Tree`, `Next-Url`, `RSC`, `text/x-component`,
  `_rsc`.

## Guardrail test
`tests/lib/pwa-sw-navigation-guard.test.ts` — source-level; **fails if `sw.ts` ever** loses the nav/RSC
predicate, fails to apply it to every runtime matcher, or reintroduces precache / a
navigation-serving handler (`fallbacks`, `NavigationRoute`, `setDefaultHandler`, `setCatchHandler`,
`defaultCache`). The Task 2 plumbing test was updated to drop the now-removed `self.__SW_MANIFEST`
assertion.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 929 passed (131 files; +1 guardrail file)
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; generated worker inspected (above): no navigation/RSC handlers, no
  precache route.

## ⚠️ Mandatory re-release smoke (device / real deploy — do BEFORE re-releasing with Task 3)
The regression only reproduces with the SW **active** on **soft** (SPA) navigation — a direct URL load
will look fine even if broken. So:
1. Deploy; open the app online once so the SW installs/activates (DevTools → Application → Service
   Workers shows it "activated and running").
2. DevTools → Network: filter to `Fetch/XHR`. Click a **sidebar menu item** (SPA soft-nav, e.g.
   Overview → Projects → Team → Tasks — *not* a full reload). For each RSC request (`?_rsc=`, type
   `text/x-component`) confirm it is served **from network**, and the **Size** column does **not** say
   `(ServiceWorker)` — i.e. the SW did not `respondWith` it.
3. Performance panel (or eyeball): a **warm** SPA menu click should complete in **< 1.5s** (vs. the
   5-23s regression). Test several menu items, warm and after a hard refresh.
4. Control: unregister the SW and repeat step 3 — times should match (SW adds no navigation latency).
5. Confirm `/_next/static/**` chunk requests *are* served by the SW (Size `(ServiceWorker)`) — that's
   the only interception we want.
6. Two-deploy check still applies for Task 3 (update banner / queue-gated reload / old-cache cleanup).

Only after step 2-4 pass on a real device is the SW safe to re-release (together with Task 3).

Not merged/pushed at time of writing.

---
Build B trigger for update-banner verification: 2026-07-06T08:34:44.4849253-07:00
Build C trigger for banner verification (build B observer in place): 2026-07-06T08:42:04.2195348-07:00
