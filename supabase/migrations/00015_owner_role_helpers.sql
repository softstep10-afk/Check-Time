-- ============================================================================
-- 00015 — owner role helpers (additive, non-breaking)
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--      Fully idempotent — safe to run multiple times.
--
-- WHY THIS EXISTS
--   The 'owner' enum value was added in 00003 and is_manager() was widened
--   in 00013 to accept ('owner','admin','manager','supervisor'). What's
--   still missing is a clean way to ask "is this OTHER user an owner /
--   manager?" — every existing helper resolves implicitly against
--   auth.uid(). Future RLS policies (e.g. "an owner may grant capabilities
--   to another user in the same org") will need that question answerable.
--
-- WHAT IT DOES
--   Adds three new functions, all SECURITY DEFINER + STABLE so they are
--   safe to call from RLS policy bodies:
--     • is_owner()              — current user is owner
--     • is_owner(uuid)          — given user is owner
--     • is_manager(uuid)        — given user is in the manager-tier set
--                                 (matches the zero-arg is_manager() body
--                                  added in 00013).
--
-- WHAT IT DOES NOT DO
--   Does not modify the existing zero-arg is_manager() or any policy.
--   Postgres allows overloading by argument list, so is_manager() and
--   is_manager(uuid) coexist without conflict. No existing policy bodies
--   are touched, so no current behavior changes.
-- ============================================================================

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role = 'owner' from public.profiles where id = auth.uid()
$$;

create or replace function public.is_owner(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role = 'owner' from public.profiles where id = target_id
$$;

create or replace function public.is_manager(target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role in ('owner', 'admin', 'manager', 'supervisor')
  from public.profiles where id = target_id
$$;

grant execute on function public.is_owner()         to anon, authenticated;
grant execute on function public.is_owner(uuid)     to anon, authenticated;
grant execute on function public.is_manager(uuid)   to anon, authenticated;

-- ============================================================================
-- VERIFICATION (run after the migration; expect three rows back)
-- ============================================================================
-- select proname, pg_get_function_arguments(oid) as args
-- from pg_proc
-- where pronamespace = 'public'::regnamespace
--   and proname in ('is_owner','is_manager')
-- order by proname, args;
-- ============================================================================
