# S-M1 — explicit org scoping on money-reading paths (belt-and-suspenders)

Branch: `claude/org-scope-belt` (off `claude/owner-dashboard-cleanup-rebased`).

**Goal.** Money/PII-reading routes rely on RLS to keep them inside the caller's
org. Add an explicit `.eq("org_id", …)` to every org-scoped table read so a
future RLS regression cannot leak another org's data into payroll exports or
reports. Pure narrowing — for our single-org production the result sets are
byte-for-byte identical. No query restructuring.

## Audit of the five named routes

Every read in each route was checked against the schema (only tables with an
`org_id` column need the filter — confirmed each has a `not null` `org_id`:
`profiles`, `projects`, `time_events`, `media`, `store_visits`,
`worker_live_locations`).

### Already scoped — verified, no change needed

The three pre-existing payroll routes already carry the belt on **every** read
(`profiles`, `projects`, `time_events`, `payroll_closures` each have
`.eq("org_id", org.id)`); their inserts/updates are writes, not reads, and are
keyed by `org_id` / row id already:

- `src/app/api/payroll/run/route.ts`
- `src/app/api/payroll/export/route.ts`
- `src/app/api/team/pay-worker/route.ts`

The shared `hydrateProfilesWithRates` helper (money read of `profile_rates`) is
already defended two ways: it throws if any input profile is outside the
authenticated org, and it filters `profile_rates` by `profile_id IN (…)` where
the ids come only from the org-scoped profile list. Left unchanged (shared lib,
outside the named route scope, already guarded).

### Gaps fixed — the two routes added earlier today

Both resolved the actor but did **not** fetch its `org_id`, and none of their
data reads were org-filtered. For each I widened the actor profile read to
include `org_id` and added `.eq("org_id", <actorOrgId>)` to every org-scoped
read.

**`src/app/api/reports/annual/route.ts`** (5 reads + actor)
- actor read: `select("id, role")` → `select("id, role, org_id")`; `AnnualActor`
  type gains `org_id`.
- `.eq("org_id", profile.org_id)` added to: `profiles`, `projects`,
  `time_events`, `media`, `store_visits`.

**`src/app/api/location-data/mileage/route.ts`** (4 reads + actor)
- actor read: `select("id, role")` → `select("id, role, org_id")`; actor type
  gains `org_id`.
- `.eq("org_id", actor.org_id)` added to: `profiles`, and all three
  `worker_live_locations` reads (count, oldest-record, and the paged points
  fetch).

## Why results are identical

Production runs a single organization, so `org_id = <the one org>` matches every
row the RLS-scoped query already returned. The filter only ever *removes* rows
belonging to a different org — of which there are none today — so payroll totals,
annual report figures, and mileage summaries are unchanged. The value is purely
defensive: if an RLS policy regressed, these routes would still refuse to read
across orgs.

## Gates — all green

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 7 warnings (all pre-existing, untouched files) |
| `npm test` | 124 files / 886 tests passed |
| `npm run smoke:core` | exit 0, `failures: []`, `warnings: []` |
| `npm run alpha7:predeploy` | passed |

## Scope honored
- Did not touch polling hooks, live map, manager layout, or the worker flow.
- No shared-data / RLS / grant changes; this only *adds* client-side filters to
  reads that RLS already scopes.

STOP — not committed to main, not merged, not pushed (night rule).
