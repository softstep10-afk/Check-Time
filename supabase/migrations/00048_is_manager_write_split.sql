-- 00048 — is_manager() write-level split (is_manager_write()).
--
-- DOCUMENTATION-OF-RECORD ONLY. This SQL was APPLIED TO PROD BY HAND on
-- 2026-07-07 via the Supabase SQL editor. This file mirrors it verbatim so the
-- repo matches prod; do NOT re-apply.
--
-- What it does:
--   * Splits authorization into two tiers. is_manager() (owner/admin/manager/
--     supervisor) is unchanged and still gates READ policies, so supervisors
--     keep operational read access. A new write-level helper is_manager_write()
--     returns true only for owner/admin/manager — SUPERVISOR IS EXCLUDED.
--   * Repoints all 21 mutation policies (INSERT/UPDATE/DELETE across profiles,
--     time_events, projects, tasks, project_assignments, project_exclusions,
--     supply_stores, store_visits, worker_live_locations, media, messages) and
--     the profile-protection trigger (protect_profile_privileged_cols) from
--     is_manager() to is_manager_write(). Read policies on is_manager() are left
--     unchanged.
--
-- Verified in prod by supervisor-impersonation smoke: role-escalation blocked,
-- time_events insert denied, foreign pin_hash pinned, reads intact, owner writes
-- intact.

begin;

create or replace function public.is_manager_write()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select role in ('manager', 'admin', 'owner')
  from public.profiles
  where id = auth.uid()
$$;

alter policy "Managers can insert profiles" on public.profiles
  with check ((org_id = get_user_org_id()) and is_manager_write());
alter policy "profiles_update" on public.profiles
  using (((org_id = get_user_org_id()) and is_manager_write()) or (id = (select auth.uid())));

alter policy "time_events_insert" on public.time_events
  with check ((org_id = get_user_org_id()) and is_manager_write());

alter policy "Managers can insert projects" on public.projects
  with check ((org_id = get_user_org_id()) and is_manager_write());
alter policy "Managers can update projects" on public.projects
  using ((org_id = get_user_org_id()) and is_manager_write());

alter policy "Managers can insert tasks" on public.tasks
  with check ((org_id = get_user_org_id()) and is_manager_write());
alter policy "Managers can update any task" on public.tasks
  using ((org_id = get_user_org_id()) and is_manager_write());

alter policy "project_assignments_insert_manager" on public.project_assignments
  with check ((org_id = get_user_org_id()) and is_manager_write());
alter policy "project_assignments_update_manager" on public.project_assignments
  using ((org_id = get_user_org_id()) and is_manager_write());
alter policy "project_assignments_delete_manager" on public.project_assignments
  using ((org_id = get_user_org_id()) and is_manager_write());

alter policy "project_exclusions_manager_insert" on public.project_exclusions
  with check (is_manager_write() and (exists (select 1 from profiles p
    where p.id = (select auth.uid()) and p.org_id = project_exclusions.org_id)));
alter policy "project_exclusions_manager_update" on public.project_exclusions
  using (is_manager_write() and (exists (select 1 from profiles p
    where p.id = (select auth.uid()) and p.org_id = project_exclusions.org_id)))
  with check (is_manager_write() and (exists (select 1 from profiles p
    where p.id = (select auth.uid()) and p.org_id = project_exclusions.org_id)));
alter policy "project_exclusions_manager_delete" on public.project_exclusions
  using (is_manager_write() and (exists (select 1 from profiles p
    where p.id = (select auth.uid()) and p.org_id = project_exclusions.org_id)));

alter policy "supply_stores_insert_manager" on public.supply_stores
  with check (is_manager_write());
alter policy "supply_stores_update_manager" on public.supply_stores
  using (is_manager_write()) with check (is_manager_write());
alter policy "supply_stores_delete_manager" on public.supply_stores
  using (is_manager_write());

alter policy "store_visits_insert_self_or_manager" on public.store_visits
  with check ((org_id = get_user_org_id()) and ((worker_id = (select auth.uid())) or is_manager_write()));
alter policy "store_visits_update_self_or_manager" on public.store_visits
  using ((org_id = get_user_org_id()) and ((worker_id = (select auth.uid())) or is_manager_write()));

alter policy "wll_insert_self_or_manager" on public.worker_live_locations
  with check ((org_id = get_user_org_id()) and ((worker_id = (select auth.uid())) or is_manager_write()));

alter policy "media_insert" on public.media
  with check ((org_id = get_user_org_id()) and (is_manager_write() or (uploaded_by = (select auth.uid()))));

alter policy "messages_update_recipient" on public.messages
  using ((org_id = get_user_org_id()) and ((recipient_id = (select auth.uid())) or is_manager_write()));

create or replace function public.protect_profile_privileged_cols()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if auth.uid() is not null and not is_manager_write() then
    new.role := old.role;
    new.org_id := old.org_id;
    new.is_active := old.is_active;
    new.require_video := old.require_video;
    new.project_access_mode := old.project_access_mode;
    new.deleted_at := old.deleted_at;
    new.pin_hash := old.pin_hash;
  end if;
  return new;
end $$;

commit;
