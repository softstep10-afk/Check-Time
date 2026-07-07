-- Geofencing G1 — server-derived geofence status changes for open shifts.
--
-- One row per STATUS CHANGE of an open shift (append-only, status-change-only —
-- the /api/cron/geofence-scan route only appends when the computed status
-- differs from the shift's latest recorded event, so no per-tick spam).
--
-- Mirror only: the owner applies this by hand AFTER deploy+smoke. Until then the
-- app code no-ops gracefully (missing-table errors are detected and skipped, not
-- thrown) — same pattern as push_subscriptions (00046) / paid_api_usage (00045).

create table if not exists public.shift_geo_events (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  -- The open clock_in time_events.id this evaluation belongs to. Matches
  -- worker_live_locations.shift_id. Not FK-constrained: time_events is
  -- high-churn and we never want an event insert to fail on a race.
  shift_id             uuid not null,
  worker_id            uuid not null references public.profiles (id) on delete cascade,
  project_id           uuid references public.projects (id) on delete set null,
  -- enum-like: 'in_zone' | 'out_of_zone' | 'no_signal'
  status               text not null check (status in ('in_zone', 'out_of_zone', 'no_signal')),
  -- Minutes since the latest live point when evaluated. Set for every status;
  -- the driving signal for 'no_signal'. Null only if unknown.
  minutes_since_signal integer,
  -- Straight-line metres from the project fence centre. Null for 'no_signal'
  -- (the stale point's distance is untrustworthy).
  distance_m           double precision,
  created_at           timestamptz not null default now()
);

-- Latest-event-per-shift lookup (status-change dedup) + manager timeline reads.
create index if not exists shift_geo_events_shift_created_idx
  on public.shift_geo_events (shift_id, created_at desc);
create index if not exists shift_geo_events_org_created_idx
  on public.shift_geo_events (org_id, created_at desc);

alter table public.shift_geo_events enable row level security;

-- Writes are service-role only (the /api/cron/geofence-scan route). No anon
-- access at all; authenticated (managers) get SELECT only, gated by RLS below.
revoke all on public.shift_geo_events from anon, authenticated;
grant select on public.shift_geo_events to authenticated;
grant select, insert on public.shift_geo_events to service_role;

-- Managers (owner/admin/manager/supervisor) may read their own org's events.
-- Mirrors the manager-read half of wll_select_self_or_manager (00014) and the
-- audit_log manager-read policy. No worker/client writes (no insert policy →
-- denied for everyone except service_role, which bypasses RLS).
drop policy if exists shift_geo_events_select_manager on public.shift_geo_events;
create policy shift_geo_events_select_manager
  on public.shift_geo_events for select
  using (
    org_id = public.get_user_org_id()
    and public.is_manager()
  );

comment on table public.shift_geo_events is
  'Server-derived geofence status changes for open shifts (Geofencing G1). Append-only, status-change-only. Written by service-role /api/cron/geofence-scan; managers read their own org. No worker/client writes.';
