-- ============================================================================
-- CHECK-TIME: Foundation Schema
-- Multi-tenant construction workforce management
-- Ledger-based time tracking with closure-marker payroll
-- ============================================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "postgis";

-- ============================================================================
-- ORGANIZATIONS (multi-tenant from day 1)
-- ============================================================================
create table public.organizations (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text unique not null,  -- for subdomain/url: "smith-remodeling"
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- PROFILES (extends Supabase Auth users)
-- Every person — worker, supervisor, manager — is an auth user with a profile.
-- The PIN maps to a real auth account created by the manager.
-- ============================================================================
create type public.user_role as enum ('worker', 'supervisor', 'driver', 'subcontractor', 'manager', 'admin');

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  role            public.user_role not null default 'worker',
  pin_hash        text,                           -- argon2 hashed PIN for quick mobile login
  color           text not null default '#F0B90B', -- avatar color
  is_active       boolean not null default true,
  require_video   boolean not null default false,  -- must upload video on checkout
  hourly_rate     numeric(10,2),                   -- per-worker override (nullable = use project rate)
  language        text not null default 'en',      -- preferred language for AI responses
  settings        jsonb not null default '{}',
  last_clock_in   timestamptz,                     -- denormalized for quick status checks
  current_project uuid,                            -- denormalized: which project they're on right now
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_profiles_org on public.profiles(org_id);
create index idx_profiles_role on public.profiles(org_id, role);

-- ============================================================================
-- PROJECTS
-- ============================================================================
create type public.project_status as enum ('active', 'paused', 'completed', 'archived');

create table public.projects (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  address     text,
  notes       text,                                   -- manager notes shown to workers
  status      public.project_status not null default 'active',
  rate        numeric(10,2) not null default 25.00,   -- default hourly rate
  site_point  geography(Point, 4326),                 -- GPS center point
  radius_m    integer not null default 200,            -- geofence radius in meters
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_projects_org on public.projects(org_id);
create index idx_projects_status on public.projects(org_id, status);

-- ============================================================================
-- PROJECT ASSIGNMENTS (which workers can clock into which projects)
-- ============================================================================
create table public.project_assignments (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique(project_id, profile_id)
);

create index idx_assignments_project on public.project_assignments(project_id);
create index idx_assignments_profile on public.project_assignments(profile_id);

-- ============================================================================
-- TIME EVENTS (append-only ledger — the core of the system)
--
-- Never update or delete rows. Manual corrections are separate events
-- with type 'adjust' and a reference to what they're correcting.
-- ============================================================================
create type public.time_event_type as enum (
  'clock_in',
  'clock_out',
  'auto_out',        -- system closed an open session (forgot to clock out)
  'adjust',          -- manager manual correction
  'break_start',     -- future: break tracking
  'break_end'
);

create type public.checkout_video_status as enum ('not_required', 'pending', 'uploaded', 'verified');

create table public.time_events (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  project_id        uuid not null references public.projects(id) on delete cascade,
  event_type        public.time_event_type not null,
  event_time        timestamptz not null default now(),  -- when the event actually happened
  server_time       timestamptz not null default now(),  -- when the server recorded it
  
  -- GPS data captured at event time
  gps_point         geography(Point, 4326),
  gps_accuracy_m    real,
  gps_source        text default 'device',  -- 'device', 'supervisor_device', 'manual'
  
  -- For adjustments: what are we correcting and why
  adjusts_event_id  uuid references public.time_events(id),
  adjust_reason     text,
  adjusted_by       uuid references public.profiles(id),
  
  -- Checkout video state machine
  video_status      public.checkout_video_status not null default 'not_required',
  video_storage_path text,
  
  -- Context
  notes             text,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now()
);

-- These indexes are critical — this table grows fast
create index idx_time_events_worker on public.time_events(profile_id, event_time desc);
create index idx_time_events_project on public.time_events(project_id, event_time desc);
create index idx_time_events_org_date on public.time_events(org_id, event_time desc);
create index idx_time_events_type on public.time_events(org_id, event_type, event_time desc);

-- ============================================================================
-- TASKS
-- ============================================================================
create type public.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.task_status as enum ('pending', 'in_progress', 'done', 'cancelled');

create table public.tasks (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  assigned_to     uuid references public.profiles(id) on delete set null,
  assigned_by     uuid references public.profiles(id) on delete set null,
  title           text not null,
  description     text,
  priority        public.task_priority not null default 'medium',
  status          public.task_status not null default 'pending',
  due_date        date,
  completed_at    timestamptz,
  completed_by    uuid references public.profiles(id),
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_tasks_assigned on public.tasks(assigned_to, status);
create index idx_tasks_project on public.tasks(project_id, status);
create index idx_tasks_org on public.tasks(org_id, status);

-- ============================================================================
-- MEDIA (references to Supabase Storage — never store blobs in the DB)
-- ============================================================================
create type public.media_type as enum ('photo', 'video', 'pdf', 'document');

create table public.media (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  uploaded_by     uuid references public.profiles(id) on delete set null,
  media_type      public.media_type not null,
  storage_path    text not null,                      -- path in Supabase Storage bucket
  filename        text,
  file_size       integer,                            -- bytes
  mime_type       text,
  caption         text,                               -- worker's voice/text comment
  is_checkout     boolean not null default false,      -- is this a checkout video?
  time_event_id   uuid references public.time_events(id),  -- linked to a clock event
  ai_analysis     jsonb,                               -- vision AI results
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index idx_media_project on public.media(project_id, created_at desc);
create index idx_media_uploader on public.media(uploaded_by, created_at desc);

-- ============================================================================
-- PAYROLL (closure-marker model)
--
-- A payroll run reads all time events since the last closure for each worker,
-- computes hours, snapshots the rate, and writes line items.
-- History is never destroyed.
-- ============================================================================
create type public.payroll_status as enum ('draft', 'confirmed', 'exported', 'paid');

create table public.payroll_runs (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  run_by          uuid references public.profiles(id),
  period_start    date not null,
  period_end      date not null,
  status          public.payroll_status not null default 'draft',
  total_hours     numeric(10,2) not null default 0,
  total_amount    numeric(12,2) not null default 0,
  notes           text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  confirmed_at    timestamptz
);

create table public.payroll_line_items (
  id              uuid primary key default uuid_generate_v4(),
  payroll_run_id  uuid not null references public.payroll_runs(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  project_id      uuid references public.projects(id),
  hours           numeric(10,2) not null,
  rate            numeric(10,2) not null,             -- snapshotted at run time
  amount          numeric(12,2) not null,             -- hours * rate
  event_ids       uuid[] not null default '{}',       -- which time_events this covers
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index idx_payroll_items_run on public.payroll_line_items(payroll_run_id);
create index idx_payroll_items_worker on public.payroll_line_items(profile_id);

-- Closure markers: tracks which events have been "paid through" per worker
create table public.payroll_closures (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  payroll_run_id  uuid not null references public.payroll_runs(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  closed_through  timestamptz not null,  -- all events up to this timestamp are paid
  created_at      timestamptz not null default now()
);

create index idx_closures_worker on public.payroll_closures(profile_id, closed_through desc);

-- ============================================================================
-- DAILY REPORTS (AI-generated summaries)
-- ============================================================================
create table public.daily_reports (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  profile_id      uuid references public.profiles(id) on delete set null,
  report_date     date not null,
  summary         text,                  -- AI-generated summary
  hours_worked    numeric(10,2),
  tasks_completed integer default 0,
  photos_taken    integer default 0,
  ai_insights     jsonb,                 -- structured AI analysis
  event_ids       uuid[] default '{}',   -- source events
  media_ids       uuid[] default '{}',   -- source media
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index idx_reports_date on public.daily_reports(org_id, report_date desc);

-- ============================================================================
-- SOFT DELETES: add deleted_at to all main tables
-- ============================================================================
alter table public.projects add column deleted_at timestamptz;
alter table public.profiles add column deleted_at timestamptz;
alter table public.tasks add column deleted_at timestamptz;
alter table public.media add column deleted_at timestamptz;

-- ============================================================================
-- AUTO-UPDATED timestamps
-- ============================================================================
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.organizations
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.projects
  for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.tasks
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- AUTO-CLOSE OPEN SESSIONS TRIGGER
-- When a worker clocks in, auto-close any open session they have elsewhere.
-- This prevents "forgot to clock out" from accumulating ghost hours.
-- ============================================================================
create or replace function public.auto_close_open_session()
returns trigger as $$
begin
  if new.event_type = 'clock_in' then
    -- Check for an open session (clock_in without a matching clock_out)
    -- and auto-close it 1 second before the new clock_in
    insert into public.time_events (
      org_id, profile_id, project_id, event_type, event_time, 
      notes, metadata
    )
    select 
      te.org_id, te.profile_id, te.project_id, 'auto_out',
      new.event_time - interval '1 second',
      'Auto-closed: worker clocked into ' || (select name from public.projects where id = new.project_id),
      jsonb_build_object('auto_closed_by_event', new.id)
    from public.time_events te
    where te.profile_id = new.profile_id
      and te.event_type = 'clock_in'
      and not exists (
        select 1 from public.time_events te2
        where te2.profile_id = te.profile_id
          and te2.event_type in ('clock_out', 'auto_out')
          and te2.event_time > te.event_time
      )
      and te.id != new.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_auto_close_session
  after insert on public.time_events
  for each row execute function public.auto_close_open_session();
