# Pending Supabase Migrations

Apply these in Supabase SQL Editor in order. Do not skip ahead: later code expects the earlier schema and policy changes.

## 00022_finance_access.sql

Description: Adds `public.has_finance_access()`, finance-only payroll/pay-period policies, receipt-aware media visibility, and owner/admin-only writes for `finance_access`.

Preconditions:

```sql
select to_regclass('public.user_capabilities') as user_capabilities_table;
select to_regclass('public.payroll_runs') as payroll_runs_table;
select to_regclass('public.pay_periods') as pay_periods_table;
```

Verification from migration:

```sql
select public.has_finance_access();

select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'media',
    'user_capabilities',
    'payroll_runs',
    'payroll_line_items',
    'payroll_closures',
    'pay_periods',
    'pay_period_items'
  )
order by tablename, policyname;
```

Rollback note: Not cleanly reversible without restoring the prior RLS policies. Take a database backup before applying.

## 00023_archive_foundation.sql

Description: Adds project archive metadata columns and indexes for archive/history/payroll lookups.

Preconditions:

```sql
select to_regclass('public.projects') as projects_table;
select to_regclass('public.payroll_runs') as payroll_runs_table;
select to_regclass('public.pay_periods') as pay_periods_table;
```

Verification:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'projects'
  and column_name in ('archived_at', 'archived_by')
order by column_name;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_projects_archive_lookup',
    'idx_tasks_project_archive_lookup',
    'idx_media_project_archive_lookup',
    'idx_time_events_project_archive_lookup',
    'idx_payroll_runs_archive_lookup',
    'idx_payroll_line_items_worker_project',
    'idx_pay_periods_archive_lookup',
    'idx_pay_period_items_worker_period'
  )
order by indexname;
```

Rollback note: Indexes can be dropped, but removing columns may lose archive metadata. Prefer backup restore if rollback is required.

## 00024_worker_own_payroll_closures.sql

Description: Lets workers read only their own payroll closure cutoff so Hours can show paid/closed vs unpaid/open.

Preconditions:

```sql
select to_regclass('public.payroll_closures') as payroll_closures_table;
select proname from pg_proc where proname = 'get_user_org_id';
```

Verification:

```sql
select schemaname, tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'payroll_closures'
  and policyname = 'Workers can view own payroll closures';
```

Rollback note: Drop the policy if needed. This only removes worker visibility of paid cutoff data.

## 00025_payroll_idempotency.sql

Description: Adds database-level duplicate and overlap protection for pay period items, payroll line items, and payroll closure rows.

Preconditions:

Run these duplicate diagnostics before applying. The migration deletes duplicate rows by keeping the earliest row per duplicate group, so review the output first.

```sql
select pay_period_id, worker_id, count(*) as duplicates
from public.pay_period_items
group by pay_period_id, worker_id
having count(*) > 1;

select
  payroll_run_id,
  profile_id,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) as project_key,
  count(*) as duplicates
from public.payroll_line_items
group by payroll_run_id, profile_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
having count(*) > 1;

select payroll_run_id, profile_id, count(*) as duplicates
from public.payroll_closures
group by payroll_run_id, profile_id
having count(*) > 1;

select profile_id, closed_through, count(*) as duplicates
from public.payroll_closures
group by profile_id, closed_through
having count(*) > 1;
```

Verification:

```sql
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'pay_period_items_unique_period_worker',
    'payroll_line_items_unique_run_worker_project',
    'payroll_closures_unique_run_worker',
    'payroll_closures_unique_worker_cutoff'
  )
order by indexname;

select tgname
from pg_trigger
where tgname = 'prevent_payroll_closure_overlap_trigger';
```

Rollback note: Not safely reversible without accepting double-pay risk. If rollback is required, restore from backup or explicitly drop the trigger and unique indexes after a finance review.

## 00026_core_review_indexes.sql

Description: Adds indexes supporting audit review, command center, archive, payroll smoke checks, and receipt lookups.

Preconditions:

```sql
select to_regclass('public.audit_log') as audit_log_table;
select to_regclass('public.tasks') as tasks_table;
select to_regclass('public.media') as media_table;
select to_regclass('public.time_events') as time_events_table;
select to_regclass('public.payroll_closures') as payroll_closures_table;
```

Verification:

```sql
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_audit_org_action_created',
    'idx_audit_org_target_created',
    'idx_tasks_active_project_status_created',
    'idx_tasks_active_assignee_status_created',
    'idx_media_active_project_created',
    'idx_media_receipts_project_created',
    'idx_time_events_adjust_worker_created',
    'idx_payroll_closures_run_worker_cutoff'
  )
order by indexname;
```

Rollback note: Low-risk to roll back by dropping indexes, but rollback is normally unnecessary because this migration does not rewrite data or policies.

## 00027_sales_role.sql

Description: Adds `sales` to the `public.user_role` enum so sales profiles can be created.

Preconditions:

```sql
select typname
from pg_type
where typname = 'user_role';
```

Verification:

```sql
select enumlabel
from pg_enum
where enumtypid = 'public.user_role'::regtype
  and enumlabel = 'sales';
```

Rollback note: PostgreSQL enum values are not cleanly removable. Treat this as one-way without a backup restore.

## 00028_pin_login_rate_limit.sql

Description: Adds persistent server-side PIN login rate-limit state keyed by hashed client identifiers.

Preconditions:

```sql
select current_schema();
```

Verification:

```sql
select to_regclass('public.pin_login_rate_limits') as pin_login_rate_limits_table;

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname = 'pin_login_rate_limits_locked_until_idx';

select relrowsecurity
from pg_class
where oid = 'public.pin_login_rate_limits'::regclass;
```

Rollback note: Drop the table only if PIN rate limiting must be disabled and the application code is rolled back at the same time.
