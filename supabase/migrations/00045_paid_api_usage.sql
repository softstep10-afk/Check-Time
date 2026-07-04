-- Persistent paid-provider rate/budget state for server-side paid endpoints.
-- Stores only hashed caller/org bucket identifiers; never raw org_id/profile_id.

create table if not exists public.paid_api_usage (
  key_hash text primary key,
  bucket text not null check (bucket in ('burst', 'daily')),
  route text not null,
  provider text not null,
  usage_day date not null,
  request_count integer not null default 0,
  window_started_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists paid_api_usage_bucket_provider_day_idx
  on public.paid_api_usage (bucket, provider, usage_day);

create index if not exists paid_api_usage_locked_until_idx
  on public.paid_api_usage (locked_until);

alter table public.paid_api_usage enable row level security;

revoke all on public.paid_api_usage from anon, authenticated;

grant select, insert, update on public.paid_api_usage to service_role;

comment on table public.paid_api_usage is
  'Server-side paid API rate limit and daily budget state. Accessed only by service-role API routes.';

