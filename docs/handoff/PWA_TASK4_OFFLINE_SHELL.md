# PWA Task 4 — offline boot shell

**Branch:** `feature/pwa-task4-offline-shell` (stacked on `fix/pwa-task21-sw-navigation`)
**Recon:** `docs/handoff/PWA_RECON.md` landed via merge of `codex/agents-md` (flagged "merge during Task 2.1").

> Still parked — do NOT merge/push/deploy. Task 5-7 not in scope.

## The constraint that reshaped the plan
The recon's Task 4 said "add a Serwist **navigation fallback** for `/clock`, `/my-tasks`, …". **Task 2.1
forbids the SW from ever handling navigations or RSC** (that was the reverted-release bug), and its
guardrail test enforces it. So the offline shell is **app-level**, not a SW navigation fallback. The
service worker (`src/app/sw.ts`) is **untouched**; the guardrail test stays green.

## Design (app-level, no SW navigation handling)
- **`OfflineShell`** (`src/components/pwa/OfflineShell.tsx`) — a self-contained, network-free shell:
  Check-Time chrome + a clear offline banner + the device's queued offline work (clock in/out, field
  actions, uploads) read from the `cc_offline_*` localStorage queues. It only **reads** the queues
  (via the existing loaders) and never mutates them. Queue reads go through `useSyncExternalStore`
  (SSR-safe, no localStorage on the server; lint-clean, no set-state-in-effect).
- **`/offline`** (`src/app/offline/page.tsx`) — a `force-static`, data-free route that renders
  `OfflineShell`. Being static + data-free, it prerenders to a plain document that the **browser HTTP
  cache** can serve offline (see reach, below). Added to the proxy `PUBLIC_PATHS` so it's reachable
  without a session (like `/login`).
- **`OfflineBoot`** (`src/components/pwa/OfflineBoot.tsx`, mounted in `providers.tsx`) — while online
  and once the SW is active, fire-and-forget `fetch("/offline")` to **warm the browser HTTP cache**
  with the shell document. Production-only. This is the reach mechanism that does **not** touch the SW.
- **`next.config` header** — `/offline` gets `Cache-Control: public, max-age=86400,
  stale-while-revalidate=604800` so the warmed document survives in the HTTP cache for offline use; a
  new deploy re-warms it on the next online visit.
- **`(worker)/error.tsx`** — the existing worker error boundary now renders `OfflineShell` when
  `navigator.onLine === false` (via `useSyncExternalStore`), so a worker route that fails **because**
  the device is offline shows the shell + queued work instead of the generic "check connection" error.

New i18n keys `offline.*` (ru + en). SW chunks for the shell are already covered by the SW's
`/_next/static` CacheFirst (Task 2.1), so the shell's JS renders from cache offline.

## Reachability matrix (honest about what the guardrail allows)
| Scenario | Result |
|---|---|
| Worker route render fails while offline (server reachable-but-erroring, or an error thrown offline) | ✅ `(worker)/error.tsx` → `OfflineShell` |
| App already open, worker is on a worker route, goes offline | ✅ existing `WorkerShell` offline UI (banner + queued events) — unchanged |
| Navigate to `/offline` (any time) | ✅ the shell |
| `/offline` opened while offline, after an online visit warmed the HTTP cache | ✅ browser serves it from HTTP cache (SW does not intercept the navigation) |
| **Cold-launch the installed PWA at `start_url:"/"` while fully offline** | ⚠️ **still fails** (browser error) — see below |

### The cold-launch gap (documented limitation, not an oversight)
`start_url` is `/`, which the server **redirects by role** — a redirect can't be HTTP-cached, and the
document request can't be served offline without the **SW handling the navigation**, which Task 2.1
forbids (and the guardrail blocks). So a true "tap the icon while offline from a cold start" still
shows the browser's offline page. Closing that fully needs one of (future task, out of scope tonight):
(a) a narrowly-scoped, guardrail-compatible SW rule that serves **only** a single static
`/offline` document for `mode:"navigate"` requests to that exact URL (would require revisiting the
guardrail with care), or (b) changing `start_url` to a static offline-capable landing that
client-routes when online. Tonight delivers the shell, its caching, and every reach that does **not**
require the SW to serve a navigation.

## Files
- New: `src/components/pwa/OfflineShell.tsx`, `src/components/pwa/OfflineBoot.tsx`,
  `src/app/offline/page.tsx`, `docs/handoff/PWA_RECON.md` (via merge).
- Changed: `src/app/providers.tsx` (mount OfflineBoot), `src/app/(worker)/error.tsx` (offline-aware),
  `src/proxy.ts` (+`/offline` public), `next.config.ts` (+`/offline` cache header),
  `src/lib/i18n/translations.ts` (+`offline.*`).
- **Untouched:** `sw.ts`, WorkerShell, `cc_offline_*` internals / `offline-uploads.ts` (read-only via
  loaders), and all Codex-owned files (WorkerProjectView, `(worker)/project/[id]/page`,
  ProjectDetailPage, `media-payload*`).

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 929 passed (131 files); Task 2.1 SW guardrail test green (3/3), `sw.ts` unchanged
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; `/offline` prerenders **static (`○`)**; generated worker re-inspected:
  `precacheAndRoute`=0, `NavigationRoute`=0, `createHandlerBoundToURL`=0, nav/RSC guard present — the
  Task 2.1 guardrail conditions still hold.

## Suggested device smoke (before any release)
1. Install PWA, open online once (SW activates; `OfflineBoot` warms `/offline`).
2. Go offline. On a worker route that refetches, confirm `WorkerShell` still shows its offline banner +
   queued events (unchanged).
3. Navigate to `/offline` offline → shell renders from HTTP cache; queued events listed; DevTools
   Network shows the `/offline` document served **from (disk cache)**, not `(ServiceWorker)`.
4. Confirm RSC/navigations are still never served by the SW (Task 2.1 smoke).
5. Note the cold-launch gap above.

Not merged/pushed at time of writing.
