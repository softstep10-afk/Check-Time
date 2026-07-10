# Consent phantom-write fix (WA GPS legal-record integrity)

**Branch:** `fix/consent-phantom-write` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `55d4a9c`)
**Date:** 2026-07-09

## Problem
`worker_location_consents` is a WA-legal, append-only record. In
`src/components/worker/WorkerShell.tsx` the consent bootstrap could **write a consent
row that no human signed this session**: when the DB had no `consent_version=2` row but
localStorage held a stale "granted", the effect auto-POSTed
`postGpsConsent({ signedName: profile.name, granted: true })`. Worse, all three prompt
sites gated on `!hasCachedGpsConsentDecision(localStorage)`, so a stale cache also
**suppressed** the v2 prompt — the modal never appeared, yet a phantom v2 consent could
be manufactured (the "Test" profile symptom).

## Fix (minimal, surgical — removes only the phantom-write path)

### 1. New pure helper — `src/lib/gps-consent.ts` `resolveConsentGate(dbState)`
Maps the DB's current-version decision (the **sole** truth) to
`{ gpsConsented, consentDecision, shouldPrompt }`. It takes **only** the DB state and
never consults storage, so a cached decision can neither authorize skipping the prompt
nor trigger a write:
- `granted` → track, no prompt.
- `denied`  → no track, no prompt (honored; re-consent via the settings row).
- `unknown` → no current-version row → no track and **prompt** (even with a stale cache).

### 2. Bootstrap effect (~861)
Removed the entire `else if (… postGpsConsent …)` auto-write branch. Now it reconciles
state from the DB for **all** cases via `resolveConsentGate(await readLatestConsent(...))`
→ `setGpsConsented` / `setConsentDecision`, and writes the localStorage cache **only** for
a definite decision (never on `unknown`). `readLatestConsent`'s v2 filter is unchanged.

### 3. Three prompt sites (auto-open ~892; offline clock-in; online clock-in)
Replaced `!hasCachedGpsConsentDecision(window.localStorage)` with
`consentDecision === "unknown"` ("no current-version DB decision"). This still avoids
re-prompting deniers (`denied` ≠ `unknown`) and honors granters (`gpsConsented` guards
them out). Added `consentDecision` to the auto-open effect's deps.

### 4. Imports / guard test
Dropped the now-unused `hasCachedGpsConsentDecision` import from WorkerShell (kept
`readCachedGpsConsent` — still used by the fast-paint seed — plus `readLatestConsent`,
`writeCachedGpsConsent`); added `resolveConsentGate`. Updated
`tests/lib/consent-audit-ui-source.test.ts` to assert the DB-truth gate
(`resolveConsentGate`, `consentDecision === "unknown"`) and the absence of the phantom
auto-write (`not.toContain("consent sync failed")`).

## Untouched (per red line)
`handleGpsConsent` / `handleGpsDecline` (the only writers, human-driven), the settings-row
re-consent button, the server route, RLS, the `worker_location_consents` table, and
`readLatestConsent`'s version filter. The fast-paint localStorage seed effect stays (cache
is allowed as fast paint; the bootstrap corrects it from the DB).

## Tests
`tests/lib/gps-consent.test.ts` — `resolveConsentGate` for granted / denied / unknown, and
an explicit check that the gate has arity 1 (no storage param) so the two task scenarios
(stale pre-v2 cache, and no cache) both reduce to `unknown` → prompt + no write. Full
suite: **1039 passed / 1039** (146 files; +4).

Mapping to the task's requested cases:
- DB v2 granted → `gpsConsented:true, shouldPrompt:false` (no prompt).
- DB v2 denied → `gpsConsented:false, shouldPrompt:false` (tracking off).
- DB no v2 + stale pre-v2 cache → DB state `unknown` → `shouldPrompt:true`, and the
  bootstrap performs **no** write (no `postGpsConsent` on this path).
- DB no v2 + no cache → `unknown` → prompt.

## Gates (all green on the branch)
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 baseline warnings) |
| `npm test` | 1039 passed / 1039 (146 files) |
| `npm run alpha7:predeploy` | passed |

Stopped after gates — **no merge, no push, no deploy.**

## Flag to confirm
`readLatestConsent` returns `unknown` on a **read failure** as well as on "no row", so a
transient DB error now results in prompt-and-don't-track rather than trusting the cache.
This is fail-safe and matches "DB is the sole source of truth"; the previous code already
conflated error/empty — it just manufactured a phantom row instead of prompting. If you'd
prefer a transient read error to fall back to the cached v2 decision (to avoid a rare
re-prompt for the 13 v2 consenters on a flaky network), that needs distinguishing
error-vs-empty in `readLatestConsent` — a slightly larger change; flagging rather than
assuming.
