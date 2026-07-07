-- Web Push subscriptions (Push notifications Phase 1 — infrastructure).
--
-- One row per (device) push subscription for a worker profile. There is NO
-- client access: RLS is on with no anon/authenticated policy, and only the
-- service_role (used by the /api/worker/push/* routes) can read/write it — the
-- same server-only pattern as paid_api_usage / the time_events write path.
--
-- Mirror only: the owner applies this by hand AFTER deploy+smoke. Until then the
-- app code no-ops gracefully (missing-table errors are logged, not thrown).

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Fan-out lookup: "active subscriptions for this profile".
create index if not exists push_subscriptions_active_profile_idx
  on public.push_subscriptions (profile_id)
  where revoked_at is null;

alter table public.push_subscriptions enable row level security;

-- No client access at all: everything goes through service-role API routes.
revoke all on public.push_subscriptions from anon, authenticated;

grant select, insert, update, delete on public.push_subscriptions to service_role;

comment on table public.push_subscriptions is
  'Web Push subscriptions, one row per device per worker. Service-role only (accessed via /api/worker/push/* routes); no client/RLS access. Push notifications Phase 1.';
