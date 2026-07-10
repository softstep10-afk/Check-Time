# Step 3 — worker clock-in/out trust hardening (HIGH-D #5 + HIGH-E #6)

**Branch:** `feature/step3-clockin-hardening` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `22c5c91`)
**Date:** 2026-07-08

> ⚠️ **Recon doc missing.** `docs/handoff/STEP3_CLOCKIN_RECON.md` does not exist on any
> branch or in history. Rather than block, I derived the exact file+line map and the
> "verbatim" access logic directly from the live source — the authoritative ground truth
> for "no drift." The map below is what I implemented against.

## PART A — eventTime bounds (#5)
New pure module `src/lib/clock-time-bounds.ts` (constants in one place; testable):
- `FUTURE_TOLERANCE_MS = 5m`, `ONLINE_MAX_AGE_MS = 5m`, `OFFLINE_MAX_AGE_MS = 12h`, `MAX_SHIFT_MS = 24h`.
- `checkClockEventTime({eventTimeMs, nowMs, offlineQueued})` — NOT-FUTURE (both), ONLINE
  freshness (5m) when not queued, OFFLINE replay (12h) when queued.
- `checkClockOutAgainstClockIn({clockOutMs, clockInMs, nowMs})` — MAX-SHIFT (>24h) + re-assert
  clock-out > clock-in and not-future.
- `clockTimeRejectionMessage(reason)` — fixed, safe strings.

**clock-in** (`src/app/api/worker/clock-in/route.ts`): after the `existingEvent` idempotency
short-circuit, `checkClockEventTime(eventTime, now, offlineQueued)` → **422** on violation
(message via `safeClientErrorMessage`). Placed *after* dedup so replaying an already-accepted
(possibly now-stale) offline event stays idempotent.

**clock-out** (`src/app/api/worker/clock-out/route.ts`): after the `existingEvent` short-circuit,
`checkClockEventTime(requested, now, offlineQueued)` → 422; then, after the **existing**
fallback-to-now line (unchanged), `checkClockOutAgainstClockIn(finalEventTime, clockIn, now)` →
422 (max-shift + re-assert). No silent clamp — every violation rejects with a safe 422.

## PART B — project access (#6)
New shared helper `src/lib/server/project-access.ts`:
`assertWorkerCanAccessProject(client, {workerId, orgId, projectId, accessMode}) → Promise<boolean>`
— lifted **verbatim** from the claim-task / project-tasks / project-notes / material-orders logic:
`list` → assignment row; `all_active` → project ACTIVE && no exclusion (`exclusionError ? true : !exclusion`
fail-open). Client-agnostic (`SupabaseClient`) so each caller keeps the **exact client / RLS channel** it used before.

- **clock-in**: added `project_access_mode` to the profile select/type; after the project 404-check,
  `assertWorkerCanAccessProject(admin, …)` → **403** if not allowed. This closes #6 (a worker could
  previously clock into ANY active project in the org). clock-out takes the project from the open
  clock_in, so guarding clock-in covers the close path.
- **project-tasks** (user client), **project-notes** (user client — **manager bypass kept exactly**),
  **material-orders** (admin, inside its existing `assertWorkerProjectAccess` wrapper which keeps its
  own project-fetch / archived / 404 responses): the duplicated inline list/exclusion decision replaced
  with the helper. Same client each → identical behavior, identical 403/404 messages.

## Tests (+21; suite 1033 green)
- `tests/lib/clock-time-bounds.test.ts` (14): each bound accepts at the boundary and rejects one ms
  past; online vs offline windows (same 2h-old event: stale online / fine offline); max-shift at/over
  24h; not-after-clock-in; future.
- `tests/lib/project-access.test.ts` (7): list allow/deny; all_active allow/deny/non-active/missing;
  exclusion-read-error fails open.
- Updated 2 source-guards (`journal-active-project-notes-source`, `manager-owner-critical-path-audit-source`):
  the `project_assignments`/`project_exclusions` literal checks now point at the shared helper file;
  the route still asserts `assertWorkerCanAccessProject`, the manager bypass, `.eq("org_id", …)`, and the
  403 message — intent preserved.

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 baseline warnings) |
| `npm test` | 1033 passed / 1033 (145 files; +21) |
| `npm run smoke:core` | 0 failures, 0 warnings |
| `npm run alpha7:predeploy` | passed |

Stopped after gates — **no merge, no push, no deploy.**

## RED LINES honored
- Valid clock-ins unchanged (online events ~now pass all bounds; the geofence/GPS path is untouched).
- **GPS=null still clocks in** — bounds are on time only, independent of GPS (business rule §4 preserved).
- No RLS changes; no payroll math touched. Minimal diff.

## Decisions / flags to confirm
1. **clock-in has NO manager bypass.** Applying the access helper means a `list`-mode manager/owner with
   no assignment to the target project would now be **denied** clock-in (403). Per spec ("keep existing
   bypass as-is" — clock-in had none) I added none. Practical risk is ~nil: `/api/worker/clock-in` is
   driven only by the worker UI (WorkerShell); managers use the manager dashboard. **If you want managers
   to always clock in, it's a one-line add** — mirror project-notes' `MANAGER_ROLES.has(profile.role)`
   bypass before the access check. Confirm during your screen eyeball.
2. **`all_active` self-fetches project status.** The helper signature omits status, so for `all_active`
   it issues one extra `projects.select('status')` query (only for all_active workers). Decision is
   identical to the old inline `project.status === "active"` guard; just one more read on that path.
3. **422 messages** are routed through `safeClientErrorMessage` per the task (the strings are already
   safe constants — this is belt-and-suspenders).
