-- ============================================================================
-- 00020 — Media SELECT RLS aligned with profiles.project_access_mode
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--
-- WHY THIS EXISTS
--   Migration 00018 added profiles.project_access_mode = 'all_active', which
--   lets a worker see every active project minus rows in project_exclusions
--   (without needing project_assignments rows). Worker-data.ts already
--   honors that mode for the project list, but the media SELECT policy
--   from 00011 / 00014 was left tied strictly to project_assignments.
--
--   Result: a worker on 'all_active' could open a project page and read
--   tasks, but the Project Media list, photos, and checkout videos for
--   that same project came back empty because RLS filtered them out.
--   The two surfaces disagreed about what the worker is allowed to see.
--
-- WHAT THIS DOES
--   Replaces media_select_role_aware with a policy that ALSO permits
--   worker-tier roles to read a media row when ALL of:
--     • the row's project is active and not soft-deleted
--     • the worker's profile.project_access_mode = 'all_active'
--     • the project is NOT in project_exclusions for that worker
--
--   The existing 'list'-mode rule (project_assignments membership) is
--   preserved unchanged for backward compatibility — workers still on the
--   default access mode keep the exact behavior they had before.
--
--   INSERT / UPDATE / DELETE policies are NOT touched.
--
-- ROLLBACK
--   Re-run 00014's policy block (the create policy media_select_role_aware
--   statement), which restores the project_assignments-only check.
--
-- Safe to re-run.
-- ============================================================================

begin;

drop policy if exists media_select_role_aware on public.media;

create policy media_select_role_aware
  on public.media
  for select
  using (
    org_id = public.get_user_org_id()
    and deleted_at is null
    and (
      -- Manager-tier roles see everything in the org.
      public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')

      -- Workers always see media they uploaded themselves (their own
      -- journal entries) regardless of current assignment status.
      or media.uploaded_by = auth.uid()

      -- 'list' mode (default): explicit project_assignments membership.
      or exists (
        select 1
        from public.project_assignments pa
        where pa.profile_id = auth.uid()
          and pa.project_id = media.project_id
      )

      -- 'all_active' mode: worker sees media for any active, non-deleted
      -- project that is not in their project_exclusions list. Mirrors
      -- the project visibility rule used by worker-data.ts.
      or exists (
        select 1
        from public.profiles p
        join public.projects proj on proj.id = media.project_id
        where p.id = auth.uid()
          and p.project_access_mode = 'all_active'
          and proj.status = 'active'
          and proj.deleted_at is null
          and not exists (
            select 1 from public.project_exclusions pe
            where pe.profile_id = auth.uid()
              and pe.project_id = media.project_id
          )
      )
    )
  );

commit;

-- ============================================================================
-- VERIFICATION (run as a worker on 'all_active' mode after the migration):
--
-- -- (a) Confirm the policy is the new one:
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='media' and cmd='SELECT';
--
-- -- (b) As an 'all_active' worker (set their profile.project_access_mode
-- --     to 'all_active' first), open a project they have NO row in
-- --     project_assignments for and verify supabase.from('media') returns
-- --     non-zero rows for that project.
-- ============================================================================
