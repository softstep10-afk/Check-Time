# Staging mobile validation report

**Staging URL:** `https://check-time-five.vercel.app`
**Vercel deployment ID:** `dpl_35cmwaVQVqvWrDB8iyFLtqGsu8Pp`
**Date opened:** 2026-04-21
**Branch:** `waveAudit/live-data-fixes`
**Latest commit on disk:** `0369796 waveAudit(auth): make AUTH_BYPASS env-driven (default off)`

This file is a hybrid: half verified observations from server-side
probes, half a structured `[TBD by phone test]` checklist for hands-on
validation. Fill in the `[TBD]` blocks while testing on the phone — do
not delete the headings.

---

## Part 1 — Verified server-side (no phone needed)

These are objective facts pulled via `curl` from the staging URL.
Confirmed at the date above.

### Routing + auth gate

| Path | HTTP | Redirect / Notes |
|------|------|------------------|
| `/` | 307 | → `/login` ✅ (proves AUTH_BYPASS is OFF) |
| `/login` | 200 | Prerendered, `X-Vercel-Cache: HIT`, served from Vercel CDN |
| `/overview` | 307 | → `/login?next=%2Foverview` (proxy auth gate working) |
| `/my-tasks` | 307 | → `/login?next=%2Fmy-tasks` (proxy auth gate working) |
| `/messages` | 307 | → `/login?next=%2Fmessages` (proxy auth gate working) |
| `/team` | 307 | → `/login?next=%2Fteam` (proxy auth gate working) |
| `/manifest.json` | 200 | `application/json` — PWA manifest reachable |
| `/icon-192.png` | 200 | `image/png` — PWA icon reachable |

### API endpoints

| Endpoint | Probe | Result |
|----------|-------|--------|
| `POST /api/auth/pin-login` | empty body | 400 + `{"error":"Enter a valid 4 to 6 digit PIN."}` ✅ |
| `POST /api/auth/pin-login` | `{"pin":"abc"}` | 400 + same validation error ✅ |
| `POST /api/auth/pin-login` | (didn't probe with real PIN) | n/a — would consume a session |

**Critical observation:** `/api/auth/pin-login` does NOT return 503 with
"PIN login needs SUPABASE_SERVICE_ROLE_KEY..." — this confirms the
service role key env var IS set on Vercel. ✅

### Security headers

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — HSTS active ✅
- `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` on protected routes ✅
- `Server: Vercel`, `X-Powered-By: Next.js` — normal
- HTTPS — full TLS, no certificate warnings expected

### Deployment artifacts present

- Vercel deployment ID `dpl_35cmwaVQVqvWrDB8iyFLtqGsu8Pp` is the served build.
- `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` — RSC streaming functional.
- Static font preload chunks present in HTML.

### What server-side probes can NOT confirm

- Whether GPS works (browser API, requires user gesture + permission).
- Whether photo / video upload completes against Supabase Storage.
- Whether messaging round-trip works in a real authenticated session.
- Whether Hydration warnings appear in the browser console.
- Whether touch / scroll / button hit-targets work on a real touchscreen.
- Whether the PWA installs from the Add-to-Home-Screen prompt.

Those need the phone — that's Part 2.

---

## Part 2 — Phone validation checklist

Test environment:

- **Device:** [TBD — iPhone model / Android model]
- **OS version:** [TBD]
- **Browser:** [TBD — Chrome / Safari / version]
- **Network:** [TBD — Wi-Fi name / cellular]

For every step: write what you actually saw. If a step crashes or
behaves unexpectedly, capture the network tab (`chrome://inspect#devices`
or Safari Web Inspector) and the console. Don't guess at causes — just
record what happened.

### A. Login + session

| # | Step | Expected | Observed |
|---|------|----------|----------|
| A1 | Open staging URL in fresh incognito tab | `/login` shows PIN numpad | [TBD] |
| A2 | Tap each digit `9` `9` `9` `9` | Each tap responds, dots fill | [TBD] |
| A3 | Submit | Auto-redirect to `/overview` (owner) | [TBD] |
| A4 | F5 / pull-to-refresh | Stays logged in, no re-prompt | [TBD] |
| A5 | Close tab → reopen URL | Stays logged in (cookie persists) | [TBD] |
| A6 | DevTools console: `document.cookie` | Contains `sb-vlrajjwbaxikbwvqdpft-auth-token` | [TBD] |
| A7 | Sign out via UI | Returns to `/login` | [TBD] |
| A8 | Try a worker PIN (if you have one provisioned) | Reaches `/my-tasks` instead of `/overview` | [TBD] |

**Notes / issues:** [TBD]

### B. GPS

Pre-step: make sure OS-level location permission for the browser is
**ALLOWED** in phone Settings (Settings → Apps → Chrome / Safari →
Permissions → Location → Allow).

| # | Step | Expected | Observed |
|---|------|----------|----------|
| B1 | After login as worker, go to clock-in for an assigned project | Consent modal appears (if first time on this profile) | [TBD] |
| B2 | Tap "Confirm & continue" on consent modal | Modal closes; clock-in flow proceeds | [TBD] |
| B3 | Browser permission prompt appears for Location | Native OS prompt, "Allow" / "Deny" | [TBD: which buttons appear] |
| B4 | Tap **Allow** | Clock-in completes, no banner error, success tone plays | [TBD] |
| B5 | DevTools console while clock-in is running | No `[GPS diagnostic]` red error log | [TBD] |
| B6 | DevTools console: `window.isSecureContext` | `true` | [TBD] |
| B7 | Wait 30-40 seconds with the page open | New rows in `worker_live_locations` (verify in Supabase SQL Editor: `select recorded_at, lat, lng from public.worker_live_locations order by recorded_at desc limit 5`) | [TBD] |
| B8 | Clock out | No false "Location access required" banner | [TBD] |

**Deny path:**

| # | Step | Expected | Observed |
|---|------|----------|----------|
| B9 | New incognito session, decline OS Location prompt | Red banner: "Location permission denied. Tap to retry." | [TBD] |
| B10 | DevTools console | `[GPS diagnostic]` log with `isSecureContext: true`, `errorCode: 1` | [TBD] |

**Consent declined path:**

| # | Step | Expected | Observed |
|---|------|----------|----------|
| B11 | Fresh worker session, on consent modal tap "Skip — check in without sharing" | Modal closes, GPS pings stop, clock-in still proceeds | [TBD] |
| B12 | Verify in DB: `select consented from worker_location_consents where worker_id='<your-uuid>' order by signed_at desc limit 1` | `false` | [TBD] |

**Notes / issues:** [TBD]

### C. Worker flow

| # | Step | Expected | Observed |
|---|------|----------|----------|
| C1 | After login, see project list / clock-in card | List of assigned projects | [TBD: how many shown] |
| C2 | Header shows worker name + "Ready to start" (or active timer) | Yes | [TBD] |
| C3 | Tap a project → tap Clock In | Spinner → success banner + tone | [TBD] |
| C4 | Header changes to `<project name> • <00:00:00>` | Yes (timer ticks each second) | [TBD] |
| C5 | Tap Camera button → take photo → upload | Photo appears in worker journal | [TBD] |
| C6 | Take video → upload (if `require_video=false`) | Video uploads | [TBD: file size / time] |
| C7 | Upload PDF | PDF uploads, journal entry shows file icon | [TBD] |
| C8 | Tap Clock Out | Confirmation modal → Confirm → success | [TBD] |
| C9 | Header returns to "Ready to start" | Yes | [TBD] |

**Notes / issues:** [TBD]

### D. /my-tasks

| # | Step | Expected | Observed |
|---|------|----------|----------|
| D1 | Worker bottom nav → "Задачи" / Tasks | `/my-tasks` loads | [TBD] |
| D2 | DevTools console on first load | Zero `Hydration failed` / `Text content did not match` | [TBD] |
| D3 | List of tasks assigned to this worker | Shown with project name | [TBD: how many tasks] |
| D4 | Tap a task → toggle status (pending → in-progress → done) | UI updates immediately, DB persists | [TBD] |
| D5 | F5 the page | Tasks reload, status reflects DB | [TBD] |

**Notes / issues:** [TBD]

### E. Messaging

Best run as two simultaneous sessions: manager (PIN 9999, e.g. on
desktop) and worker (PIN on phone).

| # | Step | Expected | Observed |
|---|------|----------|----------|
| E1 | Manager: open `/team/<workerId>` → SendMessageForm | Form renders with priority radios | [TBD] |
| E2 | Manager: pick "Срочное" (urgent), type text, send | Green "Сообщение отправлено" | [TBD] |
| E3 | Verify in DB: `select sender_id, recipient_id, text, priority from messages order by created_at desc limit 1` | Row matches what you sent | [TBD] |
| E4 | Worker (phone): wait up to 30s OR refresh | NotificationBell badge shows `1` | [TBD] |
| E5 | Worker: tap bell → see message | Message visible with red urgent tint | [TBD] |
| E6 | Worker: tap "Понял" / Got it | Banner clears, badge decrements | [TBD] |
| E7 | Verify DB: `select read from messages where id = '<msg-uuid>'` | `true` | [TBD] |
| E8 | Try sending without entering text and without attachment | Send button disabled or no-op | [TBD] |
| E9 | Try with bad network: airplane mode → send → restore | Error banner: "Не удалось отправить — попробуй ещё раз" | [TBD] |

**Notes / issues:** [TBD]

### F. Session persistence

| # | Step | Expected | Observed |
|---|------|----------|----------|
| F1 | After login, F5 several times | Stays logged in | [TBD] |
| F2 | Close browser tab → reopen URL within 5 minutes | Stays logged in | [TBD] |
| F3 | Wait ≥1 hour, then reopen | Supabase access_token may have refreshed via proxy.ts; should still be logged in | [TBD] |
| F4 | Background the browser app for 30+ min, return | Still logged in (or graceful re-login) | [TBD] |
| F5 | Switch from Wi-Fi to cellular | No logout | [TBD] |

**Notes / issues:** [TBD]

### G. Mobile UX

| # | Step | Expected | Observed |
|---|------|----------|----------|
| G1 | All tap targets respond on first touch (numpad, bottom nav, buttons) | Yes — no double-tap needed | [TBD] |
| G2 | Scroll — no jank, no rubber-band trapping | Smooth | [TBD] |
| G3 | Modals (consent, clock-out confirm) cover full screen, no overflow | Yes | [TBD] |
| G4 | Keyboard appears for text inputs (message, signature, PIN if not numpad) | Yes | [TBD] |
| G5 | Rotate phone to landscape | Layout adapts or locks (record what happens) | [TBD] |
| G6 | "Add to Home Screen" → open from icon | Opens as standalone PWA | [TBD] |
| G7 | Standalone PWA: status bar color matches `#0f1117` (manifest theme) | [TBD] | [TBD] |
| G8 | Pinch-zoom (intentionally try) | Disabled (manifest sets `user-scalable=no`) — confirm it's disabled | [TBD] |
| G9 | Bottom nav doesn't get covered by browser chrome | Yes | [TBD] |
| G10 | Long press on photo / button | No unwanted "save image" menu on app UI | [TBD] |

**Notes / issues:** [TBD]

---

## Part 3 — Findings summary (fill after testing)

### What works
- [TBD — copy-paste from above checklist where Observed = Expected]

### What is broken
- [TBD — anything where Observed ≠ Expected, with the specific test ID like "B4: button stuck spinning, no clock-in event in DB"]

### What is unclear
- [TBD — anything you couldn't conclude — e.g. "B7: pings appear in DB but unclear if interval is exactly 20s"]

### Top 3 critical issues
1. [TBD]
2. [TBD]
3. [TBD]

---

## Appendix — useful commands

**Remote-debug phone Chrome from desktop Chrome:**
- Plug phone via USB → Settings → Developer options → USB debugging ON.
- Desktop Chrome: `chrome://inspect#devices` → click `inspect` next to the staging URL tab → DevTools opens for the phone tab.

**Remote-debug iPhone Safari from desktop Safari:**
- iPhone Settings → Safari → Advanced → Web Inspector ON.
- Plug phone via USB.
- Desktop Safari → Develop menu → \[your phone\] → tab → opens Web Inspector.

**Quickly resend a curl probe (no app touch needed):**
```bash
URL=https://check-time-five.vercel.app
curl -sI "$URL/" -o /dev/null -w "HTTP=%{http_code} LOC=%{redirect_url}\n"
# expect: HTTP=307 LOC=.../login
```

**Verify DB writes after a phone test (Supabase SQL Editor):**
```sql
-- last 5 GPS pings
select worker_id, lat, lng, accuracy, recorded_at
from public.worker_live_locations order by recorded_at desc limit 5;

-- last 5 messages
select sender_id, recipient_id, text, priority, read, created_at
from public.messages order by created_at desc limit 5;

-- last 5 consent events
select worker_id, signed_name, consented, signed_at
from public.worker_location_consents order by signed_at desc limit 5;

-- last 5 time events
select profile_id, event_type, project_id, event_time
from public.time_events order by event_time desc limit 5;
```
