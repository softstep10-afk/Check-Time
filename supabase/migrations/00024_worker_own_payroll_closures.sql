-- 00024 — Worker-visible paid cutoff
--
-- Workers can see their own payroll closure cutoff so the Hours page can
-- show paid/closed vs unpaid after Payroll marks a period paid. This does
-- not expose pay amounts, rates, line items, or other workers' payroll.

drop policy if exists "Workers can view own payroll closures" on public.payroll_closures;
create policy "Workers can view own payroll closures"
  on public.payroll_closures for select
  using (
    profile_id = auth.uid()
    and org_id = public.get_user_org_id()
  );
