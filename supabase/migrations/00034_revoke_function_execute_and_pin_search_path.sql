-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 02: A2 step 1 — revoke function EXECUTE + pin search_path ----------
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_capability(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.user_has_pay_period_items(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_payroll_closure_overlap() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_org_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_finance_access() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_manager() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pay_period_in_user_org(uuid) FROM anon;
ALTER FUNCTION public.handle_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_close_open_session() SET search_path = public, pg_temp;
