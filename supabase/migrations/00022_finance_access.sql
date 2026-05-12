-- ============================================================================
-- 00022 - Finance access hardening
--
-- Idempotent. Intended for manual review/application through Supabase SQL.
--
-- Access rule:
--   owner/admin always have finance access.
--   Everyone else needs user_capabilities.capability = 'finance_access'
--   with granted = true.
--
-- This migration intentionally does not narrow projects/tasks/time_events
-- worker visibility. Those policies are broad today and need a separate
-- project-access policy pass to avoid breaking clock-in/out and field pages.
-- ============================================================================

begin;

create or replace function public.has_finance_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from public.user_capabilities uc
    where uc.user_id = auth.uid()
      and uc.capability = 'finance_access'
      and uc.granted = true
  );
$$;

grant execute on function public.has_finance_access() to anon, authenticated;

-- Managers can still grant operational capabilities in-org. Finance access
-- can only be changed by owner/admin so a non-finance manager cannot grant
-- themselves or someone else full financial visibility.
drop policy if exists user_capabilities_write_same_org on public.user_capabilities;
drop policy if exists user_capabilities_write_same_org_nonfinance on public.user_capabilities;
create policy user_capabilities_write_same_org_nonfinance
  on public.user_capabilities for all
  using (
    capability <> 'finance_access'
    and exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('manager', 'admin', 'owner')
        and actor.org_id = target.org_id
    )
  )
  with check (
    capability <> 'finance_access'
    and exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('manager', 'admin', 'owner')
        and actor.org_id = target.org_id
    )
  );

drop policy if exists user_capabilities_write_finance_access on public.user_capabilities;
create policy user_capabilities_write_finance_access
  on public.user_capabilities for all
  using (
    capability = 'finance_access'
    and exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('owner', 'admin')
        and actor.org_id = target.org_id
    )
  )
  with check (
    capability = 'finance_access'
    and exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('owner', 'admin')
        and actor.org_id = target.org_id
    )
  );

-- Receipts are media rows, but their amounts/vendor metadata are financial.
-- Keep non-receipt media visibility aligned with 00020. Receipt rows are
-- visible only to finance users or to the uploader of that specific receipt.
drop policy if exists media_select_role_aware on public.media;
create policy media_select_role_aware
  on public.media
  for select
  using (
    org_id = public.get_user_org_id()
    and deleted_at is null
    and (
      (
        coalesce(metadata->>'category', '') <> 'receipt'
        and coalesce(metadata->>'kind', '') <> 'receipt'
        and (
          public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
          or media.uploaded_by = auth.uid()
          or exists (
            select 1
            from public.project_assignments pa
            where pa.profile_id = auth.uid()
              and pa.project_id = media.project_id
          )
          or exists (
            select 1
            from public.profiles p
            join public.projects proj on proj.id = media.project_id
            where p.id = auth.uid()
              and p.project_access_mode = 'all_active'
              and proj.status = 'active'
              and proj.deleted_at is null
              and not exists (
                select 1
                from public.project_exclusions pe
                where pe.profile_id = auth.uid()
                  and pe.project_id = media.project_id
              )
          )
        )
      )
      or (
        (
          coalesce(metadata->>'category', '') = 'receipt'
          or coalesce(metadata->>'kind', '') = 'receipt'
        )
        and (
          public.has_finance_access()
          or media.uploaded_by = auth.uid()
        )
      )
    )
  );

-- Payroll model from 00001/00002.
drop policy if exists "Managers can view payroll runs" on public.payroll_runs;
create policy "Finance users can view payroll runs"
  on public.payroll_runs for select
  using (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Managers can create payroll runs" on public.payroll_runs;
create policy "Finance users can create payroll runs"
  on public.payroll_runs for insert
  with check (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Managers can update payroll runs" on public.payroll_runs;
create policy "Finance users can update payroll runs"
  on public.payroll_runs for update
  using (org_id = public.get_user_org_id() and public.has_finance_access())
  with check (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Managers can view line items" on public.payroll_line_items;
create policy "Finance users can view payroll line items"
  on public.payroll_line_items for select
  using (
    public.has_finance_access()
    and exists (
      select 1
      from public.payroll_runs pr
      where pr.id = payroll_run_id
        and pr.org_id = public.get_user_org_id()
    )
  );

drop policy if exists "Managers can insert line items" on public.payroll_line_items;
create policy "Finance users can insert payroll line items"
  on public.payroll_line_items for insert
  with check (
    public.has_finance_access()
    and exists (
      select 1
      from public.payroll_runs pr
      where pr.id = payroll_run_id
        and pr.org_id = public.get_user_org_id()
    )
  );

drop policy if exists "Workers can view their own line items" on public.payroll_line_items;

drop policy if exists "Managers can view closures" on public.payroll_closures;
create policy "Finance users can view payroll closures"
  on public.payroll_closures for select
  using (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists "Managers can insert closures" on public.payroll_closures;
create policy "Finance users can insert payroll closures"
  on public.payroll_closures for insert
  with check (org_id = public.get_user_org_id() and public.has_finance_access());

-- Pay-period model from 00014/00021.
drop policy if exists pay_periods_manager_all on public.pay_periods;
create policy pay_periods_finance_all
  on public.pay_periods for all
  using (org_id = public.get_user_org_id() and public.has_finance_access())
  with check (org_id = public.get_user_org_id() and public.has_finance_access());

drop policy if exists pay_periods_select_self on public.pay_periods;

drop policy if exists pay_period_items_manager_all on public.pay_period_items;
create policy pay_period_items_finance_all
  on public.pay_period_items for all
  using (
    public.has_finance_access()
    and public.pay_period_in_user_org(pay_period_id)
  )
  with check (
    public.has_finance_access()
    and public.pay_period_in_user_org(pay_period_id)
  );

drop policy if exists pay_period_items_select_self on public.pay_period_items;

commit;

-- Verification after applying:
-- select public.has_finance_access();
-- select schemaname, tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'media',
--     'user_capabilities',
--     'payroll_runs',
--     'payroll_line_items',
--     'payroll_closures',
--     'pay_periods',
--     'pay_period_items'
--   )
-- order by tablename, policyname;
