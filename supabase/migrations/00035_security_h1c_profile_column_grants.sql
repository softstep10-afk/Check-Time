-- ============================================================================
-- Security Hotfix H1C-2: enforce profile column grants
--
-- CANDIDATE MIGRATION SQL — DO NOT RUN WITHOUT DB-0 GATE AND OWNER APPROVAL.
--
-- Production migration history is not repaired. Do not run `supabase db push`.
-- Apply manually only after:
--   1. 00034_security_h1c_rate_rpc.sql has been applied and verified.
--   2. App code using public.get_profile_rates_for_finance() is deployed.
--   3. Owner/finance payroll and team rate screens are verified through RPC.
-- ============================================================================

-- Convert direct profile reads to explicit safe column grants. RLS still limits
-- rows by org; column grants prevent ordinary authenticated clients from
-- selecting compensation/PIN fields directly.
revoke select on table public.profiles from anon;
revoke select on table public.profiles from authenticated;

grant select (
  id,
  org_id,
  name,
  role,
  color,
  is_active,
  require_video,
  language,
  settings,
  last_clock_in,
  current_project,
  created_at,
  updated_at,
  deleted_at,
  notif_mode,
  project_access_mode
) on table public.profiles to authenticated;
