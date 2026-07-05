# Server-side timezone fix — event-time display

**Branch:** `feature/server-tz-fix` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** display-formatting only. One file changed: `src/lib/worker-utils.ts`.

## Bug
Server components render on Vercel with `TZ=UTC`. The three shared event-time formatters in
`worker-utils.ts` (`formatEventTime`, `formatEventDate`, `formatDateTime`) called
`Intl.DateTimeFormat(undefined, …)` with **no `timeZone`**, so they inherited the runtime zone. On
the Overview closed-shift alerts a shift rendered as `Mon, Jun 22 · 14:54 – 02:15` (UTC) while the
edit dialog correctly showed `07:54 → 19:15` local (PDT). This was also a latent
hydration-mismatch class (server UTC vs. client local).

## Fix
1. Introduced one source of truth in `worker-utils.ts` (client-safe, where the formatters live):
   ```ts
   export const ORG_TIMEZONE = "America/Los_Angeles"; // company is in Washington state (US Pacific)
   ```
2. Added `timeZone: ORG_TIMEZONE` to all three formatters. Nothing else changed — date/time
   components and `hourCycle: "h23"` are untouched.

This fixes the reported Overview row and every caller of these helpers (server and client), makes
server and client output identical, and shows org time regardless of a phone's zone (desired).

### Verification (reported example)
`clockIn 2026-06-22T14:54Z → 7:54`, date `Mon, Jun 22`; `clockOut 2026-06-23T02:15Z → 19:15`;
duration `681 min = 11h 21m` **unchanged** (duration is computed from the ISO delta, not from
formatting — not touched).

### Note on the constant / "one source of truth"
`worker-utils.ts` is imported by both server and client code, so the constant must live in a
client-safe module — it cannot import the existing `ORG_TIME_ZONE` from `src/lib/ai/service.ts`
(that file is `import "server-only"`). Two other modules already hardcode the same value:
- `src/lib/ai/service.ts:54` — `ORG_TIME_ZONE = "America/Los_Angeles"` (used for the AI daily-report
  date key; already timezone-aware, not a display bug).
- `src/lib/manager-utils.ts:274` — `DEFAULT_PAYROLL_TIME_ZONE = "America/Los_Angeles"` (payroll
  day-key math; already timezone-aware, not a display bug).
Consolidating all three onto the new `ORG_TIMEZONE` is a reasonable follow-up but was left out to
keep this diff minimal and display-only.

## Step-3 audit — other SERVER-side offenders (LIST ONLY, not changed)
Searched every `src/app/**` server component (no `"use client"`) for event-time formatting without an
explicit `timeZone`. All other event times route through the three helpers above (now fixed). The
remaining **inline** server-side formatters of the same bug class are:

1. **`src/app/(manager)/command-center/page.tsx:~332`** — `auditDateFormatter`
   (`new Intl.DateTimeFormat(locale…, { month, day, hour, minute })`, no `timeZone`) formats
   audit-log timestamps. Server component → renders in UTC.
2. **`src/app/(manager)/archive/projects/[id]/page.tsx`** — `new Date(...).toLocaleString(dateLocale, { hourCycle: "h23" })`
   with no `timeZone` on: session **clock-in** (~L301), session **clock-out** (~L304), task
   **completed_at** (~L352). Server component → renders in UTC.

Not offenders (excluded): `location-data/page.tsx` and `reports/annual/AnnualReportClient.tsx` are
client components (`"use client"`); `ai/service.ts` and `manager-utils.ts` already pass a `timeZone`.

These two files should be batched separately (they're outside the three helpers). Fixing them would
mean passing `timeZone: ORG_TIMEZONE` to their inline formatters — same one-line pattern.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 886 passed (124 files)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
