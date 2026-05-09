-- ============================================================================
-- 00021 — Payroll RLS: break the pay_periods ↔ pay_period_items recursion
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--      Idempotent — safe to run multiple times.
--
-- WHY THIS EXISTS
--   /payroll fails to load with:
--     "infinite recursion detected in policy for relation pay_periods"
--
--   Two policies installed by 00014_phase1_data_foundation.sql cross-
--   reference each other:
--
--     pay_periods.pay_periods_select_self
--       USING (... exists (select 1 from pay_period_items where ...))
--
--     pay_period_items.pay_period_items_manager_all
--       USING (is_manager() and exists (select 1 from pay_periods ...))
--
--   On a SELECT against pay_periods, Postgres OR-evaluates every permissive
--   policy on the table. Evaluating pay_periods_select_self means reading
--   pay_period_items, which triggers pay_period_items_manager_all, which
--   reads pay_periods, which re-enters pay_periods_select_self... and the
--   planner refuses, returning the recursion error to the client.
--
-- FIX
--   Move both cross-table EXISTS checks into SECURITY DEFINER helper
--   functions. SECURITY DEFINER bypasses RLS during the inner read, so the
--   helpers can answer "does this row qualify?" without re-entering the
--   other table's policy chain.
--
--   The end behaviour matches what the original policies tried to express:
--     • managers / owners / admins can read & write all pay_period_items
--       in their own org
--     • workers can read pay_period_items where worker_id = auth.uid()
--     • workers can read pay_periods that contain at least one of their
--       items
--
--   No data is moved or rewritten; only RLS expressions change.
--
-- WHAT IT DOES NOT DO
--   • Does not touch payroll_runs, payroll_closures, payroll_line_items
--     policies — those live in 00002 and never recurse.
--   • Does not change pay_periods / pay_period_items table definitions.
--   • Does not loosen org / role gating: every helper still checks org_id
--     via get_user_org_id() and (where applicable) is_manager().
-- ============================================================================

-- ---- helpers ---------------------------------------------------------------

-- True when the current user has at least one pay_period_item inside the
-- given pay_period. SECURITY DEFINER bypasses pay_period_items RLS during
-- the inner read so calling this from pay_periods RLS does not re-enter
-- the policy graph.
create or replace function public.user_has_pay_period_items(p_pay_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pay_period_items
    where pay_period_id = p_pay_period_id
      and worker_id = auth.uid()
  );
$$;

-- True when the given pay_period belongs to the current user's org.
-- SECURITY DEFINER bypasses pay_periods RLS during the inner read so
-- calling this from pay_period_items RLS does not re-enter the policy
-- graph.
create or replace function public.pay_period_in_user_org(p_pay_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.pay_periods
    where id = p_pay_period_id
      and org_id = public.get_user_org_id()
  );
$$;

grant execute on function public.user_has_pay_period_items(uuid) to anon, authenticated;
grant execute on function public.pay_period_in_user_org(uuid)    to anon, authenticated;

-- ---- pay_periods policies --------------------------------------------------

-- Re-create the manager FOR ALL policy verbatim — it never recursed and
-- recreating it keeps this migration self-contained / re-runnable.
drop policy if exists pay_periods_manager_all on public.pay_periods;
create policy pay_periods_manager_all
  on public.pay_periods for all
  using (org_id = public.get_user_org_id() and public.is_manager())
  with check (org_id = public.get_user_org_id() and public.is_manager());

-- Worker SELECT — same intent as the original (workers may read pay_periods
-- whose items include them), routed through user_has_pay_period_items so
-- the inner read of pay_period_items does NOT trigger pay_period_items RLS.
drop policy if exists pay_periods_select_self on public.pay_periods;
create policy pay_periods_select_self
  on public.pay_periods for select
  using (
    org_id = public.get_user_org_id()
    and public.user_has_pay_period_items(id)
  );

-- ---- pay_period_items policies ---------------------------------------------

-- Manager FOR ALL — same intent as the original (manager-tier roles in the
-- same org as the parent pay_period), routed through pay_period_in_user_org
-- so the inner read of pay_periods does NOT trigger pay_periods RLS.
drop policy if exists pay_period_items_manager_all on public.pay_period_items;
create policy pay_period_items_manager_all
  on public.pay_period_items for all
  using (
    public.is_manager()
    and public.pay_period_in_user_org(pay_period_id)
  )
  with check (
    public.is_manager()
    and public.pay_period_in_user_org(pay_period_id)
  );

-- Worker SELECT for their own line items. Already non-recursive in the
-- original migration; recreated here for completeness and to preserve a
-- single self-contained "payroll RLS" migration.
drop policy if exists pay_period_items_select_self on public.pay_period_items;
create policy pay_period_items_select_self
  on public.pay_period_items for select
  using (worker_id = auth.uid());

-- ============================================================================
-- VERIFICATION (run after the migration; both queries should succeed
-- without "infinite recursion" errors)
-- ============================================================================
-- -- 1. List the policies that now apply to pay_periods + pay_period_items.
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in ('pay_periods', 'pay_period_items')
-- order by tablename, policyname;
--
-- -- 2. Smoke-test as the manager session — this is what /payroll runs
-- --    on page load. Expect a row count, not an error.
-- select id, label, status from public.pay_periods order by start_date desc limit 5;
-- select count(*) from public.pay_period_items;
-- ============================================================================
