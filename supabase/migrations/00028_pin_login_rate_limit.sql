-- Persistent rate limit state for /api/auth/pin-login.
-- Stores only hashed client identifiers, never raw IP addresses or PINs.

create table if not exists public.pin_login_rate_limits (
  key_hash text primary key,
  fail_count integer not null default 0,
  first_failed_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists pin_login_rate_limits_locked_until_idx
  on public.pin_login_rate_limits (locked_until);

alter table public.pin_login_rate_limits enable row level security;

revoke all on public.pin_login_rate_limits from anon, authenticated;

comment on table public.pin_login_rate_limits is
  'Server-side PIN login rate limit state. Accessed only by service-role API routes.';
