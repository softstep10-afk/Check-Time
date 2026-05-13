-- 00025 — Payroll idempotency and overlap guard
--
-- App-side guards prevent normal double payment. This migration moves the
-- critical invariant into Postgres too: a worker cannot be closed/paid twice
-- for overlapping payroll windows, and repeated requests cannot insert
-- duplicate pay-period items, ledger lines, or closure rows.

begin;

-- One pay-period review row per worker.
with ranked as (
  select
    id,
    row_number() over (
      partition by pay_period_id, worker_id
      order by created_at asc, id asc
    ) as rn
  from public.pay_period_items
)
delete from public.pay_period_items item
using ranked
where item.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists pay_period_items_unique_period_worker
  on public.pay_period_items(pay_period_id, worker_id);

-- One immutable ledger line per run / worker / project. NULL project means
-- "no project split", so it participates in uniqueness via the zero UUID.
with ranked as (
  select
    id,
    row_number() over (
      partition by payroll_run_id, profile_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by created_at asc, id asc
    ) as rn
  from public.payroll_line_items
)
delete from public.payroll_line_items item
using ranked
where item.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists payroll_line_items_unique_run_worker_project
  on public.payroll_line_items(
    payroll_run_id,
    profile_id,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- One closure per run / worker, and one closure cutoff per worker. Exact
-- duplicate cutoffs are always a duplicate paid state in this data model.
with ranked as (
  select
    id,
    row_number() over (
      partition by payroll_run_id, profile_id
      order by created_at asc, id asc
    ) as rn
  from public.payroll_closures
)
delete from public.payroll_closures closure
using ranked
where closure.id = ranked.id
  and ranked.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by profile_id, closed_through
      order by created_at asc, id asc
    ) as rn
  from public.payroll_closures
)
delete from public.payroll_closures closure
using ranked
where closure.id = ranked.id
  and ranked.rn > 1;

create unique index if not exists payroll_closures_unique_run_worker
  on public.payroll_closures(payroll_run_id, profile_id);

create unique index if not exists payroll_closures_unique_worker_cutoff
  on public.payroll_closures(profile_id, closed_through);

create or replace function public.prevent_payroll_closure_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  run_start date;
  run_start_at timestamptz;
  existing_cutoff timestamptz;
begin
  select period_start
    into run_start
  from public.payroll_runs
  where id = new.payroll_run_id;

  if run_start is null then
    return new;
  end if;

  run_start_at := run_start::timestamp at time zone 'UTC';

  select closure.closed_through
    into existing_cutoff
  from public.payroll_closures closure
  where closure.profile_id = new.profile_id
    and closure.id <> new.id
    and closure.closed_through >= run_start_at
  order by closure.closed_through desc
  limit 1;

  if existing_cutoff is not null then
    raise exception
      using
        errcode = '23505',
        message = format(
          'payroll_overlap: worker %s is already closed through %s; payroll run starts %s',
          new.profile_id,
          existing_cutoff,
          run_start
        );
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_payroll_closure_overlap_trigger on public.payroll_closures;
create trigger prevent_payroll_closure_overlap_trigger
  before insert or update of payroll_run_id, profile_id, closed_through
  on public.payroll_closures
  for each row
  execute function public.prevent_payroll_closure_overlap();

commit;
