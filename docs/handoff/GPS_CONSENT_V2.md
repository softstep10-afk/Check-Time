# GPS Consent v2 — re-request + permanent decision-change path

**Branch:** `feature/gps-consent-v2` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `2977d62`)
**Date:** 2026-07-06
**Legal context:** Washington state. Consent wording is owner-confirmed copy; this
change re-requests it and gives every worker a permanent way to change the decision.

---

## What changed (point diffs only)

### 1. Version bump — `src/lib/gps-consent.ts`
- `GPS_CONSENT_VERSION` `1 → 2`. One line. Nothing else in this file touched.
- **Why cached v1 does not satisfy v2 (verified, automatic):**
  - Storage keys are per-version: `check-time-gps-consent-v${version}`. Reading v2
    looks at `…-v2`, which prior consenters/skippers do not have → `"unknown"`.
  - The legacy-key fallback (`check-time-gps-consent`) in `readCachedGpsConsent` is
    gated `version === 1`, so it can **never** leak a v1 decision into a v2 read.
    (Covered by `tests/lib/gps-consent.test.ts`: `readCachedGpsConsent(storage, 2)`
    returns `"unknown"` even when the legacy key is `"true"`.)
  - DB read (`readLatestConsent`) filters `.eq("consent_version", 2)`, so a worker
    with only v1 rows reads `"unknown"` and is asked again.
  - `writeCachedGpsConsent` only mirrors to the legacy key when `version === 1`, so
    v2 writes touch only the v2 key — no cross-version contamination.

### 2. Consent text — `src/lib/i18n/translations.ts` + `GpsConsentModal.tsx`
- New key `gps.consentClarification` (RU + EN), rendered as its own emphasized
  paragraph directly under `gps.consentBody` in the modal. Text:
  > *Clocking in and clocking out always records the location of that moment as part
  > of your time records. This consent covers live location tracking during an active
  > shift only.*
  > (RU: *Отметки прихода и ухода всегда фиксируют местоположение в этот момент как
  > часть записей учёта времени. Это согласие распространяется только на непрерывное
  > отслеживание местоположения во время активной смены.*)
- The existing `gps.consentBody` meaning is unchanged; the clarification is additive.

### 3. Settings path — `WorkerShell.tsx` + 5 new i18n keys
- New row rendered right after `<PushNotifications />` in the worker header (the same
  settings area as the push toggle and language switch). Label
  `gps.settingLabel` = "GPS-трекинг во время смены" / "GPS tracking during shift".
- Shows the current decision: **Разрешён / Отключён / Не выбрано** (Enabled /
  Disabled / Not set), driven by a new `consentDecision: ConsentState` state tracked
  alongside `gpsConsented` (the boolean alone can't tell "declined" from "never
  chosen"). It is set in the localStorage-seed effect, the DB-check effect, and both
  accept/decline handlers.
- The "Change" button calls `setShowConsentModal(true)` — it reopens the **same**
  `GpsConsentModal` with the **same** `handleGpsConsent` / `handleGpsDecline`
  handlers, so a new decision:
  - appends a **new** `worker_location_consents` row (never updates — append-only
    audit trail), same fields incl. `signed_name` + `user_agent` + `consent_version`;
  - updates the localStorage cache; and
  - flips `gpsConsented`, which flips `gpsTrackingEnabled` (`gpsConsented &&
    isClockedIn`) live — **no re-login required**.

### 4. No dark patterns
- The «Пропустить»/decline path is unchanged. Once any v2 decision is recorded,
  `hasCachedGpsConsentDecision(v2)` is true and the auto-open effect no longer fires,
  so deniers are not nagged. They now have the settings row to opt in whenever.

### 5. Test — `tests/lib/gps-consent.test.ts`
- The default-version assertion for `buildGpsConsentInsert` updated `1 → 2` (it
  asserts the default `GPS_CONSENT_VERSION`, which is exactly what changed). The
  explicit-version cases (v1 legacy, v2 unknown) were already correct and untouched.

---

## What was deliberately NOT touched (RED LINE)
- Live-tracking start/stop and what it captures — `useGpsTracking`, `handleGpsPosition`,
  `worker_live_locations` inserts: **unchanged**.
- Clock-in/out GPS stamping, geofence, No-GPS metadata, offline queues, `sw.ts`: **unchanged**.
- `worker_location_consents` schema — `consent_version integer not null default 1`
  already exists (migration `00003`); RLS insert policy is self-insert + append-only.
  **No migration written or needed.**
- Manager audit page (`admin/audit/page.tsx`) already `select`s `consent_version` and
  renders `String(row.consent_version)`, so v2 rows appear with **zero** change there.
  Verified — not edited.

---

## Gates (all green)
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (only pre-existing warnings; none added by this change) |
| `npm test` | 985 passed / 985 |
| `npm run smoke:core` | 0 failures, 0 warnings |
| `npm run build` | success |

Stopped here — **not** merged, pushed, or deployed.

---

## Needs live / product verification
1. **When the modal re-appears.** The auto-open trigger requires the worker to be
   **clocked in** (existing `shell.clockState.isClockedIn` gate, WorkerShell.tsx). It
   does not pop at the literal login screen. So "modal once on next login" in practice
   means "the next time they're clocked in without a current-version decision." I kept
   that gate on purpose — moving it would change tracking-trigger behavior beyond
   consent plumbing (RED LINE). The always-available settings row covers everyone
   regardless of clock state. **Confirm this is the intended moment.**
2. **Owner confirms the RU + EN wording** of `gps.consentClarification` (legal copy).
3. Live smoke on a phone: clock in → modal shows v2 body + clarification → tap agree →
   one tap, tracking starts; open settings row → "Change" → decline → tracking stops,
   new `worker_location_consents` row written, status shows "Отключён", no re-login.
