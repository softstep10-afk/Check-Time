# Supabase Step 0 Results Alpha-7

Date: 2026-05-29

Production project ref audited: `vlrajjwbaxikbwvqdpft`

Mode: Supabase SQL Editor, read-only audit. The SQL Editor role displayed by Supabase was `postgres`.

## Summary

Codex completed a SELECT-only Supabase Step 0 audit through the Supabase SQL Editor. No write SQL was executed.

High-level result:

- Expected Alpha-7 core public tables checked: 19.
- Expected Alpha-7 core public tables present: 19.
- Expected Alpha-7 core public tables with RLS enabled: 19.
- Media bucket exists, is private, and has no Storage delete policy.
- Original audit found important hardening risks around broad table grants,
  bucket-wide authenticated Storage read/upload policies, and incomplete Safety
  Brief signature fields. Post-audit owner-approved Storage Phase 1 hardening
  replaced the bucket-wide Storage policies with org/app-row scoped policies.
- Post-audit owner-approved grants hardening removed anonymous write-like grants
  and removed unnecessary authenticated `TRUNCATE` / `REFERENCES` / `TRIGGER`
  grants while preserving authenticated app behavior under RLS.
- No P0 destructive/data-loss finding was confirmed.
- Do not apply fixes blindly. All recommended fixes need a separate owner-approved hardening task.

## A. Access Method Used

Access method:

- Supabase dashboard SQL Editor.
- Project: `vlrajjwbaxikbwvqdpft`.
- Displayed SQL role: `postgres`.
- Query type used: `SELECT` only.

Commands deliberately not run:

- `INSERT`
- `UPDATE`
- `DELETE`
- `TRUNCATE`
- `ALTER`
- `DROP`
- `CREATE POLICY`
- `DROP POLICY`
- `GRANT`
- `REVOKE`
- migrations
- `00099_wash_and_reset.sql`

No secrets, passwords, tokens, service-role keys, database URLs, PINs, or private credentials were printed.

## B. Exact SELECT Queries

The following exact SELECT-only query groups were run or attempted.

### Session

```sql
select current_user as current_user, current_database() as database_name;
```

Result: `current_user = postgres`, `database_name = postgres`.

### Applied migrations, standard Supabase CLI table

```sql
select
  count(*) as applied_count,
  min(version::text) as first_version,
  max(version::text) as latest_version,
  bool_or(version::text like '%00099%' or version::text ilike '%wash%') as wash_reset_applied
from supabase_migrations.schema_migrations;
```

Result: failed read-only with `relation "supabase_migrations.schema_migrations" does not exist`.

### Migration table lookup

```sql
select table_schema, table_name
from information_schema.tables
where table_schema ilike '%migration%'
   or table_name ilike '%migration%'
order by table_schema, table_name;
```

Result:

- `auth.schema_migrations`
- `realtime.schema_migrations`
- `storage.migrations`
- `supabase_functions.migrations`

No `supabase_migrations.schema_migrations` table was present.

### Expected table presence

```sql
with expected(table_name) as (
  values
    ('organizations'),
    ('profiles'),
    ('projects'),
    ('project_assignments'),
    ('project_exclusions'),
    ('tasks'),
    ('messages'),
    ('media'),
    ('time_events'),
    ('worker_live_locations'),
    ('worker_location_consents'),
    ('safety_acknowledgements'),
    ('audit_log'),
    ('user_capabilities'),
    ('payroll_runs'),
    ('payroll_line_items'),
    ('payroll_closures'),
    ('pay_periods'),
    ('pay_period_items')
),
found as (
  select
    expected.table_name,
    t.table_name is not null as exists_in_public_schema
  from expected
  left join information_schema.tables t
    on t.table_schema = 'public'
   and t.table_name = expected.table_name
)
select
  count(*) as expected_count,
  count(*) filter (where exists_in_public_schema) as existing_count,
  coalesce(string_agg(table_name, ', ' order by table_name) filter (where not exists_in_public_schema), '') as missing_tables
from found;
```

Result: `expected_count = 19`, `existing_count = 19`, `missing_tables = ''`.

### RLS enabled state

```sql
with expected(table_name) as (
  values
    ('organizations'),
    ('profiles'),
    ('projects'),
    ('project_assignments'),
    ('project_exclusions'),
    ('tasks'),
    ('messages'),
    ('media'),
    ('time_events'),
    ('worker_live_locations'),
    ('worker_location_consents'),
    ('safety_acknowledgements'),
    ('audit_log'),
    ('user_capabilities'),
    ('payroll_runs'),
    ('payroll_line_items'),
    ('payroll_closures'),
    ('pay_periods'),
    ('pay_period_items')
),
state as (
  select
    expected.table_name,
    c.relname is not null as table_exists,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    coalesce(c.relforcerowsecurity, false) as rls_forced
  from expected
  left join pg_class c
    on c.relname = expected.table_name
   and c.relkind = 'r'
  left join pg_namespace n
    on n.oid = c.relnamespace
   and n.nspname = 'public'
)
select
  count(*) filter (where table_exists) as table_count,
  count(*) filter (where table_exists and rls_enabled) as rls_enabled_count,
  coalesce(string_agg(table_name, ', ' order by table_name) filter (where table_exists and not rls_enabled), '') as rls_disabled_tables,
  coalesce(string_agg(table_name, ', ' order by table_name) filter (where not table_exists), '') as missing_tables
from state;
```

Result: `table_count = 19`, `rls_enabled_count = 19`, no missing or RLS-disabled expected tables.

### All public RLS-disabled tables

```sql
select
  count(*) as rls_disabled_count,
  coalesce(string_agg(n.nspname || '.' || c.relname, ', ' order by n.nspname, c.relname), '') as rls_disabled_tables
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and not c.relrowsecurity;
```

Result: `public.spatial_ref_sys` only.

### Public RLS policy count

```sql
select
  count(*) as public_policy_count,
  count(distinct tablename) as public_tables_with_policies
from pg_policies
where schemaname = 'public';
```

Result: `64` public policies across `24` public tables.

### Critical RLS policy summary

```sql
select
  count(*) as policy_count,
  count(distinct tablename) as tables_with_policies,
  coalesce(string_agg(tablename || ':' || policy_count::text, ', ' order by tablename), '') as policies_by_table
from (
  select tablename, count(*) as policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'organizations',
      'profiles',
      'projects',
      'project_assignments',
      'project_exclusions',
      'tasks',
      'messages',
      'media',
      'time_events',
      'worker_live_locations',
      'worker_location_consents',
      'safety_acknowledgements',
      'audit_log',
      'user_capabilities',
      'payroll_runs',
      'payroll_line_items',
      'payroll_closures',
      'pay_periods',
      'pay_period_items'
    )
  group by tablename
) s;
```

Result: `19` policies across `19` critical tables.

### Storage bucket configuration

```sql
select
  count(*) as bucket_count,
  coalesce(
    string_agg(
      id || ':public=' || public::text || ':limit=' || coalesce(file_size_limit::text, 'null') || ':mimes=' || coalesce(array_to_string(allowed_mime_types, ','), 'null'),
      ' | '
      order by id
    ),
    ''
  ) as buckets
from storage.buckets;
```

Result: `media:public=false:limit=524288000:mimes=null`.

### Storage policy details

```sql
select
  coalesce(
    string_agg(
      policyname || ':' || cmd || ':roles=' || roles::text || ':using=' || coalesce(qual, '') || ':check=' || coalesce(with_check, ''),
      ' || '
      order by policyname
    ),
    ''
  ) as storage_policy_details
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects';
```

Result:

- `authenticated can read media`, `SELECT`, role `{authenticated}`, using `(bucket_id = 'media')`.
- `authenticated can upload to media`, `INSERT`, role `{authenticated}`, check `(bucket_id = 'media')`.

### Storage and media delete policy counts

```sql
select
  count(*) as storage_delete_policy_count,
  coalesce(string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname), '') as delete_policies
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd in ('DELETE', 'ALL');
```

```sql
select
  count(*) as media_delete_policy_count,
  coalesce(string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname), '') as delete_policies
from pg_policies
where schemaname = 'public'
  and tablename = 'media'
  and cmd in ('DELETE', 'ALL');
```

Result: both counts were `0`.

### Grants / privileges

```sql
select
  count(*) as anon_write_grant_count,
  coalesce(
    string_agg(table_schema || '.' || table_name || ':' || privilege_type, ' | ' order by table_schema, table_name, privilege_type),
    ''
  ) as anon_write_grants
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee = 'anon'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
```

```sql
select
  count(*) as authenticated_write_grant_count,
  coalesce(
    string_agg(table_schema || '.' || table_name || ':' || privilege_type, ' | ' order by table_schema, table_name, privilege_type),
    ''
  ) as authenticated_write_grants
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');
```

Result:

- `anon_write_grant_count = 186`
- `authenticated_write_grant_count = 186`

These are table-level grants. RLS is enabled on the 19 critical tables, but the grant surface is still broad and should be hardened carefully in a separate task.

### Security-definer functions

```sql
select
  count(*) as security_definer_count,
  coalesce(
    string_agg(p.proname || ':config=' || coalesce(array_to_string(p.proconfig, ','), ''), ' | ' order by p.proname),
    ''
  ) as security_definer_configs
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef;
```

Result: `12` security-definer functions.

Custom helper functions without pinned function config:

- `get_user_org_id`
- `get_user_role`
- `is_manager`

Their bodies use `public.profiles`, which reduces immediate search-path risk, but pinned `search_path` is still recommended.

### Role enum

```sql
select
  coalesce(string_agg(e.enumlabel, ', ' order by e.enumsortorder), '') as user_role_values
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname = 'user_role';
```

Result: `worker, supervisor, driver, subcontractor, manager, admin, owner, sales`.

### Consent and safety columns

```sql
select
  table_name,
  count(*) as column_count,
  string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as columns
from information_schema.columns
where table_schema = 'public'
  and table_name in ('worker_location_consents', 'safety_acknowledgements')
group by table_name
order by table_name;
```

Result:

- `worker_location_consents`: `id`, `org_id`, `worker_id`, `signed_name`, `consented`, `consent_version`, `user_agent`, `ip_address`, `signed_at`.
- `safety_acknowledgements`: `id`, `org_id`, `worker_id`, `project_id`, `safety_version`, `acknowledged_at`, `check_in_event_id`.

### Sensitive audit/payroll/time-event counts

```sql
select 'worker_location_consents' as table_name, count(*) as row_count from public.worker_location_consents
union all
select 'safety_acknowledgements' as table_name, count(*) as row_count from public.safety_acknowledgements
union all
select 'pay_periods' as table_name, count(*) as row_count from public.pay_periods
union all
select 'pay_period_items' as table_name, count(*) as row_count from public.pay_period_items
union all
select 'payroll_runs' as table_name, count(*) as row_count from public.payroll_runs
union all
select 'payroll_line_items' as table_name, count(*) as row_count from public.payroll_line_items
union all
select 'payroll_closures' as table_name, count(*) as row_count from public.payroll_closures
union all
select 'time_events' as table_name, count(*) as row_count from public.time_events
union all
select 'audit_log' as table_name, count(*) as row_count from public.audit_log;
```

Result:

- `worker_location_consents`: 15
- `safety_acknowledgements`: 77
- `pay_periods`: 1
- `pay_period_items`: 6
- `payroll_runs`: 1
- `payroll_line_items`: 1
- `payroll_closures`: 1
- `time_events`: 149
- `audit_log`: 294

### Payroll policy details

```sql
select
  coalesce(
    string_agg(
      tablename || '.' || policyname || ':' || cmd || ':roles=' || roles::text || ':using=' || left(coalesce(qual, ''), 180) || ':check=' || left(coalesce(with_check, ''), 180),
      ' || '
      order by tablename, policyname
    ),
    ''
  ) as payroll_policy_details
from pg_policies
where schemaname = 'public'
  and tablename in ('pay_periods', 'pay_period_items', 'payroll_runs', 'payroll_line_items', 'payroll_closures');
```

Result summary:

- Payroll/pay-period write access is guarded by `has_finance_access()` and org checks.
- Worker payroll closure SELECT is limited by `profile_id = auth.uid()` and `org_id = get_user_org_id()`.

### Archive / trash columns

```sql
select
  table_name,
  string_agg(column_name || ':' || data_type, ', ' order by ordinal_position) as archive_columns
from information_schema.columns
where table_schema = 'public'
  and table_name in ('projects', 'tasks', 'messages', 'media', 'time_events')
  and column_name in ('status', 'archived_at', 'archived_by', 'deleted_at', 'deleted_by', 'trashed_at', 'trashed_by')
group by table_name
order by table_name;
```

Result:

- `projects`: `status`, `deleted_at`, `archived_at`, `archived_by`
- `tasks`: `status`, `deleted_at`
- `media`: `deleted_at`

### Critical column presence

```sql
with expected(table_name, column_name) as (
  values
    ('projects', 'timeline_status'),
    ('projects', 'budget_status'),
    ('projects', 'settings'),
    ('tasks', 'metadata'),
    ('tasks', 'assigned_to'),
    ('messages', 'sender_id'),
    ('messages', 'recipient_id'),
    ('messages', 'read_at'),
    ('media', 'storage_path'),
    ('media', 'mime_type'),
    ('media', 'project_id'),
    ('media', 'task_id'),
    ('worker_location_consents', 'signed_name'),
    ('worker_location_consents', 'consent_version'),
    ('worker_location_consents', 'signed_at'),
    ('safety_acknowledgements', 'signature_name'),
    ('safety_acknowledgements', 'safety_version'),
    ('safety_acknowledgements', 'acknowledged_at'),
    ('pay_periods', 'status'),
    ('time_events', 'project_id')
),
found as (
  select
    expected.table_name,
    expected.column_name,
    c.column_name is not null as exists_in_production
  from expected
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = expected.table_name
   and c.column_name = expected.column_name
)
select
  count(*) as expected_columns,
  count(*) filter (where exists_in_production) as existing_columns,
  coalesce(string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name) filter (where not exists_in_production), '') as missing_columns
from found;
```

Result: missing columns:

- `media.task_id`
- `messages.read_at`
- `projects.budget_status`
- `projects.timeline_status`
- `safety_acknowledgements.signature_name`

Follow-up column inventory confirmed:

- `messages` uses `read:boolean`, not `read_at`.
- `media` has `metadata:jsonb`; task reverse-linking is expected to use `metadata.task_id`.
- `projects` has `settings:jsonb`, `start_date`, `end_date`, `gps_radius_m`, but no `timeline_status` / `budget_status`.
- `safety_acknowledgements` has no typed signature name field.

## C. Applied Migrations

Finding:

- The standard app migration table `supabase_migrations.schema_migrations` does not exist in production.
- Supabase internal migration tables exist for `auth`, `realtime`, `storage`, and `supabase_functions`.
- Applied app migration lineage cannot be confirmed through the expected Supabase CLI migration table.

Risk classification: P2.

Reason:

- Core schema appears present from table/column inspection.
- However, release audits cannot prove migration lineage or whether local migrations match production history.

Recommended fix:

- Establish a migration tracking source of truth before future schema work.
- Do not backfill or create migration history blindly.

## D. RLS Findings

Confirmed good state:

- All 19 expected Alpha-7 core public tables exist.
- All 19 expected Alpha-7 core public tables have RLS enabled.
- Critical RLS policy coverage exists across those 19 tables.

Notable finding:

- `public.spatial_ref_sys` has RLS disabled.

Risk classification:

- `public.spatial_ref_sys`: P3, likely PostGIS reference data, not an app data table.

No confirmed RLS P0.

## E. Storage Findings

Confirmed:

- One bucket: `media`.
- Bucket is private: `public=false`.
- File size limit: `524288000` bytes.
- `allowed_mime_types = null`.
- Storage object policies:
  - authenticated users can read objects in the `media` bucket.
  - authenticated users can upload objects to the `media` bucket.
- No Storage DELETE policy exists for `storage.objects`.
- No public `media` table DELETE policy exists.

P1 finding:

- Storage object SELECT and INSERT policies are bucket-wide for all authenticated users and are not org/path scoped at the Storage policy layer.

Why this matters:

- App metadata/RLS may hide media rows, but authenticated direct Storage access could potentially read a known object path across orgs if paths are guessable or leaked.
- Upload is also bucket-wide for authenticated users, though app/server metadata checks may still guard normal UI flows.

Recommended fix:

- Separate owner-approved Storage hardening task.
- Prefer org-scoped object paths and Storage policies that validate path prefix against the authenticated user's org/profile.
- Preserve existing upload/open/download behavior and Andrey/Sergey app-level media delete semantics.
- Do not add a DELETE Storage policy unless explicitly needed and separately guarded.

Prerequisite follow-up prepared locally:

- New direct/private message attachments should use `<org_id>/messages/<recipient_id>/<timestamp>-<safeName>` instead of legacy `messages/<recipient_id>/...`.
- Existing legacy message attachments remain supported through the stored `messages.attachment.storagePath`; no old objects or message rows are rewritten.
- After this app change is deployed and manually QA'd, the next owner-approved hardening step is Storage Phase 1 policy tightening.

Post-audit Storage Phase 1 update:

- Owner-approved Storage Phase 1 was applied after org-prefixed message
  attachment paths were deployed.
- Broad policies `authenticated can read media` and `authenticated can upload
  to media` were replaced.
- Active Storage policies are now `media objects read through linked app rows`
  for SELECT and `media objects upload org scoped` for INSERT.
- Legacy `messages/...` attachments remain readable through
  `public.messages.attachment.storagePath`.
- New Storage uploads must use the authenticated user's org id as the first
  path segment.
- No Storage DELETE policy was added; the `media` bucket remains private.

## F. Grants Findings

Confirmed:

- `anon` has broad table-level write grants on public/storage objects: 186 grant rows.
- `authenticated` has broad table-level write grants on public/storage objects: 186 grant rows.
- RLS is enabled on the 19 expected critical public tables, which mitigates the broad grant surface for normal PostgREST access.

P1 finding:

- Table-level grants are broader than ideal for defense in depth, especially because they include sensitive tables such as payroll, time events, tasks, messages, media, audit, and Storage tables.

Why this matters:

- RLS is the primary protection right now.
- Any future overly broad policy could become dangerous faster because the underlying grants are already permissive.
- Blindly revoking grants could break the app, so this must be tested carefully.

Recommended fix:

- Separate owner-approved grants hardening task.
- Build a privilege matrix first.
- Revoke only privileges proven unnecessary.
- Retest login, tasks, messages, media upload/open/download, payroll views, GPS/shift flows, and owner/admin routes.

Post-audit grants hardening update:

- Owner-approved migration `00030_database_grants_hardening.sql` was applied.
- `anon` write-like grants were revoked on public/storage relations:
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`.
- `authenticated` grants were narrowed by revoking relation privileges the app
  does not use directly: `TRUNCATE`, `REFERENCES`, `TRIGGER`.
- `authenticated` SELECT/INSERT/UPDATE/DELETE were preserved because the app
  still uses RLS-controlled Supabase client writes for owner/manager/worker/driver
  workflows.
- Verification after apply showed app-owned public table grant surface closed:
  `app_anon_write_remaining = 0` and
  `app_authenticated_restricted_remaining = 0`.
- Residual explicit grants remain on Supabase-managed/PostGIS reference
  relations (`geometry_columns`, `geography_columns`, `spatial_ref_sys`) and
  Storage metadata relations. These are managed by `supabase_admin` /
  `supabase_storage_admin`, while the SQL Editor session runs as `postgres` and
  is not a member of those roles. Storage object access remains constrained by
  the Phase 1 Storage policies.

## G. Schema Mismatch

Confirmed missing expected/legacy columns:

- `projects.timeline_status`
- `projects.budget_status`
- `messages.read_at`
- `media.task_id`
- `safety_acknowledgements.signature_name`

Interpretation:

- `projects.timeline_status` and `projects.budget_status`: app has optional fallback handling for missing project status columns in `src/lib/project-save.ts`, so this is not currently a release blocker by itself.
- `messages.read_at`: production uses `messages.read:boolean`; current message status behavior should rely on `read`, not `read_at`.
- `media.task_id`: production uses `media.metadata:jsonb`; local code links task attachments through `metadata.task_id`.
- `safety_acknowledgements.signature_name`: important legal/audit gap because Safety Brief records do not store a typed signature name like GPS consent does.

Risk classification:

- Safety Brief missing typed signature name: P1.
- Project optional status columns absent: P2.
- Message/media alternate schema shape: P2, currently expected if app code uses `read` and `metadata.task_id`.

Recommended fixes:

- Safety Brief signature storage should be handled in a separate owner-approved schema/migration task.
- Do not add project timeline/budget columns unless the owner wants those fields to become first-class persisted production data.

## H. Service-Role Risks

Database-side findings:

- Service-role clients bypass RLS by design.
- Production RLS/grants now show that RLS exists, but broad grants and broad Storage policies increase the importance of server-side guards.

Local route-map scripts should remain part of every deploy gate:

```bash
npm run inventory:service-role
npm run alpha7:route-mutation-map --if-present
```

P1 risk:

- Any service-role route missing server-side actor/org/resource/role guards can bypass the otherwise enabled RLS model.

Recommended fix:

- Continue route-by-route hardening.
- Prioritize media, tasks/materials, team/profile updates, payroll/archive, and project mutation routes.

## I. Consent / Safety Table Verification

GPS consent table:

- `worker_location_consents` exists.
- Rows: 15.
- Fields include:
  - `org_id`
  - `worker_id`
  - `signed_name`
  - `consented`
  - `consent_version`
  - `user_agent`
  - `ip_address`
  - `signed_at`

Safety acknowledgement table:

- `safety_acknowledgements` exists.
- Rows: 77.
- Fields include:
  - `org_id`
  - `worker_id`
  - `project_id`
  - `safety_version`
  - `acknowledged_at`
  - `check_in_event_id`

P1 finding:

- Safety acknowledgement records do not include typed signer name / signature field.

Recommended fix:

- Separate owner-approved schema migration to add a typed safety signature field and, if desired, user agent/IP fields.
- Preserve existing rows and do not overwrite prior acknowledgements.

## J. Payroll / Archive Verification

Confirmed:

- Payroll/pay-period tables exist:
  - `pay_periods`
  - `pay_period_items`
  - `payroll_runs`
  - `payroll_line_items`
  - `payroll_closures`
- Row counts are nonzero, confirming production payroll/archive data exists and must not be touched casually.
- Payroll policies are finance-gated through `has_finance_access()` and org checks.
- Worker payroll closure SELECT is scoped to own profile/org.

Archive/trash columns:

- `projects`: `status`, `deleted_at`, `archived_at`, `archived_by`
- `tasks`: `status`, `deleted_at`
- `media`: `deleted_at`

No payroll/archive data was changed.

## K. Release Blockers

No P0 blocker was confirmed.

P1 security/hardening blockers before full security signoff:

1. `safety_acknowledgements` lacks typed signature name storage, which is a legal/audit gap for Safety Brief acknowledgements.

These do not require an emergency blind fix, but they should be addressed before declaring Supabase production security fully hardened.

Closed after original audit:

- Storage `media` bucket policies no longer allow bucket-wide authenticated
  read/upload; Phase 1 hardening is applied.
- Broad unnecessary grants were narrowed: anonymous write-like grants removed,
  authenticated `TRUNCATE` / `REFERENCES` / `TRIGGER` removed.
- Residual managed extension/storage metadata grants are tracked separately and
  should not be force-revoked without Supabase-supported role access.

## L. P1 / P2 / P3 Findings

### P1

- Safety Brief acknowledgement table lacks typed signature name.

Closed P1:

- Bucket-wide authenticated Storage read/upload policies on `storage.objects`
  for `media` were replaced by Storage Phase 1 hardening.
- Broad unnecessary `anon` / `authenticated` grants were reduced by grants
  hardening. Authenticated RLS-controlled SELECT/INSERT/UPDATE/DELETE remain by
  design for current app behavior.
- App-owned public tables now report zero anonymous write-like grants and zero
  authenticated `TRUNCATE` / `REFERENCES` / `TRIGGER` grants.

### P2

- `supabase_migrations.schema_migrations` is absent, so app migration history is not directly verifiable.
- Custom security-definer helpers `get_user_org_id`, `get_user_role`, and `is_manager` do not pin function `search_path`; bodies use `public.profiles`, which reduces immediate risk.
- `projects.timeline_status` and `projects.budget_status` are absent; app currently has optional fallback behavior.
- `storage.buckets.allowed_mime_types` is null, so MIME allow-listing is app-side rather than bucket-side.

### P3

- `public.spatial_ref_sys` has RLS disabled; likely PostGIS reference data.
- Migration audit process needs a repeatable SQL export workflow.

## M. What Was NOT Changed

The list below describes the original SELECT-only Step 0 audit. Later
owner-approved hardening tasks changed Storage policies and database grants
only; they did not delete or move files and did not mutate production table
rows.

- No deploy.
- No app code edits.
- No production data mutations.
- No `INSERT`.
- No `UPDATE`.
- No `DELETE`.
- No `TRUNCATE`.
- No `ALTER`.
- No `DROP`.
- No `CREATE POLICY`.
- No `DROP POLICY`.
- No `GRANT`.
- No `REVOKE`.
- No migrations.
- No schema changes.
- No RLS changes.
- No Storage policy changes during the original Step 0 audit.
- No payroll data changes.
- No `time_events` changes.
- No paid-period changes.
- No archive/trash data changes.
- No `00099_wash_and_reset.sql`.

## N. Recommended Fixes

Do these as separate owner-approved tasks, in this order:

1. Storage policy hardening: completed for Phase 1.
   - Org/app-row scoped SELECT policy applied.
   - Org-prefixed INSERT policy applied.
   - Legacy message attachment read compatibility preserved.
   - No Storage DELETE policy added.

2. Grants hardening:
   - Completed for the unnecessary broad grant surface found in Step 0.
   - Anonymous write-like grants removed.
   - Authenticated `TRUNCATE` / `REFERENCES` / `TRIGGER` removed.
   - Authenticated app-required RLS-controlled privileges preserved.
   - Managed PostGIS/Storage metadata grants remain as platform-controlled
     residuals and should not be changed blindly.

3. Safety Brief legal signature migration:
   - Add typed signer name field to `safety_acknowledgements`.
   - Optionally add user agent/IP fields.
   - Preserve existing 77 acknowledgement rows.

4. Security-definer function hardening:
   - Pin `search_path` on custom helper functions.
   - Verify RLS policies still evaluate correctly.

5. Migration lineage:
   - Decide whether to introduce or document an app migration ledger.
   - Do not fabricate migration history.
