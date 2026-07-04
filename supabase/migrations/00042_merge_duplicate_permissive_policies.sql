-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 10: C5+C6 — merge duplicate permissive policies; split ALL policies ----------
BEGIN;
DROP POLICY "Managers can upload media for anyone" ON public.media;
DROP POLICY "Users can upload media" ON public.media;
CREATE POLICY media_insert ON public.media FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_user_org_id()) AND (is_manager() OR (uploaded_by = (SELECT auth.uid()))));
DROP POLICY media_flags_select_assigned ON public.media_flags;
DROP POLICY media_flags_select_manager ON public.media_flags;
CREATE POLICY media_flags_select ON public.media_flags FOR SELECT TO authenticated USING (
  (EXISTS ( SELECT 1
     FROM (media m JOIN project_assignments pa ON ((pa.project_id = m.project_id)))
    WHERE ((m.id = media_flags.media_id) AND (pa.profile_id = (SELECT auth.uid())))))
  OR
  ((get_user_role() = ANY (ARRAY['supervisor'::user_role, 'manager'::user_role, 'admin'::user_role, 'owner'::user_role]))
    AND (EXISTS ( SELECT 1 FROM media m WHERE ((m.id = media_flags.media_id) AND (m.org_id = get_user_org_id())))))
);
DROP POLICY "Finance users can view payroll closures" ON public.payroll_closures;
DROP POLICY "Workers can view own payroll closures" ON public.payroll_closures;
CREATE POLICY payroll_closures_select ON public.payroll_closures FOR SELECT TO authenticated
  USING ((org_id = get_user_org_id()) AND (has_finance_access() OR (profile_id = (SELECT auth.uid()))));
DROP POLICY "Managers can update profiles in their org" ON public.profiles;
DROP POLICY "Users can update their own profile" ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (((org_id = get_user_org_id()) AND is_manager()) OR (id = (SELECT auth.uid())));
DROP POLICY "Managers can view org acks" ON public.safety_acknowledgements;
DROP POLICY "Workers can view own acks" ON public.safety_acknowledgements;
CREATE POLICY safety_acks_select ON public.safety_acknowledgements FOR SELECT TO authenticated
  USING (((org_id = get_user_org_id()) AND is_manager()) OR (worker_id = (SELECT auth.uid())));
DROP POLICY "Managers can insert any time events" ON public.time_events;
DROP POLICY "Workers can insert their own clock events" ON public.time_events;
CREATE POLICY time_events_insert ON public.time_events FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_user_org_id()) AND (is_manager()
    OR ((profile_id = (SELECT auth.uid())) AND (event_type = ANY (ARRAY['clock_in'::time_event_type, 'clock_out'::time_event_type])))));
DROP POLICY "Managers can manage assignments" ON public.project_assignments;
CREATE POLICY project_assignments_insert_manager ON public.project_assignments FOR INSERT TO authenticated
  WITH CHECK ((org_id = get_user_org_id()) AND is_manager());
CREATE POLICY project_assignments_update_manager ON public.project_assignments FOR UPDATE TO authenticated
  USING ((org_id = get_user_org_id()) AND is_manager());
CREATE POLICY project_assignments_delete_manager ON public.project_assignments FOR DELETE TO authenticated
  USING ((org_id = get_user_org_id()) AND is_manager());
DROP POLICY supply_stores_write_manager ON public.supply_stores;
CREATE POLICY supply_stores_insert_manager ON public.supply_stores FOR INSERT TO authenticated
  WITH CHECK (is_manager());
CREATE POLICY supply_stores_update_manager ON public.supply_stores FOR UPDATE TO authenticated
  USING (is_manager()) WITH CHECK (is_manager());
CREATE POLICY supply_stores_delete_manager ON public.supply_stores FOR DELETE TO authenticated
  USING (is_manager());
DROP POLICY user_capabilities_write_finance_access ON public.user_capabilities;
DROP POLICY user_capabilities_write_same_org_nonfinance ON public.user_capabilities;
CREATE POLICY user_capabilities_insert ON public.user_capabilities FOR INSERT TO authenticated WITH CHECK (
  EXISTS ( SELECT 1 FROM profiles target, profiles actor
    WHERE target.id = user_capabilities.user_id
      AND actor.id = (SELECT auth.uid())
      AND actor.org_id = target.org_id
      AND ( ((capability = 'finance_access'::text) AND (actor.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role])))
         OR ((capability <> 'finance_access'::text) AND (actor.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'owner'::user_role]))) ))
);
CREATE POLICY user_capabilities_update ON public.user_capabilities FOR UPDATE TO authenticated USING (
  EXISTS ( SELECT 1 FROM profiles target, profiles actor
    WHERE target.id = user_capabilities.user_id
      AND actor.id = (SELECT auth.uid())
      AND actor.org_id = target.org_id
      AND ( ((capability = 'finance_access'::text) AND (actor.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role])))
         OR ((capability <> 'finance_access'::text) AND (actor.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'owner'::user_role]))) ))
) WITH CHECK (
  EXISTS ( SELECT 1 FROM profiles target, profiles actor
    WHERE target.id = user_capabilities.user_id
      AND actor.id = (SELECT auth.uid())
      AND actor.org_id = target.org_id
      AND ( ((capability = 'finance_access'::text) AND (actor.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role])))
         OR ((capability <> 'finance_access'::text) AND (actor.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'owner'::user_role]))) ))
);
CREATE POLICY user_capabilities_delete ON public.user_capabilities FOR DELETE TO authenticated USING (
  EXISTS ( SELECT 1 FROM profiles target, profiles actor
    WHERE target.id = user_capabilities.user_id
      AND actor.id = (SELECT auth.uid())
      AND actor.org_id = target.org_id
      AND ( ((capability = 'finance_access'::text) AND (actor.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role])))
         OR ((capability <> 'finance_access'::text) AND (actor.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'owner'::user_role]))) ))
);
COMMIT;
