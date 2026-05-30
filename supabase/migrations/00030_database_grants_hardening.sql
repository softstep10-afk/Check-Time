-- ============================================================================
-- 00030 — Database grants hardening
--
-- Purpose:
--   Reduce unnecessary broad table grants found during Alpha-7 Supabase Step 0
--   without changing application behavior. RLS remains the authorization model
--   for authenticated users.
--
-- Applied model:
--   - anon: no write-like table grants on public/storage relations.
--   - authenticated: keep SELECT/INSERT/UPDATE/DELETE where app + RLS need
--     them; remove TRUNCATE/REFERENCES/TRIGGER because the app does not use
--     these relation privileges.
--
-- Safety:
--   - No data delete.
--   - No schema/table changes.
--   - No RLS/Storage policy changes.
--   - No payroll/shift/archive data changes.
--   - Reversible by restoring grants from backup/audit output if needed.
-- ============================================================================

begin;

do $$
declare
  relation record;
begin
  for relation in
    select distinct table_schema, table_name
    from information_schema.role_table_grants
    where table_schema in ('public', 'storage')
      and grantee = 'anon'
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table %I.%I from anon',
      relation.table_schema,
      relation.table_name
    );
  end loop;

  for relation in
    select distinct table_schema, table_name
    from information_schema.role_table_grants
    where table_schema in ('public', 'storage')
      and grantee = 'authenticated'
  loop
    execute format(
      'revoke truncate, references, trigger on table %I.%I from authenticated',
      relation.table_schema,
      relation.table_name
    );
  end loop;
end $$;

commit;
