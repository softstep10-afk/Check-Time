-- ============================================================================
-- 00014 — PHASE 1: DATA FOUNDATION (schema-gap reconciliation)
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--      Fully idempotent — safe to run multiple times.
--
-- WHY THIS EXISTS
--   Migrations 00004, 00005, 00006, 00008, 00009, 00010, 00011, 00012 were
--   checked into the repo with all DDL commented out (header `RUN MANUALLY`,
--   body `-- create table ...`). Whether they were ever run by hand on the
--   live DB is unknown. This migration consolidates every schema bit those
--   files were supposed to add into ONE idempotent script, plus closes the
--   RLS hole on the eight tables that 00003 created without `enable row
--   level security` (messages, supply_stores, store_visits,
--   worker_live_locations, worker_location_consents, audit_log,
--   pay_periods, pay_period_items).
--
-- WHAT IT DOES NOT DO
--   • No data migrations, no row inserts (other than the app_settings
--     singleton seed).
--   • No changes to existing 00001/00002/00013 objects.
--   • No UI / app logic changes.
--
-- PREREQUISITES
--   00001_foundation, 00002_rls_policies, 00003_schema_gap, 00013_is_manager
--   already applied. Idempotent enough to run on either a wash+seed DB or a
--   long-running DB that has had partial hand-edits.
-- ============================================================================

begin;

-- ============================================================================
-- 1. ENUMS  (from 00009)
-- ============================================================================
do $$ begin
  create type public.message_priority as enum ('urgent', 'info', 'good', 'task');
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 2. COLUMN ADDITIONS  (from 00004, 00008, 00009)
-- ============================================================================

-- 2a. store_visits.grace_started_at  (00004) — used by detect-store-visit
--     edge function and src/lib/store-visits.ts
alter table public.store_visits
  add column if not exists grace_started_at timestamptz;

create index if not exists idx_store_visits_open_grace
  on public.store_visits(worker_id, grace_started_at)
  where exited_at is null;

-- 2b. projects.gps_radius_m  (00008) — per-project geofence override
alter table public.projects
  add column if not exists gps_radius_m integer
  check (gps_radius_m is null or gps_radius_m between 25 and 300);

update public.projects set gps_radius_m = 75 where gps_radius_m is null;

alter table public.projects alter column gps_radius_m set default 75;
alter table public.projects alter column gps_radius_m set not null;

-- 2c. messages.priority + index  (00009)
alter table public.messages
  add column if not exists priority public.message_priority not null default 'info';

create index if not exists idx_messages_priority_created
  on public.messages(recipient_id, priority, created_at desc);

-- 2d. profiles.notif_mode  (00009) — sound vs silent for clock-in/message sfx
alter table public.profiles
  add column if not exists notif_mode text not null default 'sound';

do $$ begin
  alter table public.profiles
    add constraint profiles_notif_mode_check check (notif_mode in ('sound', 'silent'));
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 3. NEW TABLES  (from 00005, 00010, 00012)
-- ============================================================================

-- 3a. app_settings  (00005) — singleton row, geofence radius + future keys
create table if not exists public.app_settings (
  id          smallint primary key default 1,
  settings    jsonb not null default '{"geofence_radius_meters": 75}',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id) on delete set null,
  constraint app_settings_singleton check (id = 1)
);

insert into public.app_settings (id, settings)
values (1, '{"geofence_radius_meters": 75}')
on conflict (id) do nothing;

-- 3b. user_capabilities  (00010) — per-user permission overrides
create table if not exists public.user_capabilities (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  capability  text not null,
  granted     boolean not null default true,
  granted_by  uuid references public.profiles(id) on delete set null,
  granted_at  timestamptz not null default now(),
  note        text,
  primary key (user_id, capability)
);

create index if not exists idx_user_capabilities_capability
  on public.user_capabilities(capability)
  where granted = true;

-- 3c. media_flags + media_flags_public view  (00012) — anonymous incident tracker
create table if not exists public.media_flags (
  id              uuid primary key default uuid_generate_v4(),
  media_id        uuid not null references public.media(id) on delete cascade,
  flagged_by      uuid references public.profiles(id) on delete set null,
  note            text not null default '',
  flagged_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_note   text
);

create index if not exists idx_media_flags_open
  on public.media_flags(media_id)
  where reviewed_at is null;

create index if not exists idx_media_flags_media
  on public.media_flags(media_id, flagged_at desc);

create or replace view public.media_flags_public as
  select
    id,
    media_id,
    note,
    flagged_at,
    reviewed_at,
    reviewed_note,
    (reviewed_at is not null) as is_reviewed
  from public.media_flags;

alter view public.media_flags_public set (security_invoker = true);

-- ============================================================================
-- 4. FUNCTIONS  (from 00010)
-- ============================================================================
create or replace function public.has_capability(cap text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select granted
       from public.user_capabilities
      where user_id    = auth.uid()
        and capability = cap
      limit 1),
    false
  );
$$;

grant execute on function public.has_capability(text) to anon, authenticated;

-- ============================================================================
-- 5. updated_at TRIGGERS for tables created in 00003 that lack them
-- ============================================================================
do $$ begin
  create trigger set_updated_at before update on public.pay_periods
    for each row execute function public.handle_updated_at();
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger set_updated_at before update on public.pay_period_items
    for each row execute function public.handle_updated_at();
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger set_updated_at before update on public.app_settings
    for each row execute function public.handle_updated_at();
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 6. RLS — ENABLE on every table that was missing it
-- ============================================================================
alter table public.messages                  enable row level security;
alter table public.supply_stores             enable row level security;
alter table public.store_visits              enable row level security;
alter table public.worker_live_locations     enable row level security;
alter table public.worker_location_consents  enable row level security;
alter table public.audit_log                 enable row level security;
alter table public.pay_periods               enable row level security;
alter table public.pay_period_items          enable row level security;
alter table public.app_settings              enable row level security;
alter table public.user_capabilities         enable row level security;
alter table public.media_flags               enable row level security;

-- ============================================================================
-- 7. RLS — POLICIES (minimal, aligned with existing 00002 patterns)
--    `is_manager()` (per 00013) returns true for owner/admin/manager/supervisor.
-- ============================================================================

-- ---- messages ---------------------------------------------------------------
drop policy if exists messages_select_participant on public.messages;
create policy messages_select_participant
  on public.messages for select
  using (
    org_id = public.get_user_org_id()
    and (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_manager())
  );

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self
  on public.messages for insert
  with check (
    org_id = public.get_user_org_id()
    and sender_id = auth.uid()
  );

-- Recipient flips read=true on their own row. Managers can update any
-- message in their org (e.g. mark-as-read on behalf of a worker).
drop policy if exists messages_update_recipient on public.messages;
create policy messages_update_recipient
  on public.messages for update
  using (
    org_id = public.get_user_org_id()
    and (recipient_id = auth.uid() or public.is_manager())
  );

-- ---- supply_stores (global directory; no org_id column) --------------------
drop policy if exists supply_stores_select_all on public.supply_stores;
create policy supply_stores_select_all
  on public.supply_stores for select
  using (auth.uid() is not null);

drop policy if exists supply_stores_write_manager on public.supply_stores;
create policy supply_stores_write_manager
  on public.supply_stores for all
  using (public.is_manager())
  with check (public.is_manager());

-- ---- store_visits ----------------------------------------------------------
drop policy if exists store_visits_select_org on public.store_visits;
create policy store_visits_select_org
  on public.store_visits for select
  using (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

drop policy if exists store_visits_insert_self_or_manager on public.store_visits;
create policy store_visits_insert_self_or_manager
  on public.store_visits for insert
  with check (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

drop policy if exists store_visits_update_self_or_manager on public.store_visits;
create policy store_visits_update_self_or_manager
  on public.store_visits for update
  using (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

-- ---- worker_live_locations -------------------------------------------------
drop policy if exists wll_select_self_or_manager on public.worker_live_locations;
create policy wll_select_self_or_manager
  on public.worker_live_locations for select
  using (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

drop policy if exists wll_insert_self_or_manager on public.worker_live_locations;
create policy wll_insert_self_or_manager
  on public.worker_live_locations for insert
  with check (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

-- ---- worker_location_consents ---------------------------------------------
drop policy if exists wlc_select_self_or_manager on public.worker_location_consents;
create policy wlc_select_self_or_manager
  on public.worker_location_consents for select
  using (
    org_id = public.get_user_org_id()
    and (worker_id = auth.uid() or public.is_manager())
  );

drop policy if exists wlc_insert_self on public.worker_location_consents;
create policy wlc_insert_self
  on public.worker_location_consents for insert
  with check (
    org_id = public.get_user_org_id()
    and worker_id = auth.uid()
  );

-- ---- audit_log -------------------------------------------------------------
-- SELECT: managers in the same org. INSERT: any authenticated user can write
-- their own audit row (actor_id = self), so application-level audit calls work
-- without service role. Updates / deletes are blocked (no policy = denied).
drop policy if exists audit_log_select_manager on public.audit_log;
create policy audit_log_select_manager
  on public.audit_log for select
  using (
    org_id = public.get_user_org_id()
    and public.is_manager()
  );

drop policy if exists audit_log_insert_self on public.audit_log;
create policy audit_log_insert_self
  on public.audit_log for insert
  with check (
    org_id = public.get_user_org_id()
    and (actor_id = auth.uid() or actor_id is null)
  );

-- ---- pay_periods + pay_period_items ---------------------------------------
drop policy if exists pay_periods_manager_all on public.pay_periods;
create policy pay_periods_manager_all
  on public.pay_periods for all
  using (org_id = public.get_user_org_id() and public.is_manager())
  with check (org_id = public.get_user_org_id() and public.is_manager());

-- Workers see periods that contain a line item for them
drop policy if exists pay_periods_select_self on public.pay_periods;
create policy pay_periods_select_self
  on public.pay_periods for select
  using (
    org_id = public.get_user_org_id()
    and exists (
      select 1 from public.pay_period_items ppi
      where ppi.pay_period_id = pay_periods.id and ppi.worker_id = auth.uid()
    )
  );

drop policy if exists pay_period_items_manager_all on public.pay_period_items;
create policy pay_period_items_manager_all
  on public.pay_period_items for all
  using (
    public.is_manager()
    and exists (
      select 1 from public.pay_periods pp
      where pp.id = pay_period_items.pay_period_id
        and pp.org_id = public.get_user_org_id()
    )
  )
  with check (
    public.is_manager()
    and exists (
      select 1 from public.pay_periods pp
      where pp.id = pay_period_items.pay_period_id
        and pp.org_id = public.get_user_org_id()
    )
  );

drop policy if exists pay_period_items_select_self on public.pay_period_items;
create policy pay_period_items_select_self
  on public.pay_period_items for select
  using (worker_id = auth.uid());

-- ---- app_settings ----------------------------------------------------------
drop policy if exists app_settings_select_all on public.app_settings;
create policy app_settings_select_all
  on public.app_settings for select
  using (auth.uid() is not null);

drop policy if exists app_settings_update_owner on public.app_settings;
create policy app_settings_update_owner
  on public.app_settings for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('owner', 'admin')
    )
  );

-- ---- user_capabilities -----------------------------------------------------
drop policy if exists user_capabilities_select_same_org on public.user_capabilities;
create policy user_capabilities_select_same_org
  on public.user_capabilities for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('manager', 'admin', 'owner')
        and actor.org_id = target.org_id
    )
  );

drop policy if exists user_capabilities_write_same_org on public.user_capabilities;
create policy user_capabilities_write_same_org
  on public.user_capabilities for all
  using (
    exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('manager', 'admin', 'owner')
        and actor.org_id = target.org_id
    )
  )
  with check (
    exists (
      select 1
      from public.profiles target, public.profiles actor
      where target.id  = user_capabilities.user_id
        and actor.id   = auth.uid()
        and actor.role in ('manager', 'admin', 'owner')
        and actor.org_id = target.org_id
    )
  );

-- ---- media_flags + column-level grants ------------------------------------
drop policy if exists media_flags_insert_assigned on public.media_flags;
create policy media_flags_insert_assigned
  on public.media_flags for insert
  with check (
    flagged_by = auth.uid()
    and exists (
      select 1 from public.media m
      where m.id = media_flags.media_id
        and (
          (public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
           and m.org_id = public.get_user_org_id())
          or exists (
            select 1 from public.project_assignments pa
            where pa.profile_id = auth.uid() and pa.project_id = m.project_id
          )
        )
    )
  );

drop policy if exists media_flags_select_manager on public.media_flags;
create policy media_flags_select_manager
  on public.media_flags for select
  using (
    public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
    and exists (
      select 1 from public.media m
      where m.id = media_flags.media_id and m.org_id = public.get_user_org_id()
    )
  );

drop policy if exists media_flags_select_assigned on public.media_flags;
create policy media_flags_select_assigned
  on public.media_flags for select
  using (
    exists (
      select 1
      from public.media m
      join public.project_assignments pa on pa.project_id = m.project_id
      where m.id = media_flags.media_id and pa.profile_id = auth.uid()
    )
  );

drop policy if exists media_flags_update_manager on public.media_flags;
create policy media_flags_update_manager
  on public.media_flags for update
  using (
    public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
    and exists (
      select 1 from public.media m
      where m.id = media_flags.media_id and m.org_id = public.get_user_org_id()
    )
  )
  with check (public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner'));

-- Column-level grants: hide author identifiers from worker-tier roles.
revoke select on public.media_flags from authenticated;
grant  select (id, media_id, note, flagged_at, reviewed_at, reviewed_note)
  on public.media_flags to authenticated;
grant  select on public.media_flags_public to authenticated;

-- ============================================================================
-- 8. media SELECT POLICY: split by role  (from 00011)
-- ============================================================================
drop policy if exists "Users can view media in their org" on public.media;
drop policy if exists media_select_role_aware            on public.media;

create policy media_select_role_aware
  on public.media for select
  using (
    org_id = public.get_user_org_id()
    and deleted_at is null
    and (
      public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
      or exists (
        select 1 from public.project_assignments pa
        where pa.profile_id = auth.uid() and pa.project_id = media.project_id
      )
      or media.uploaded_by = auth.uid()
    )
  );

commit;

-- ============================================================================
-- VERIFICATION QUERIES  (run after the migration; expect green output)
-- ============================================================================
--
-- -- (a) Every new column exists:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='projects' and column_name='gps_radius_m';
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='messages' and column_name='priority';
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='profiles' and column_name='notif_mode';
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='store_visits' and column_name='grace_started_at';
--
-- -- (b) Every new table / view exists:
-- select tablename  from pg_tables  where schemaname='public'
--   and tablename in ('app_settings','user_capabilities','media_flags');
-- select viewname   from pg_views   where schemaname='public' and viewname='media_flags_public';
--
-- -- (c) Every table now has RLS enabled (rowsecurity = true):
-- select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace
--     and relname in (
--       'messages','supply_stores','store_visits','worker_live_locations',
--       'worker_location_consents','audit_log','pay_periods','pay_period_items',
--       'app_settings','user_capabilities','media_flags'
--     )
--   order by relname;
--
-- -- (d) The has_capability function exists and is callable:
-- select public.has_capability('flag_media');   -- expect false (no rows yet)
--
-- -- (e) message_priority enum present with all four values:
-- select unnest(enum_range(null::public.message_priority));
--
-- -- (f) app_settings singleton row exists:
-- select * from public.app_settings where id = 1;
-- ============================================================================
