-- ============================================================================
-- 00032 - profile_rates (repo <-> prod parity)
--
-- Idempotent. Intended for manual review/application through Supabase SQL.
--
-- Why this exists:
--   The profile_rates table was created directly in production (out-of-band)
--   when hourly_rate was moved off public.profiles. No migration captured it,
--   so a database rebuilt purely from supabase/migrations/ would be missing the
--   table that the app (src/lib/profile-rates.ts, manager-data, payroll, team
--   routes) reads and writes. This migration reproduces the live table 1:1,
--   hardens anon access, and backfills existing rates.
--
-- DEPENDENCY / ORDERING:
--   This migration MUST be applied BEFORE any future "stage 3" migration that
--   drops public.profiles.hourly_rate. The backfill below copies the legacy
--   column into profile_rates; dropping the column first would lose that data.
--   Today the legacy profiles.hourly_rate column still exists and coexists with
--   this table (matches current prod).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Table (mirrors production exactly)
-- ----------------------------------------------------------------------------
create table if not exists public.profile_rates (
  profile_id  uuid        primary key references public.profiles(id)      on delete cascade,
  org_id      uuid        not null     references public.organizations(id) on delete cascade,
  hourly_rate numeric,
  updated_at  timestamptz not null     default now()
);

-- ----------------------------------------------------------------------------
-- Row Level Security (mirrors production: finance-only, org-scoped)
--   Functions get_user_org_id() / has_finance_access() come from 00001 / 00022.
--   There is intentionally no DELETE policy (matches prod) -> deletes denied.
--   The UPDATE policy has USING only (matches prod); Postgres reuses USING as
--   the WITH CHECK for UPDATE, so new rows are still constrained.
-- ----------------------------------------------------------------------------
alter table public.profile_rates enable row level security;

drop policy if exists "Finance can view rates" on public.profile_rates;
create policy "Finance can view rates"
  on public.profile_rates for select
  using (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Finance can insert rates" on public.profile_rates;
create policy "Finance can insert rates"
  on public.profile_rates for insert
  with check (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Finance can update rates" on public.profile_rates;
create policy "Finance can update rates"
  on public.profile_rates for update
  using (org_id = public.get_user_org_id() and public.has_finance_access());

-- ----------------------------------------------------------------------------
-- Grants
--   Trusted roles keep table privileges (still gated by the RLS policies above).
--   anon is stripped of every privilege: rates are finance-only and anon should
--   never touch this table. RLS already denies it; this is defense-in-depth and
--   closes the excess anon grants that exist on the live table.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete, truncate, references, trigger
  on public.profile_rates to authenticated;
grant select, insert, update, delete, truncate, references, trigger
  on public.profile_rates to service_role;

revoke all on public.profile_rates from anon;

-- ----------------------------------------------------------------------------
-- Backfill from the legacy profiles.hourly_rate column (idempotent).
--   ON CONFLICT DO NOTHING: never clobber a rate already stored in the table,
--   so this is safe to re-run.
-- ----------------------------------------------------------------------------
insert into public.profile_rates (profile_id, org_id, hourly_rate, updated_at)
select p.id, p.org_id, p.hourly_rate, now()
from public.profiles p
where p.hourly_rate is not null
  and p.org_id is not null
on conflict (profile_id) do nothing;

commit;

-- Verification after applying:
-- select to_regclass('public.profile_rates');
-- select polname, polcmd from pg_policy where polrelid = 'public.profile_rates'::regclass;
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'profile_rates' order by grantee;
-- select count(*) from public.profile_rates;
