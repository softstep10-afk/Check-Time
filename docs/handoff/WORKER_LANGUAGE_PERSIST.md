# Worker UI language → profiles.language persistence

**Branch:** `feature/worker-language-persist` (from `e11c3cd`)
**Date:** 2026-07-06

## Problem
UI locale lived ONLY on-device (localStorage + cookie, `src/lib/i18n/context.tsx`).
`profiles.language` is written once at team/create (default `'en'`) and never updated,
so the whole crew is `'en'` in the DB while their UIs are RU/EN mixed. The push i18n
merged today (`src/lib/server/task-dispatch.ts`) reads `profiles.language` → everyone
currently gets English pushes.

## What changed (4 small pieces)

### 1. Server write path — `src/app/api/profile/language/route.ts` (new)
`POST /api/profile/language`, same auth boundary as the other worker routes:
- `supabase.auth.getUser()` → 401 if unauthenticated.
- Validates `body.locale` server-side to `'en' | 'ru'` → 400 otherwise.
- Admin-client `update({ language: locale }).eq("id", user.id)` — **identity is
  derived from the session; the client never supplies a profile id**, and only the
  `language` column is written.
- 503 if the service-role client isn't configured (mirrors `clock-in` / `tasks/seen`).

Note: RLS (`profiles_update`, 00042) technically already allows a self-update
(`id = auth.uid()`) and the privilege-escalation guard (00043) does not cover
`language`. We still route through the server so the **locale is validated** (RLS
would not reject an arbitrary string) and identity is server-derived — exactly the
pattern the task asked for. No schema/RLS change; no migration.

### 2. Client helper — `src/lib/i18n/persist-locale.ts` (new)
`persistProfileLocale(locale)`: fire-and-forget `fetch` to the route, `keepalive: true`,
`.catch()` swallows failures. Never blocks or throws — the device locale is already the
instant UI source.

### 3. LanguageSwitcher — `src/lib/i18n/context.tsx`
In the switcher's `onClick`, after the **unchanged** `setLocale(next)` (localStorage +
cookie stay the instant UI source), also call `persistProfileLocale(next)`. Because this
lives in the shared switcher, it works for **every role that renders it** (workers via
WorkerShell, managers via the manager layout) — no new mount points. The i18n reading
path (`readStoredLocale`, `useSyncExternalStore`, `t`) is untouched.

### 4. Boot sync — `src/components/worker/WorkerShell.tsx`
A ran-once `useEffect`: on shell load, if the device `locale` differs from
`shell.profile.language`, call `persistProfileLocale(locale)` exactly once. This
auto-backfills each worker's real language on their next login — **no manual data edits**.
The switcher's own on-change persistence handles subsequent changes, so the ref guard
avoids a double write.

## RED LINE compliance
- i18n reading path, cookie/localStorage logic: **unchanged** (only added a write
  side-effect in the switcher's onClick and a boot-sync effect).
- Push dispatch code (`task-dispatch.ts`): **untouched** — it already reads
  `profiles.language`; this change just makes that column true-to-the-UI.
- No schema/RLS/migration changes.

## Files
- new `src/app/api/profile/language/route.ts`
- new `src/lib/i18n/persist-locale.ts`
- new `tests/lib/worker-language-persist.test.ts` (6 source-guard tests)
- edit `src/lib/i18n/context.tsx` (import + onClick persist)
- edit `src/components/worker/WorkerShell.tsx` (import + boot-sync effect + `locale` from `useTranslation`)

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 pre-existing warnings, none in changed files) |
| `npm test` | 1005 passed / 1005 (142 files; +6 new) |
| `npm run smoke:core` | 0 failures, 0 warnings |

Stopped here — no merge, no push.

## Needs live verification (owner)
1. Worker with a RU UI whose `profiles.language` is `'en'`: log in → the boot sync
   should flip `profiles.language` to `'ru'` once (check the row / Supabase logs show a
   single `POST /api/profile/language`).
2. Toggle the switcher (worker AND a manager): `profiles.language` updates to match; the
   UI still switches instantly (device cookie/localStorage unchanged).
3. After a worker's language is backfilled, a new task-assignment push arrives with the
   localized title (RU) instead of English.
