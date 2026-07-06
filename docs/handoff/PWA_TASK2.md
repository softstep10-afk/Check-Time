# PWA Task 2 — Serwist skeleton + service-worker registration

**Branch:** `feature/pwa-task2-serwist` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** SW library + registration plumbing ONLY. No offline boot shell (Task 4), no update
banner / version-compare / auto-reload (Task 3). Source: `docs/handoff/PWA_RECON.md` "Task 2" +
"Update And Invalidation Strategy".

> ⚠️ **Do not merge/deploy alone.** A live service worker must not reach the crew without the
> update-delivery mechanism. Ship Task 2 + Task 3 together. (Registration is also production-gated,
> so nothing activates in dev; see below.)

---

## Library choice
**`@serwist/turbopack`** (+ `serwist`, `esbuild`), added as devDependencies. Rationale:
- Next 16.2.3 builds with **Turbopack by default**; the classic `@serwist/next` integration is a
  **webpack plugin** and would not run under Turbopack (its `__SW_MANIFEST` never gets injected).
- `@serwist/turbopack` bundles the worker with **esbuild via a Route Handler** — no webpack plugin,
  no `public/sw.js` written to disk (in-memory build), so **nothing to `.gitignore`**.
- `next-pwa` explicitly avoided (stale, App-Router-risky) per the recon.

## What was added
| File | Purpose |
|---|---|
| `next.config.ts` | `export default withSerwist(nextConfig)` (only appends esbuild to `serverExternalPackages`); `headers()` for `/serwist/:path*` |
| `src/app/serwist/[path]/route.ts` | `createSerwistRoute({ swSrc, useNativeEsbuild, esbuildOptions.define })`; serves `/serwist/sw.js` |
| `src/app/sw.ts` | the typed worker (excluded from tsc — webworker lib) |
| `src/components/pwa/ServiceWorkerRegistration.tsx` | client registration component |
| `src/app/providers.tsx` | mounts `<ServiceWorkerRegistration/>` |
| `tsconfig.json` | excludes `src/app/sw.ts` |
| `package.json` / lock | devDeps: `@serwist/turbopack`, `serwist`, `esbuild` |

## Registration (scope / updateViaCache / where)
`ServiceWorkerRegistration` (mounted in `providers.tsx`, **WorkerShell untouched**) calls:
```ts
navigator.serviceWorker.register("/serwist/sw.js", { scope: "/", updateViaCache: "none" })
```
- **scope "/"** is permitted because the route sets `Service-Worker-Allowed: "/"` (Serwist default),
  even though the script lives under `/serwist/`.
- **`updateViaCache: "none"`** so the browser never reuses a stale worker script from the HTTP cache.
- **Production-only** (`process.env.NODE_ENV !== "production"` → early return). A worker doing
  `skipWaiting`+`clientsClaim`+precache in dev would hijack Turbopack chunk requests and break HMR —
  that would be a dev-workflow behavior change (RED LINE). Prod-gating keeps dev byte-identical and
  means the worker stays **inert until a prod deploy** — reinforcing why this branch waits for Task 3.
- No update prompt, version compare, or reload here.

## SW script headers (recon requirement)
`createSerwistRoute`'s GET sets `Content-Type: application/javascript` + `Service-Worker-Allowed: "/"`,
but **not** caching/charset. `next.config` `headers()` for `/serwist/:path*` adds:
- `Content-Type: application/javascript; charset=utf-8`
- `Cache-Control: no-cache, no-store, must-revalidate`

## Cache names + version exposure
- The build SHA is resolved in the route (`process.env.APP_BUILD_COMMIT_SHA` → git HEAD → `"dev"`) and
  injected into the worker bundle via esbuild `define` as `__APP_BUILD_SHA__`. **Verified in the built
  worker**: the real SHA is embedded, and cache names are `ct-app-<sha>-{precache,static,assets}`.
- The worker answers a `GET_SW_VERSION` `postMessage` with `{ type:"SW_VERSION", version:<sha> }` —
  exposing the running version to controlled clients (Task 3 will query + compare it). No behavior
  beyond the read-only reply.
- Cleanup of stale `ct-app-*` caches on `activate` is deferred to Task 3 (update lifecycle); Serwist
  already prunes its own precache across revisions.

## Runtime caching = effectively OFF (verified against the built worker)
Only two `CacheFirst` routes: same-origin `/_next/static/**` and the public PWA assets
(`manifest.json`, `icon-192.png`, `icon-512.png`, `favicon.ico`, non-document). **No catch-all** —
per Serwist's docs, *"Without a default handler, unmatched requests will go against the network."* So
everything else is NetworkOnly **by omission**: all `/api/**`, Supabase `auth/rest/realtime/storage`,
RSC/flight (`?_rsc`, `text/x-component`, `Next-Router-State-Tree/Next-Url`), signed Storage/Mux URLs,
payroll/manager/admin/archive, Google Maps, AI/transcode, and every navigation. **No navigation
fallback** (Task 4). `navigationPreload:false` for now (avoids an unconsumed-preload warning with no
nav handler).

**`next build` inspection of `.next/server/app/serwist/sw.js.body` confirmed:**
- Precache manifest scoped to build assets + public PWA assets (`_next/static` ×77, `manifest.json`,
  `icon-512`) — **no authenticated HTML/RSC precached** (Serwist maps only `.next` → `/_next/` and
  `public/` → `/`; dev disables precache entirely).
- **Zero** `defaultCache` signatures (`pages-rsc`, `pages`, `googleapis`, `google-fonts`,
  `static-image-assets`, `next-data`, `apis` all absent) — i.e. no broad Next page/RSC/API/maps/font
  caching leaked in.
- `skipWaiting` / `clientsClaim` / `__SW_MANIFEST` present; SHA embedded.

## RED LINE compliance
- No worker components, offline queues (`cc_offline_*`), snapshots, auth-expired flow, or `proxy.ts`
  touched. WorkerShell.tsx untouched. Providers change is one import + one mounted element.
- No update banner / version-compare / auto-reload (Task 3).
- Dev workflow unchanged (registration prod-gated; SW inert in dev).

## Gates
- `npx tsc --noEmit` — clean (`src/app/sw.ts` excluded; compiled by esbuild instead)
- `npm run lint` — 0 errors, 7 baseline warnings (none new)
- `npm test` — 908 passed (127 files); +5 in `tests/lib/pwa-sw-plumbing-source.test.ts`
- `npm run smoke:core` — no failures, no warnings
- **Extra (not a required gate):** `npm run build` succeeds; `/serwist/[path]` prerenders
  `/serwist/sw.js` (+ sourcemap); no `public/sw.js` emitted.

## Owed to Task 3 (before this can ship)
Update prompt in WorkerShell, `registration.update()` hooks on start/focus/online/visible, version
compare (query `GET_SW_VERSION` vs `APP_BUILD_COMMIT_SHA`), block auto-reload while `cc_offline_*`
queues are non-empty, and delete stale `ct-app-*` caches on activate.

Not merged/pushed at time of writing.

---
Device verification build B trigger: 2026-07-05T22:29:30.4878937-07:00
