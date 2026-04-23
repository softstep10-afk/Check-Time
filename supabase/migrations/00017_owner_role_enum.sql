-- ============================================================================
-- 00017 — owner role in the user_role enum + is_owner / is_manager helpers
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Idempotent.
--
-- The app code has treated 'owner' as a first-class role since Wave X1
-- (role hierarchy at src/lib/roles.ts). Migration 00003_schema_gap added
-- the enum value for the first time, but on some envs the enum still
-- predates it, so re-adding via `ADD VALUE IF NOT EXISTS` is safe here.
--
-- Also rebuilds the SECURITY DEFINER helpers so the RLS policies across
-- the rest of the schema can be written as `is_owner()` or `is_manager()`
-- without re-encoding the role list in every policy.
--
-- Rollback: not practical (enum values can't be removed without
-- recreating the type). The helpers can be DROPped with:
--   DROP FUNCTION IF EXISTS public.is_owner();
--   DROP FUNCTION IF EXISTS public.is_manager();
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'owner';

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'owner'
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('owner', 'admin', 'manager', 'supervisor')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_manager() TO authenticated;
