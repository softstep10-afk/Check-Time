-- ============================================================================
-- 00031 - Safety Brief typed signature storage
--
-- Owner-approved Alpha-7 safety hardening.
--
-- Adds a typed worker name to Safety Brief acknowledgement rows so the
-- audit trail contains the worker/profile/org/version/timestamp linkage
-- already present in 00019 plus the worker's electronic signature name.
--
-- Safe to re-run:
-- - additive column only
-- - no data deletion
-- - no payroll/GPS/shift calculation changes
-- - no RLS policy changes
-- ============================================================================

begin;

alter table public.safety_acknowledgements
  add column if not exists signed_name text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'safety_acknowledgements_signed_name_not_blank'
      and conrelid = 'public.safety_acknowledgements'::regclass
  ) then
    alter table public.safety_acknowledgements
      add constraint safety_acknowledgements_signed_name_not_blank
      check (signed_name is null or length(btrim(signed_name)) > 0);
  end if;
end
$$;

comment on column public.safety_acknowledgements.signed_name is
  'Typed worker name captured as the electronic signature for a Safety Brief acknowledgement.';

commit;
