# Supabase Step 0 Audit Pack Alpha-7

Purpose: prepare a future owner-approved, read-only Supabase audit. This document does not run SQL and does not change the database.

## Rules

- Run only in Supabase SQL Editor or another approved read-only database session.
- Run only after owner approval for Direct SQL Step 0.
- Do not run migrations from this pack.
- Do not edit RLS policies, Storage policies, grants, schema, functions, or production data from this pack.
- Do not paste secret values, service-role keys, database URLs, session tokens, PINs, or private credentials into reports.
- If any query fails because a catalog object is missing, record the error and stop changing nothing.

## Scope

Audit topics:

- Applied migrations.
- RLS policies and RLS enabled/forced state.
- Storage policies and media bucket configuration.
- Grants for `anon`, `authenticated`, and other roles.
- Schema/table/column mismatch.
- Service-role bypass risk areas.
- Owner, manager, worker, driver access surfaces.
- Project, tasks, media, messages, shifts.
- Payroll/archive.
- Offline queue/cache support tables where applicable.
- Safety Brief and GPS consent audit tables.

## 1. Applied Migrations

Confirm what production has actually applied.

```sql
select *
from supabase_migrations.schema_migrations
order by version;
```

Expected review:

- Latest intended migration is present.
- `00099_wash_and_reset.sql` is not applied as a normal production migration.
- Payroll/archive migrations such as `00023`, `00024`, and `00025` are either present as expected or explicitly documented as blocked.
- Safety/GPS consent migration/table support is present where required.

## 2. RLS Enabled / Forced State

Confirm RLS is enabled on critical public tables.

```sql
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and c.relname in (
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
order by c.relname;
```

Expected review:

- Tables with browser/client access have RLS enabled.
- Any table with RLS disabled is explicitly justified and tracked as a risk.
- Payroll/archive tables are not accidentally wide open.

## 3. RLS Policy Bodies

Review the policies for owner, manager, worker, driver, project, task, media, message, shift, payroll/archive, offline, and safety/GPS consent surfaces.

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
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
order by tablename, policyname;
```

Expected review:

- Owner/admin/manager permissions are intentional.
- Worker/driver policies are worker-like and do not grant manager-tier access.
- Project/task/media/message policies are org-scoped and project-access-scoped.
- Notification and message state policies do not imply source task/message deletion.
- Payroll/archive policies match finance access expectations.
- GPS consent and Safety Brief acknowledgements are readable by owner/admin audit flows and writable by the relevant worker flow.

## 4. Storage Policies

Review Storage RLS policies for buckets and objects.

```sql
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename in ('objects', 'buckets')
order by tablename, policyname;
```

Expected review:

- Media object access remains org/project/user scoped.
- Upload/open/download behavior remains allowed for approved file types.
- Delete permissions are not broadened by Storage policy.
- No Storage policy grants public write/delete access.

## 5. Media Bucket Configuration

Confirm bucket configuration and allowed file size/type state.

```sql
select
  id,
  name,
  owner,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at,
  updated_at
from storage.buckets
order by id;
```

Expected review:

- The media bucket exists.
- The bucket is not unintentionally public unless that is explicitly approved.
- PDF, Word, Excel, CSV, photo, video, and iPhone MOV/QuickTime support match app validation.
- Bucket size limits align with app upload limits.

## 6. Table Grants

Review table-level grants. This does not replace RLS, but it finds accidental broad privileges.

```sql
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_schema, table_name, grantee, privilege_type;
```

Expected review:

- `anon` does not have unexpected write privileges.
- `authenticated` privileges are paired with RLS where client access is expected.
- `service_role` access is understood as bypassing RLS and must be guarded in server routes.

## 7. Function Security And Grants

Review security-definer functions and helper functions used by RLS or server logic.

```sql
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.prosecdef desc, p.proname;
```

Expected review:

- Security-definer functions are intentional.
- Role helper functions use a safe `search_path`.
- RLS helper functions do not accidentally grant cross-org visibility.

## 8. Schema / Column Mismatch

Inventory critical table columns.

```sql
select
  table_schema,
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
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
order by table_name, ordinal_position;
```

Expected review:

- Role/profile fields match the app model.
- `projects.settings` exists for project notes and related metadata.
- `tasks.metadata` supports material requests, material items, status metadata, and attachments.
- `media` has fields required for upload/open/download/delete and task/project linkage.
- `messages` has sender/recipient/read metadata required by private message history.
- `worker_location_consents` and `safety_acknowledgements` have enough fields for audit review.
- Payroll/archive tables match the app's read paths.

## 9. Expected Table Presence

Find missing expected tables without relying on application code.

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
)
select
  expected.table_name,
  t.table_name is not null as exists_in_public_schema
from expected
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = expected.table_name
order by expected.table_name;
```

Expected review:

- Every required table exists.
- Any missing table is documented as a blocker before related features are considered production-safe.

## 10. Type / Role Enum State

Check role enum values and confirm `driver` exists without forcing supervisor users to lose supervisor behavior.

```sql
select
  t.typname as enum_name,
  e.enumlabel as enum_value,
  e.enumsortorder
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
  and t.typname in ('user_role')
order by t.typname, e.enumsortorder;
```

Expected review:

- `driver` exists if production uses role-based material drivers.
- `owner`, `admin`, `manager`, `supervisor`, `worker`, and `driver` remain distinct.
- Any configured supervisor-driver capability is handled by approved app config, not by name hardcode.

## 11. Service-Role Bypass Risk Areas

SQL cannot see application service-role usage, so pair this database check with:

```text
npm run inventory:service-role
npm run alpha7:route-mutation-map
```

Then review database tables most commonly written by service-role routes:

```sql
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'profiles',
    'projects',
    'tasks',
    'messages',
    'media',
    'time_events',
    'worker_location_consents',
    'safety_acknowledgements',
    'audit_log',
    'payroll_runs',
    'payroll_line_items',
    'payroll_closures'
  )
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;
```

Expected review:

- Any app route using service role must load authenticated actor server-side before mutation.
- Same-org/resource guards must run before elevated writes.
- Client-provided `org_id`, `profile_id`, `project_id`, `task_id`, `media_id`, and `message_id` must not be trusted without server-side checks.
- Mutations touching payroll/archive/GPS/shift/material/task/message lifecycle need separate owner-approved review.

## 12. Safety And GPS Consent Tables

Confirm columns and recent row shape for legal/audit records. Limit row output if sharing screenshots externally.

```sql
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('worker_location_consents', 'safety_acknowledgements')
order by table_name, ordinal_position;
```

```sql
select
  'worker_location_consents' as table_name,
  count(*) as row_count,
  max(signed_at) as newest_record
from public.worker_location_consents
union all
select
  'safety_acknowledgements' as table_name,
  count(*) as row_count,
  max(acknowledged_at) as newest_record
from public.safety_acknowledgements;
```

Expected review:

- GPS consent records include worker/profile id, org context, signed name, consent version, accepted/skipped state, and timestamp where schema allows.
- Safety acknowledgement records include worker/profile id, version, project/shift context where schema allows, and timestamp.
- Owner/admin audit UI can review/export these records.

## 13. Payroll / Archive Tables

Verify payroll/archive table existence and RLS/grant state without changing calculations.

```sql
select
  table_name,
  count(*) over () as listed_table_count
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'payroll_runs',
    'payroll_line_items',
    'payroll_closures',
    'pay_periods',
    'pay_period_items',
    'projects',
    'tasks',
    'media',
    'time_events'
  )
order by table_name;
```

```sql
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'payroll_runs',
    'payroll_line_items',
    'payroll_closures',
    'pay_periods',
    'pay_period_items'
  )
order by tablename, policyname;
```

Expected review:

- Payroll archive rows are protected by finance/owner/admin rules.
- Worker-visible closure data is limited to expected worker-safe fields.
- Archive and Trash remain separate concepts: archived project history vs deleted rows.

## 14. Media / Task / Message Linkage

Check table columns used by attachment and history flows.

```sql
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('tasks', 'messages', 'media')
  and column_name in (
    'id',
    'org_id',
    'project_id',
    'assigned_to',
    'sender_id',
    'recipient_id',
    'metadata',
    'settings',
    'media_type',
    'mime_type',
    'filename',
    'storage_path',
    'deleted_at',
    'read_at'
  )
order by table_name, ordinal_position;
```

Expected review:

- Task attachments remain linked through approved metadata/media IDs.
- Message attachments remain messages, not tasks.
- Media project/task linkage remains available for open/download/delete checks.

## 15. Final Step 0 Output

The owner-facing Step 0 report should include:

- Date/time and production project audited.
- Applied migration list summary.
- Any missing expected migrations.
- RLS enabled/disabled table summary.
- Storage bucket/policy summary.
- Grants summary.
- Schema mismatch list.
- Service-role route risk list from local scripts.
- Blocked items requiring separate owner-approved SQL/migration/RLS/Storage task.
- Explicit statement that no SQL writes, migrations, schema changes, RLS changes, Storage policy changes, or production data mutations were performed during Step 0.
