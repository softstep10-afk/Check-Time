-- ============================================================================
-- 00029 — Storage policy hardening for media bucket
--
-- Purpose:
--   Replace bucket-wide authenticated Storage read/upload policies with
--   policies tied to app rows and org-prefixed paths. Legacy direct/private
--   message attachment reads are preserved through public.messages rows, but
--   new uploads must use the org_id path prefix.
--
-- Preconditions applied:
--   1. Owner explicitly approved Storage Phase 1 policy hardening.
--   2. SELECT-only inventory confirmed media bucket paths:
--        - 40 org-prefixed public.media objects.
--        - 1 legacy messages/... object.
--   3. SELECT-only inventory confirmed the legacy messages/... object is
--      represented by public.messages.attachment->>'storagePath'.
--
-- Safety:
--   - No data delete.
--   - Bucket remains private.
--   - No Storage DELETE policy is added.
--   - App-level media delete remains soft-delete only in public.media.
--
-- Rollback:
--   Drop the two new policies and recreate:
--     "authenticated can read media"    using (bucket_id = 'media')
--     "authenticated can upload to media" with check (bucket_id = 'media')
-- ============================================================================

begin;

drop policy if exists "authenticated can read media" on storage.objects;
drop policy if exists "authenticated can upload to media" on storage.objects;
drop policy if exists "media objects read through linked app rows" on storage.objects;
drop policy if exists "media objects upload org scoped with legacy messages" on storage.objects;
drop policy if exists "media objects upload org scoped" on storage.objects;

create policy "media objects read through linked app rows"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'media'
    and (
      exists (
        select 1
        from public.media m
        where regexp_replace(regexp_replace(coalesce(m.storage_path, ''), '^/', ''), '^media/', '') = storage.objects.name
          and m.org_id = public.get_user_org_id()
          and m.deleted_at is null
          and (
            public.get_user_role() in ('supervisor', 'manager', 'admin', 'owner')
            or m.uploaded_by = auth.uid()
            or exists (
              select 1
              from public.project_assignments pa
              where pa.profile_id = auth.uid()
                and pa.project_id = m.project_id
            )
            or exists (
              select 1
              from public.profiles p
              join public.projects proj on proj.id = m.project_id
              where p.id = auth.uid()
                and p.project_access_mode = 'all_active'
                and proj.status = 'active'
                and proj.deleted_at is null
                and not exists (
                  select 1
                  from public.project_exclusions pe
                  where pe.profile_id = auth.uid()
                    and pe.project_id = m.project_id
                )
            )
          )
      )
      or exists (
        select 1
        from public.messages msg
        where regexp_replace(regexp_replace(coalesce(msg.attachment->>'storagePath', ''), '^/', ''), '^media/', '') = storage.objects.name
          and msg.org_id = public.get_user_org_id()
          and (
            msg.sender_id = auth.uid()
            or msg.recipient_id = auth.uid()
            or public.is_manager()
          )
      )
    )
  );

create policy "media objects upload org scoped"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and split_part(name, '/', 1) = public.get_user_org_id()::text
  );

commit;
