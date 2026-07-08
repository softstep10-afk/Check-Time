# Step 2a — server-stamp GPS location consent (external-audit HIGH-B / #8)

**Branch:** `feature/consent-server-stamp` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `f076e1f`)
**Date:** 2026-07-07

## Problem
`worker_location_consents` is a WA-legal, append-only record. Today the browser
builds the whole row (`writeConsent` → `buildGpsConsentInsert`) and inserts it
directly under RLS policy `wlc_insert_self`. So `signed_name`, `consented`,
`consent_version`, `signed_at`, `ip_address`, `user_agent` are all
client-supplied — append-only but **not trusted**. A tampered client can insert
a consent row with any values.

## Fix
The server now stamps every trusted field; the client may supply only the two
things it legitimately owns — `signedName` and the granted/denied decision.

### 1. New route — `src/app/api/worker/location-consent/route.ts` (`runtime = "nodejs"`)
- Auth from session (`createClient().auth.getUser()`, 401 if none), same pattern
  as the other `/api/worker/*` routes.
- **Identity derived from the authenticated profile — never the body:**
  `worker_id = profile.id`, `org_id = profile.org_id`.
- **Accepts only** `signedName` (string, trimmed, required, ≤ 200) and `granted`
  (boolean, required). Missing/malformed → 400. Any `consent_version` /
  `worker_id` / `org_id` / `consented` / `ip_address` / `signed_at` in the body
  is **ignored**.
- **Server stamps:** `consent_version = GPS_CONSENT_VERSION` (server constant),
  `user_agent` = request UA header (capped), `ip_address = readTrustedClientIp(request)`,
  `signed_at` = DB default `now()`.
- Insert via the **service-role admin client**. Append-only (never updates).
- Returns `{ok:true}` / `{ok:false,error}` (mirrors `writeConsent`'s contract),
  errors via `safeClientErrorMessage` (S-L1).

### 2. Client channel — `src/lib/gps-consent-client.ts`
`postGpsConsent({signedName, granted})` POSTs the route and returns the exact
`{ok:true}|{ok:false;error}` shape, so call sites change minimally.

### 3. WorkerShell — all three write sites repointed
`handleGpsConsent` (~945), `handleGpsDecline` (~962), and the DB-sync path
(~877, writes a grant row when localStorage=granted but DB has none) now call
`postGpsConsent({ signedName, granted })`. The `writeConsent` import is dropped.
**localStorage cache behavior and the `ConsentState` transitions are byte-for-byte
identical — only the write channel changed.**

### 4. Tests — `tests/lib/location-consent-route.test.ts` (7)
401 (no session); 400 (missing/blank/too-long `signedName`, missing/non-boolean
`granted`); happy-path server-stamp (worker/org from session, trimmed name,
`consent_version = GPS_CONSENT_VERSION`, UA from header, trusted IP, no
`signed_at`); denied path; and the **legal guardrail** — a body carrying
`consent_version:999 / worker_id / org_id / consented:false / ip_address /
signed_at` is ignored and the inserted row uses the server values.
`tests/lib/consent-audit-ui-source.test.ts` updated: the WorkerShell write-path
assertion now targets `await postGpsConsent` (same intent, new channel).

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 baseline warnings) |
| `npm test` | 1012 passed / 1012 (143 files; +7, 1 source-guard updated) |
| `npm run smoke:core` | 0 failures, 0 warnings |

Stopped after gates — **no merge, no push, no deploy.**

---

## DB step — OWNER APPLIES BY HAND (do NOT bundle into app code)

> ⚠️ **Apply this ONLY AFTER the route is live and smoke passes.** The route must
> be the write path before the direct client path is cut, or consent writes
> break. Run in the Supabase SQL editor against prod:

```sql
-- Step 2a — cut the direct client-insert path; server route is the only writer.
revoke insert on public.worker_location_consents from authenticated;
drop policy if exists wlc_insert_self on public.worker_location_consents;
grant insert on public.worker_location_consents to service_role;
-- SELECT policy wlc_select_self_or_manager stays: workers/managers still READ consents.
```

After applying, a documentation-of-record mirror migration can be added (same
pattern as 00043 / 00048) — optional, not required for correctness.

---

## RED LINES honored
- Consent legal text, the modal, the localStorage keys, and the `ConsentState`
  state machine: **unchanged**.
- **Append-only preserved** — the route only inserts; no update/delete paths.
- `writeConsent` / `buildGpsConsentInsert` remain in `src/lib/gps-consent.ts`
  (a unit test still exercises `buildGpsConsentInsert`); `writeConsent` is now
  **unused by app code** and, once the DB block is applied, would be denied by
  RLS anyway. Safe to remove in a later cleanup.

## Notes / decisions to confirm
- **IP source:** the task said "x-forwarded-for first hop," but I used the repo's
  `readTrustedClientIp` — it takes `x-real-ip` / the **rightmost** forwarded hop
  (Vercel appends the real connecting IP last; the leftmost token is
  client-spoofable). This is the genuinely *trusted* IP and matches how the rate
  limiter buckets. Flagging in case a specific hop was intended.
- **`ip_address` is now populated** on new rows (the old client path left it
  null). The column already exists (migration 00014); no schema change.
