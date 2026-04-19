-- ============================================================================
-- CHECK-TIME: Schema gap migration (00003) — IDEMPOTENT
-- Safe to run multiple times. Creates only what's missing.
-- ============================================================================

-- 1. Add 'owner' to user_role enum
alter type public.user_role add value if not exists 'owner';

-- 2. Add start_date / end_date to projects
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists end_date   date;

-- 3. messages
create table if not exists public.messages (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sender_id     uuid not null references public.profiles(id) on delete cascade,
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  text          text not null default '',
  color         text not null default '#3b82f6',
  read          boolean not null default false,
  attachment    jsonb,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists idx_messages_recipient on public.messages(recipient_id, created_at desc);
create index if not exists idx_messages_org       on public.messages(org_id);

-- 4. supply_stores
create table if not exists public.supply_stores (
  id          uuid primary key default uuid_generate_v4(),
  chain       text not null,
  name        text not null,
  address     text,
  lat         double precision not null,
  lng         double precision not null,
  phone       text,
  place_id    text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_supply_stores_coords on public.supply_stores(lat, lng);

-- 5. store_visits
create table if not exists public.store_visits (
  id                  uuid primary key default uuid_generate_v4(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  worker_id           uuid not null references public.profiles(id) on delete cascade,
  store_id            uuid not null references public.supply_stores(id) on delete cascade,
  shift_id            uuid,
  entered_at          timestamptz not null,
  exited_at           timestamptz,
  duration_seconds    integer not null default 0,
  entry_lat           double precision,
  entry_lng           double precision,
  exit_lat            double precision,
  exit_lng            double precision,
  source_project_id   uuid references public.projects(id) on delete set null,
  worker_name         text,
  store_name          text,
  store_chain         text,
  source_project_name text,
  created_at          timestamptz not null default now(),
  constraint chk_min_dwell check (duration_seconds >= 180 or exited_at is null)
);
create index if not exists idx_store_visits_worker  on public.store_visits(worker_id, entered_at desc);
create index if not exists idx_store_visits_shift   on public.store_visits(shift_id);
create index if not exists idx_store_visits_project on public.store_visits(source_project_id);

-- 6. worker_live_locations
create table if not exists public.worker_live_locations (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  shift_id    uuid,
  lat         double precision not null,
  lng         double precision not null,
  accuracy    double precision,
  heading     double precision,
  speed       double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists idx_live_loc_worker on public.worker_live_locations(worker_id, recorded_at desc);
create index if not exists idx_live_loc_shift  on public.worker_live_locations(shift_id);

-- 7. worker_location_consents
create table if not exists public.worker_location_consents (
  id               uuid primary key default uuid_generate_v4(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  worker_id        uuid not null references public.profiles(id) on delete cascade,
  signed_name      text not null,
  consented        boolean not null,
  consent_version  integer not null default 1,
  user_agent       text,
  ip_address       text,
  signed_at        timestamptz not null default now()
);
create index if not exists idx_consents_worker on public.worker_location_consents(worker_id, signed_at desc);

-- 8. audit_log
create table if not exists public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_name  text not null,
  actor_role  text not null,
  action      text not null,
  target_type text,
  target_id   text,
  before_data jsonb,
  after_data  jsonb,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_org    on public.audit_log(org_id, created_at desc);
create index if not exists idx_audit_actor  on public.audit_log(actor_id);
create index if not exists idx_audit_action on public.audit_log(action);

-- 9. Enums for pay periods (idempotent)
do $$ begin
  create type public.pay_period_type as enum ('weekly', 'biweekly', 'semi-monthly', 'monthly', 'custom');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pay_period_status as enum ('draft', 'approved', 'paid', 'archived');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pay_item_status as enum ('pending', 'approved', 'paid');
exception when duplicate_object then null;
end $$;

-- 10. pay_periods
create table if not exists public.pay_periods (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  label         text not null,
  start_date    date not null,
  end_date      date not null,
  period_type   public.pay_period_type not null default 'biweekly',
  status        public.pay_period_status not null default 'draft',
  created_by    uuid references public.profiles(id) on delete set null,
  approved_by   uuid references public.profiles(id) on delete set null,
  approved_at   timestamptz,
  paid_at       timestamptz,
  notes         text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_pay_periods_org on public.pay_periods(org_id, start_date desc);

-- 11. pay_period_items
create table if not exists public.pay_period_items (
  id                   uuid primary key default uuid_generate_v4(),
  pay_period_id        uuid not null references public.pay_periods(id) on delete cascade,
  worker_id            uuid not null references public.profiles(id) on delete cascade,
  rate                 numeric(10,2) not null default 0,
  regular_hours        numeric(10,2) not null default 0,
  overtime_hours       numeric(10,2) not null default 0,
  overtime_multiplier  numeric(4,2) not null default 1.50,
  gross_regular        numeric(12,2) not null default 0,
  gross_overtime       numeric(12,2) not null default 0,
  bonus_amount         numeric(12,2) not null default 0,
  reimbursement_amount numeric(12,2) not null default 0,
  deduction_amount     numeric(12,2) not null default 0,
  gross_total          numeric(12,2) not null default 0,
  net_total            numeric(12,2) not null default 0,
  adjustments_json     jsonb not null default '[]',
  note                 text,
  status               public.pay_item_status not null default 'pending',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_pay_items_period on public.pay_period_items(pay_period_id);
create index if not exists idx_pay_items_worker on public.pay_period_items(worker_id);
