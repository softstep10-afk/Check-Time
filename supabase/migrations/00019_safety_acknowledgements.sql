-- ============================================================================
-- 00019 — safety_acknowledgements (Safety Brief audit trail)
--
-- ⚠️ RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--
-- Records every Safety Brief acknowledgement a worker submits before
-- starting a shift. Insert-only audit trail mirroring the shape of
-- worker_location_consents (00003).
--
-- Worker flow:
--   1. Worker taps "Start shift".
--   2. SafetyBriefModal opens with project-specific rules (or the default
--      list when no rules are configured).
--   3. Worker ticks "Я прочитал и понимаю правила безопасности" and
--      confirms.
--   4. The client INSERTs a row here, then calls the existing
--      WorkerShell.clockIn(projectId) (untouched). The ack row precedes
--      the actual time_events.clock_in row by a few hundred ms.
--   5. check_in_event_id may be left NULL (the ack still stands as
--      audit). A future enhancement can backfill the link.
--
-- Backward-compatible: empty table by default; nothing reads from it
-- until manager surfaces are added; nothing else writes to it.
--
-- Safe to re-run: every DDL is guarded with IF NOT EXISTS / DO blocks.
-- ============================================================================

create table if not exists public.safety_acknowledgements (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  worker_id           uuid not null references public.profiles(id) on delete cascade,
  project_id          uuid references public.projects(id) on delete set null,
  safety_version      text not null,
  acknowledged_at     timestamptz not null default now(),
  check_in_event_id   uuid references public.time_events(id) on delete set null
);

create index if not exists idx_safety_acks_worker
  on public.safety_acknowledgements(worker_id, acknowledged_at desc);
create index if not exists idx_safety_acks_project
  on public.safety_acknowledgements(project_id, acknowledged_at desc);
create index if not exists idx_safety_acks_org_day
  on public.safety_acknowledgements(org_id, acknowledged_at desc);

alter table public.safety_acknowledgements enable row level security;

-- Workers see + insert only their own rows.
-- Managers see all rows in their org (no insert, no update — append-only
-- audit trail; managers cannot fabricate worker acknowledgements).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'safety_acknowledgements'
      and policyname = 'Workers can view own acks'
  ) then
    create policy "Workers can view own acks"
      on public.safety_acknowledgements for select
      using (worker_id = auth.uid());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'safety_acknowledgements'
      and policyname = 'Workers can insert own acks'
  ) then
    create policy "Workers can insert own acks"
      on public.safety_acknowledgements for insert
      with check (
        worker_id = auth.uid()
        and org_id = public.get_user_org_id()
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'safety_acknowledgements'
      and policyname = 'Managers can view org acks'
  ) then
    create policy "Managers can view org acks"
      on public.safety_acknowledgements for select
      using (
        org_id = public.get_user_org_id()
        and public.is_manager()
      );
  end if;
end$$;
