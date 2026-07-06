# PWA Task 1 — Manifest & install-prompt hardening

**Branch:** `feature/pwa-task1-install` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** install UX only. **No service worker, no caching, no changes to auth/proxy/offline queues.**
Source: `docs/handoff/PWA_RECON.md` (on `codex/agents-md`), "Task 1".

This branch is self-contained and **must not be merged until L0.5 closes** (per the prompt).

---

## 1) Manifest hardening — `public/manifest.json`

| Field | Before | After | Note |
|---|---|---|---|
| `scope` | (absent) | `"/"` | **added** — declares the app's navigation scope |
| `start_url` | `"/"` | `"/"` | **unchanged** — decision below |
| `display` | `"standalone"` | `"standalone"` | unchanged |
| `icons` | 2 (192, 512, no purpose) | 4 | **added** two `"purpose":"maskable"` entries; the two originals now carry explicit `"purpose":"any"` |

### start_url decision — keep `"/"` (worker-focused install still opens the clock)
The recon asked for "worker-focused install opens `/clock`; managers keep role-aware behavior."
The root route already does that routing for us — `src/app/page.tsx` redirects by role:

- `worker` / `driver` / `supervisor` → `/clock`
- `owner` / `admin` / `manager` → `/overview`
- `sales` → `/schedule`

So an installed app launched at `start_url:"/"` sends a crew member straight to `/clock` and a
manager to `/overview` — **both requirements satisfied with no manifest-level role hard-coding.**
Hard-coding `start_url:"/clock"` would have dumped managers onto the worker clock screen, so `"/"`
is the correct, role-preserving choice. (Left byte-for-byte; documented here for the record.)

### Maskable icons — checked, and they ARE safe
I inspected both assets. `icon-192.png` / `icon-512.png` are a centered gold "CT" monogram inside a
dark circular badge on a solid near-black (`#0f1117`, = `background_color`) square that bleeds to all
four edges. For Android adaptive masks:

- The important content ("CT") sits well within the central 80% **safe zone** — a circular/squircle/
  rounded-square mask never clips it.
- The fill reaches every edge with the theme's dark color, so cropped corners reveal only background
  (no transparent gaps, no awkward halo).
- Cropping only trims the symmetric decorative ring — graceful, not ugly.

Verdict: safe to ship as maskable. Rather than overwrite the existing entries' behavior, I **added**
separate `maskable` entries pointing at the same files and tagged the originals `"any"` explicitly, so
non-maskable contexts render exactly as before. (No new image assets were needed.)

## 2) Android install prompt

New client component `src/components/worker/PwaInstallPrompt.tsx`, mounted once in `WorkerShell`'s
header (`src/components/worker/WorkerShell.tsx`, after the GPS tips, inside `<header>`). Because
`WorkerShell` only wraps the authenticated `(worker)` route group, the prompt is inherently scoped to
a **logged-in crew member** — no extra role gate needed. (A manager who manually visits `/clock` would
also see it; benign, and managers are redirected to `/overview` by default.)

Behavior:
- Listens for `beforeinstallprompt`, calls `preventDefault()` (suppresses Chrome's mini-infobar),
  stashes the event, and shows an **"Установить приложение"** action (`pwa.installAction`).
- On tap → `prompt()`, then inspects `userChoice`:
  - `accepted` → set `cc_pwa_installed=true` (hidden **permanently**).
  - `dismissed` → stamp `cc_pwa_install_dismissed_at=<now>` (**throttled 14 days**, then re-offered).
- "Not now" button → same dismissal throttle.
- Listens for `appinstalled` (covers installs via the browser's own UI) → sets `cc_pwa_installed=true`.
- Never shows when already running standalone (`display-mode: standalone` / `navigator.standalone`).

## 3) iOS install hint

Same component. iOS Safari has no `beforeinstallprompt`, so it shows a short dismissible hint:
**"Нажмите «Поделиться», затем «На экран „Домой“»"** (`pwa.iosHintBody`).
- Shown only on **iOS Safari** (`isIosSafari` — detects iPhone/iPod and touch-capable iPadOS "Macintosh"
  UAs; excludes in-app Chrome/Firefox/Edge/Opera where the Share→Add flow differs), only when not
  standalone, and only if not previously dismissed.
- Dismiss → `cc_pwa_ios_hint_dismissed=true` (remembered).

## 4) i18n

Added a `// ── PWA Install ──` block in `src/lib/i18n/translations.ts`, all keys ru + en following the
existing `{ en, ru }` pattern: `pwa.installTitle`, `pwa.installBody`, `pwa.installAction`,
`pwa.installLater`, `pwa.iosHintBody`. The iOS-hint dismiss reuses the existing `common.dismiss`.

## Design notes / testability

Show/hide policy lives in a framework-free module `src/lib/pwa-install.ts`
(`shouldShowAndroidInstall`, `isIosSafari`, `shouldShowIosHint`, + the localStorage key constants and
the 14-day throttle), so the decisions are unit-tested without a DOM. Component wiring
(`beforeinstallprompt`/`appinstalled`/localStorage) is the thin shell around it.

localStorage keys (all `cc_`-prefixed, matching the app's other offline keys):
`cc_pwa_installed`, `cc_pwa_install_dismissed_at`, `cc_pwa_ios_hint_dismissed`.

### Known caveat (in scope for a later task, not this one)
`beforeinstallprompt` can fire before `WorkerShell` hydrates and the component's listener attaches; if
so, that first event is missed until Chrome re-fires. Robustly catching it means an early global
capture (a top-level listener/script), which would touch `layout`/`providers` — out of this task's
"small worker-shell component" scope. Noted for Task 2+ when the SW registration lands. In practice
Chrome fires it after engagement heuristics, and the worker shell hydrates early, so catch rate is good.

## RED LINE compliance
- No service worker, no caching added.
- No changes to auth, `src/proxy.ts`, or any offline queue (`cc_offline_*`). WorkerShell change is only
  an import + a single `<PwaInstallPrompt />` mount in the header.
- Existing manifest behavior preserved (start_url/display unchanged; original icon entries render as
  before). All edits additive.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (unchanged; none in the new files)
- `npm test` — 900 passed (125 files); +14 new in `tests/lib/pwa-install.test.ts`
- `npm run smoke:core` — no failures, no warnings

## Manual QA still owed (device-only, can't run headless here)
- Android Chrome: visit worker app → "Установить приложение" appears → install → prompt gone; reopen
  installed app lands on `/clock`; dismiss → hidden, returns after ~14 days.
- iOS Safari: hint appears, Share→Add to Home Screen works, dismiss is remembered; no hint in an
  already-installed standalone launch.
- Android icon: confirm the maskable icon looks clean under a circular mask on the home screen.

Not merged/pushed at time of writing.
