-- ============================================================================
-- 00013 — is_manager() must include 'owner' (and 'supervisor' for completeness)
--
-- The original is_manager() from 00002 only accepted ('manager', 'admin').
-- 'owner' was added to the user_role enum in 00003 but is_manager() was
-- never updated, so Owners pass SELECT policies (org_id match) but fail
-- every INSERT/UPDATE/DELETE policy that calls is_manager() — projects,
-- tasks, project_assignments, time_events, media, payroll, closures.
--
-- Fix: widen is_manager() to include every manager-tier role. This is a
-- single-function swap — every existing policy that calls is_manager()
-- picks up the new definition automatically.
--
-- Safe to run multiple times.
-- ============================================================================

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select role in ('owner', 'admin', 'manager', 'supervisor')
  from public.profiles
  where id = auth.uid()
$$;
