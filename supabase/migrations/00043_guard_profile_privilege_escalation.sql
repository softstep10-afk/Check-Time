-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 11: S1 — guard against self-privilege-escalation on profiles ----------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_cols()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_manager() THEN
    NEW.role := OLD.role;
    NEW.org_id := OLD.org_id;
    NEW.is_active := OLD.is_active;
    NEW.require_video := OLD.require_video;
    NEW.project_access_mode := OLD.project_access_mode;
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.protect_profile_privileged_cols() FROM anon, authenticated;
DROP TRIGGER IF EXISTS trg_protect_profile_privileged_cols ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_cols
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_cols();
