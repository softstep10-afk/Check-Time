-- ============================================================================
-- 00018 — Manager-controlled per-worker project visibility
--
-- Adds two surfaces:
--
--   1. profiles.project_access_mode
--        'list'        (default) — worker sees only the projects in
--                       project_assignments. Existing behavior, untouched.
--        'all_active'  — worker sees every project where status='active'
--                       AND deleted_at IS NULL, MINUS rows in the new
--                       project_exclusions table.
--
--   2. project_exclusions — deny-list, only used when a worker is in
--      'all_active' mode. Empty by default. Mirrors the RLS shape of
--      project_assignments: org members can SELECT, only managers can write.
--
-- Backward-compatible: every existing profile gets project_access_mode =
-- 'list' (the column default) and continues working against
-- project_assignments exactly as before. Switching a worker to 'all_active'
-- is opt-in via the manager UI; their existing project_assignments rows are
-- preserved so a flip back to 'list' restores the manual allowlist.
--
-- This migration does NOT change RLS on projects or tasks — visibility for
-- those tables is enforced at the application layer (worker-data.ts) for
-- this phase. Media + media_flags RLS keeps using project_assignments
-- (00011 / 00014) — left untouched on purpose. A future phase can extend
-- those policies to also honor project_access_mode.
--
-- Safe to re-run: every DDL statement is guarded with IF NOT EXISTS / DO
-- block existence checks.
-- ============================================================================

alter table public.profiles
  add column if not exists project_access_mode text not null default 'list';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_project_access_mode_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_project_access_mode_check
        check (project_access_mode in ('list', 'all_active'));
  end if;
end$$;

create table if not exists public.project_exclusions (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  excluded_at timestamptz not null default now(),
  unique(profile_id, project_id)
);

create index if not exists idx_project_exclusions_profile on public.project_exclusions(profile_id);
create index if not exists idx_project_exclusions_project on public.project_exclusions(project_id);

alter table public.project_exclusions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_exclusions'
      and policyname = 'Members can view exclusions in their org'
  ) then
    create policy "Members can view exclusions in their org"
      on public.project_exclusions for select
      using (org_id = public.get_user_org_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'project_exclusions'
      and policyname = 'Managers can manage exclusions'
  ) then
    create policy "Managers can manage exclusions"
      on public.project_exclusions for all
      using (org_id = public.get_user_org_id() and public.is_manager());
  end if;
end$$;
