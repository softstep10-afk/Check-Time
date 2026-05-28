# Supabase Step 0 Results Alpha-7

Date: 2026-05-28

Mode: read-only database / Storage / RLS audit attempt.

Production project ref requested: `vlrajjwbaxikbwvqdpft`

## A. Access Method Used

Audit status: blocked before SQL.

Checked access methods without printing secrets:

- `DATABASE_URL`: not present in process environment.
- `POSTGRES_URL`: not present in process environment.
- `SUPABASE_DB_URL`: not present in process environment.
- `SUPABASE_ACCESS_TOKEN`: not present in process environment.
- `psql`: not installed/available in PATH.
- Supabase CLI: not installed/available in PATH.
- Supabase dashboard session: not active; dashboard redirected to sign-in for project `vlrajjwbaxikbwvqdpft`.
- `.env.local`: contains app Supabase URL/key entries and a service-role key entry, but not a direct Postgres connection URL. Values were not printed.

Because no safe SQL channel was available, the required transaction could not be started:

```sql
BEGIN TRANSACTION READ ONLY;
```

Per task safety rules, the database audit stopped here. No production SQL was run.

## B. Applied Migrations

Audit completed: no.

Reason: `supabase_migrations.schema_migrations` requires direct database SQL access. No read-only transaction was possible.

Local migration files remain visible in the repo, including:

- `supabase/migrations/00001_foundation.sql`
- `supabase/migrations/00002_rls_policies.sql`
- Later Alpha-7 migrations through `00028_pin_login_rate_limit.sql`
- Known dangerous local file: `supabase/migrations/00099_wash_and_reset.sql`

Findings:

- Applied production migrations were not verified.
- Local migrations not applied in production were not verified.
- Applied migrations not present locally were not verified.
- `00099_wash_and_reset.sql` was not run and must not be run.

## C. RLS Policy Summary

Audit completed: no.

Reason: `pg_policies`, `pg_class.relrowsecurity`, and policy expressions require direct SQL or authenticated Supabase dashboard SQL access.

Requested policy areas not verified:

- `profiles`
- `projects`
- `tasks`
- `messages`
- `media`
- `time_events`
- `worker_location_consents`
- `safety_acknowledgements`
- `pay_periods`
- `audit_log`
- `storage.objects`

Risk:

- Production RLS may drift from local migration expectations.
- This remains a release/security blocker for declaring database policy state fully verified.

## D. Storage Policy Summary

Audit completed: no.

Reason: `storage.buckets` and Storage policy inspection require direct SQL/dashboard access.

Not verified:

- Media bucket public/private state.
- Media bucket file size limit.
- Media bucket MIME restrictions.
- Storage `objects` select/insert/update/delete policies.
- Whether worker/manager/owner access matches app expectations.
- Whether delete remains constrained consistently with the app-level Andrey/Sergey/configured helper.

## E. Grants Summary

Audit completed: no.

Reason: `information_schema.role_table_grants` and function execute grants require direct SQL access.

Not verified:

- `anon` table privileges.
- `authenticated` table privileges.
- `service_role` grant scope.
- Function execute grants.
- Unexpected public write privileges.

## F. Schema Mismatch Findings

Audit completed: no.

Reason: production `information_schema.columns` was not accessible.

Not verified against production:

- `projects.timeline_status`
- `projects.budget_status`
- `projects.settings` for project notes/settings
- task metadata/storage columns
- media linkage and upload/open/download fields
- `worker_location_consents`
- `safety_acknowledgements`
- payroll/archive tables
- `deleted_at` / `status` fields for archive/trash separation

Current local code/tests indicate expected coverage exists, but production schema remains unconfirmed.

## G. Service-Role Route Risk Map

Database audit completed: no.

Local static inventory remains available through:

```bash
npm run inventory:service-role
npm run alpha7:route-mutation-map --if-present
```

Route groups requiring continued review:

- Team create/delete/reset-pin/update-profile.
- Project create/update/archive/planning.
- Task/material routes.
- Media routes and helpers.
- Worker project notes.
- Jarvis actions.
- Auth PIN login.
- Storage/media helpers.

Current local route map mostly classifies critical routes as guarded, but production database policies and grants were not verified. Service-role bypass remains a high-impact area because service-role clients bypass RLS by design.

Status:

- Confirmed safe: not fully confirmable without production SQL/RLS/grant state.
- Needs review: yes, through Step 0 access.
- Release blocker: yes for database-security signoff.
- Not blocker for docs-only work.

## H. Consent / Safety Storage

Audit completed: no.

Not verified:

- `worker_location_consents` fields.
- `safety_acknowledgements` fields.
- worker/profile/org linkage.
- version fields.
- timestamp fields.
- signed name fields.
- accepted/skipped storage logic.
- owner review/export compatibility against production schema.

Local app/docs indicate GPS consent and Safety Brief audit flows exist, but production table shape and policies remain unverified.

## I. Payroll / Archive Preservation

Audit completed: no.

Not verified:

- `pay_periods`
- `pay_period_items`
- `payroll_runs`
- `payroll_line_items`
- `payroll_closures`
- archive/trash production table state
- RLS over payroll/archive data
- grants over payroll/archive data
- destructive cascade risks in production

No payroll data, time events, paid periods, archive rows, trash rows, or production data were modified.

## J. Release Blockers

P1 release/security blockers:

1. No direct production SQL access was available, so Step 0 could not verify applied migrations, RLS policies, Storage policies, grants, schema, or payroll/archive table state.
2. Supabase dashboard session was not active; dashboard redirected to sign-in.
3. `psql` and Supabase CLI are unavailable in the environment.
4. No direct DB URL was present in the process environment or `.env.local`.

No P0 finding was confirmed because no database inspection could be performed.

## K. P1 / P2 / P3 Risks

### P1

- Production RLS/Storage/grants/applied migration state remains unverified.
- Service-role route safety cannot be fully reconciled against real production database policy/grant state.
- Payroll/archive RLS and table state remain unverified.

### P2

- Consent/safety audit table shape and owner review compatibility remain unverified.
- Media bucket private/public state, upload limits, MIME config, and delete/read/write policies remain unverified.
- Schema mismatch between code expectations and production DB remains unverified.

### P3

- Local Supabase CLI and `psql` are missing, slowing future read-only audits.
- A read-only Step 0 checklist exists but still requires an actual access channel.

## L. Recommended Next Actions

1. Owner provides one safe access path:
   - a temporary production Postgres connection URL with read-only role, or
   - an active Supabase dashboard session with SQL Editor access, or
   - Supabase CLI access plus credentials sufficient to run read-only SQL.
2. Confirm project ref is `vlrajjwbaxikbwvqdpft`.
3. Start every SQL audit with:

```sql
BEGIN TRANSACTION READ ONLY;
```

4. Run the read-only queries from `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`.
5. End with:

```sql
ROLLBACK;
```

6. Only after confirmed P0/P1 findings, prepare minimal idempotent migration/fix for owner review before applying.

## M. What Was NOT Done

- No production SQL was run.
- No read-only transaction was opened because no SQL channel was available.
- No migrations were run.
- No migration files were created.
- No schema changes were made.
- No RLS policies were changed.
- No Storage policies were changed.
- No grants were changed.
- No production data was inserted, updated, deleted, or selected through SQL.
- No payroll data was changed.
- No `time_events` were changed.
- No paid periods were changed.
- No archive/trash data was changed.
- No service-role key, password, token, database URL, or secret value was printed.

