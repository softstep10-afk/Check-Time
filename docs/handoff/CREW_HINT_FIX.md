# Crew-Hint Fix — `GET /api/team/edit-shift`

**Branch:** `fix/crew-hint-scope-tz` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** GET crew-hint handler + `ShiftEditDialog` hint fetch only. POST/edit logic untouched.
**Trigger:** two bugs found in production smoke on the owner shift-editing crew hint.

---

## Bug 1 — Self-referential hint

The crew hint is meant to show *other* workers' departure window ("бригада ушла в X–Y"). The
GET handler counted **all** workers on the project that day, including the worker whose shift was
being edited/added — so a lone worker saw their own clock-out reflected back as a "crew" hint.

**Fix:**
- Added a **required** `excludeProfileId` query param, uuid-validated with `readRequiredUuid`
  (same pattern as `projectId`).
- Added `.neq("profile_id", excludeProfileId)` to the `time_events` query.
- `ShiftEditDialog` now passes the worker's `profile.id` as `excludeProfileId` in the hint fetch.
- With no other workers' clock-outs that day, the existing `count === 0` path returns
  `{ crewLeftFrom: null, crewLeftTo: null, count: 0 }` and the dialog renders no hint line.

## Bug 2 — Day window computed in UTC vs. a local calendar day

The dialog sent a `day` string (local calendar day) but the server built the window as UTC
midnight → +24h. Evening local shifts therefore fell into the **wrong UTC day**, so the hint
query missed or mismatched the day's departures.

**Fix (minimal — move the window to the client, which already knows local time):**
- The dialog now computes an explicit window from its existing `localDay` logic via a new
  `localDayWindow(day)` helper: `from` = local midnight, `to` = local midnight + 24h, both as
  ISO timestamps. It sends `from` and `to` instead of `day`.
- The server validates both as ISO timestamps, requires `to > from` and `to − from ≤ 26h`
  (tolerates DST-length days plus margin), and uses them directly in `.gte("event_time", from)`
  / `.lt("event_time", to)`.
- The `day` param and its UTC-midnight computation were removed.

---

## Route contract — `GET /api/team/edit-shift` (after fix)

Auth: `requireManagerContext` + `hasFinanceAccess` → **403** otherwise. Service-role read,
explicit `.eq("org_id", org.id)`.

**Query params (all required):**

| Param | Validation |
|---|---|
| `projectId` | uuid (`readRequiredUuid`) |
| `excludeProfileId` | uuid (`readRequiredUuid`) — the worker to exclude |
| `from` | ISO timestamp (`parseIso`) |
| `to` | ISO timestamp (`parseIso`) |

**Window validation:** `to > from` **and** `to − from ≤ 26h`, else **400** `"Invalid window."`

**Query:** `time_events` where `org_id = org.id`, `project_id = projectId`,
`profile_id ≠ excludeProfileId`, `event_type ∈ {clock_out, auto_out}`,
`event_time ∈ [from, to)`.

**Response:**
- Departures found → `{ ok: true, crewLeftFrom: <min ISO>, crewLeftTo: <max ISO>, count }`
- None → `{ ok: true, crewLeftFrom: null, crewLeftTo: null, count: 0 }`
- Errors → `{ error }` with 400 / 403 / 500, client text via `safeClientErrorMessage`.

## Client change — `ShiftEditDialog.tsx`

- Added `localDayWindow(day)` helper (local midnight → +24h ISO).
- Hint fetch now sends `projectId`, `excludeProfileId=workerId`, `from`, `to` (dropped `day`).
- Renamed the local `window` var to `dayWindow` to avoid shadowing the browser global; added
  `workerId` to the effect dependency array.

**Unchanged:** `formatHintTime` already slices `"HH:mm"` from an ISO-local string (inherently
24-hour, no `Intl`), so it needed no change.

---

## Gates

- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 878 passed (121 files)
- `npm run smoke:core` — no failures, no warnings

**Commit:** `6de3d64` — `fix(shift-edit): crew hint excludes self and uses a local-day window (prod smoke)`
(2 files changed, +39/−13). Not merged/pushed at time of writing.
