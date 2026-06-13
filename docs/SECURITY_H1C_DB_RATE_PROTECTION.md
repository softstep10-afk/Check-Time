# Security H1C DB Rate Protection

Status: candidate package prepared. Do not run SQL yet.

## Decision

Use a finance-safe RPC first, then revoke direct `profiles` table select and re-grant only safe profile columns to `authenticated`.

This is safer than moving `hourly_rate` into a new compensation table during H1C because H1A/H1B already centralized legitimate app reads in `src/lib/profile-rates.ts`. H1C can therefore enforce DB-level column privacy without a data move.

## What H1C Fixes

- Ordinary authenticated users should no longer be able to directly select `profiles.hourly_rate`.
- Finance/owner/admin paths read rates through `public.get_profile_rates_for_finance()`.
- Existing payroll math continues to receive `hourly_rate` through the same TypeScript helper.

## What H1C Does Not Fix

- H2 time event / GPS visibility.
- H3 task broad policy cleanup.
- H4 SECURITY DEFINER helper hardening.
- Project Finance Folder or Client Portal work.

## H1C Candidate Migration SQL

File: `supabase/migrations/00034_security_h1c_rate_privacy.sql`

Do not apply it with `supabase db push`. Production migration history is not repaired. Use manual exact SQL only after DB-0 Gate and owner approval.

## H1C Verification SQL — READ ONLY / DO NOT RUN YET

```sql
select
  has_column_privilege('authenticated', 'public.profiles', 'id', 'select') as authenticated_can_read_id,
  has_column_privilege('authenticated', 'public.profiles', 'name', 'select') as authenticated_can_read_name,
  has_column_privilege('authenticated', 'public.profiles', 'hourly_rate', 'select') as authenticated_can_read_hourly_rate,
  has_column_privilege('authenticated', 'public.profiles', 'pin_hash', 'select') as authenticated_can_read_pin_hash;

select grantee, table_schema, table_name, column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = 'profiles'
  and grantee in ('anon', 'authenticated')
order by grantee, column_name;

select routine_schema, routine_name, routine_type, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'get_profile_rates_for_finance';
```

## Runtime Verification

- Worker/non-finance session: `profiles.select("id,name")` succeeds only inside own RLS scope; `profiles.select("hourly_rate")` fails with column permission denial.
- Worker/non-finance session: `rpc("get_profile_rates_for_finance")` fails with `profile_rate_access_denied`.
- Owner/admin/finance session: `rpc("get_profile_rates_for_finance")` returns safe profile fields plus `hourly_rate`.
- Payroll page opens for finance/owner.
- Payroll preview/export/run still uses the H1B helper path and does not change payroll math.

## Rollback

Rollback is grant-only if the RPC or column grants break production:

```sql
grant select on table public.profiles to authenticated;
```

Then redeploy the previous app commit only if needed. No data rows are changed by the candidate migration.
