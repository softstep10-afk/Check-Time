-- ============================================================================
-- Security Hotfix H1C-1: finance-gated rate RPC
--
-- CANDIDATE MIGRATION SQL — DO NOT RUN WITHOUT DB-0 GATE AND OWNER APPROVAL.
--
-- Production migration history is not repaired. Do not run `supabase db push`.
-- This first candidate step is additive. Apply manually only after DB-0 Gate
-- and owner approval. It must exist before deploying app code that reads rates
-- through public.get_profile_rates_for_finance().
-- ============================================================================

create or replace function public.get_profile_rates_for_finance()
returns table (
  id uuid,
  org_id uuid,
  name text,
  role text,
  color text,
  is_active boolean,
  require_video boolean,
  language text,
  settings jsonb,
  last_clock_in timestamptz,
  current_project uuid,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  notif_mode text,
  project_access_mode text,
  hourly_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.has_finance_access(), false) then
    raise exception 'profile_rate_access_denied'
      using errcode = '42501';
  end if;

  return query
    select
      p.id,
      p.org_id,
      p.name,
      p.role::text,
      p.color,
      p.is_active,
      p.require_video,
      p.language,
      p.settings,
      p.last_clock_in,
      p.current_project,
      p.created_at,
      p.updated_at,
      p.deleted_at,
      p.notif_mode::text,
      p.project_access_mode::text,
      p.hourly_rate
    from public.profiles p
    where p.org_id = public.get_user_org_id()
      and p.deleted_at is null;
end;
$$;

revoke all on function public.get_profile_rates_for_finance() from public;
revoke all on function public.get_profile_rates_for_finance() from anon;
grant execute on function public.get_profile_rates_for_finance() to authenticated;
