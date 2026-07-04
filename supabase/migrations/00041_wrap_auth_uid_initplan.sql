-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 09: C4 — auth_rls_initplan: wrap auth.uid() in (SELECT ...) in 31 policies ----------
-- NOTE: applied as ALTER POLICY set generated from live pg_policies; expressions unchanged
-- except auth.uid() -> (SELECT auth.uid()). Reproduce in migration EXACTLY as below.
ALTER POLICY app_settings_select_all ON public.app_settings USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY app_settings_update_owner ON public.app_settings USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.role = ANY (ARRAY['owner'::user_role, 'admin'::user_role]))))));
ALTER POLICY audit_log_insert_self ON public.audit_log WITH CHECK (((org_id = get_user_org_id()) AND ((actor_id = (SELECT auth.uid())) OR (actor_id IS NULL))));
ALTER POLICY "Users can upload media" ON public.media WITH CHECK (((org_id = get_user_org_id()) AND (uploaded_by = (SELECT auth.uid()))));
ALTER POLICY media_select_role_aware ON public.media USING (((org_id = get_user_org_id()) AND (deleted_at IS NULL) AND (((COALESCE((metadata ->> 'category'::text), ''::text) <> 'receipt'::text) AND (COALESCE((metadata ->> 'kind'::text), ''::text) <> 'receipt'::text) AND ((get_user_role() = ANY (ARRAY['supervisor'::user_role, 'manager'::user_role, 'admin'::user_role, 'owner'::user_role])) OR (uploaded_by = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM project_assignments pa
  WHERE ((pa.profile_id = (SELECT auth.uid())) AND (pa.project_id = media.project_id)))) OR (EXISTS ( SELECT 1
   FROM (profiles p
     JOIN projects proj ON ((proj.id = media.project_id)))
  WHERE ((p.id = (SELECT auth.uid())) AND (p.project_access_mode = 'all_active'::text) AND (proj.status = 'active'::project_status) AND (proj.deleted_at IS NULL) AND (NOT (EXISTS ( SELECT 1
           FROM project_exclusions pe
          WHERE ((pe.profile_id = (SELECT auth.uid())) AND (pe.project_id = media.project_id)))))))))) OR (((COALESCE((metadata ->> 'category'::text), ''::text) = 'receipt'::text) OR (COALESCE((metadata ->> 'kind'::text), ''::text) = 'receipt'::text)) AND (has_finance_access() OR (uploaded_by = (SELECT auth.uid())))))));
ALTER POLICY media_flags_insert_assigned ON public.media_flags WITH CHECK (((flagged_by = (SELECT auth.uid())) AND (EXISTS ( SELECT 1
   FROM media m
  WHERE ((m.id = media_flags.media_id) AND (((get_user_role() = ANY (ARRAY['supervisor'::user_role, 'manager'::user_role, 'admin'::user_role, 'owner'::user_role])) AND (m.org_id = get_user_org_id())) OR (EXISTS ( SELECT 1
           FROM project_assignments pa
          WHERE ((pa.profile_id = (SELECT auth.uid())) AND (pa.project_id = m.project_id))))))))));
ALTER POLICY messages_insert_self ON public.messages WITH CHECK (((org_id = get_user_org_id()) AND (sender_id = (SELECT auth.uid()))));
ALTER POLICY messages_select_participant ON public.messages USING (((org_id = get_user_org_id()) AND ((sender_id = (SELECT auth.uid())) OR (recipient_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY messages_update_recipient ON public.messages USING (((org_id = get_user_org_id()) AND ((recipient_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY project_exclusions_manager_delete ON public.project_exclusions USING ((is_manager() AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.org_id = project_exclusions.org_id))))));
ALTER POLICY project_exclusions_manager_insert ON public.project_exclusions WITH CHECK ((is_manager() AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.org_id = project_exclusions.org_id))))));
ALTER POLICY project_exclusions_manager_update ON public.project_exclusions USING ((is_manager() AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.org_id = project_exclusions.org_id)))))) WITH CHECK ((is_manager() AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.org_id = project_exclusions.org_id))))));
ALTER POLICY project_exclusions_select_own_org ON public.project_exclusions USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.org_id = project_exclusions.org_id)))));
ALTER POLICY "Workers can insert own acks" ON public.safety_acknowledgements WITH CHECK (((worker_id = (SELECT auth.uid())) AND (org_id = get_user_org_id())));
ALTER POLICY store_visits_insert_self_or_manager ON public.store_visits WITH CHECK (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY store_visits_select_org ON public.store_visits USING (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY store_visits_update_self_or_manager ON public.store_visits USING (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY supply_stores_select_all ON public.supply_stores USING (((SELECT auth.uid()) IS NOT NULL));
ALTER POLICY "View time events by role" ON public.time_events USING (((org_id = get_user_org_id()) AND (is_manager() OR (profile_id = (SELECT auth.uid())))));
ALTER POLICY user_capabilities_select_same_org ON public.user_capabilities USING (((user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles target,
    profiles actor
  WHERE ((target.id = user_capabilities.user_id) AND (actor.id = (SELECT auth.uid())) AND (actor.role = ANY (ARRAY['manager'::user_role, 'admin'::user_role, 'owner'::user_role])) AND (actor.org_id = target.org_id))))));
ALTER POLICY wll_insert_self_or_manager ON public.worker_live_locations WITH CHECK (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY wll_select_self_or_manager ON public.worker_live_locations USING (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
ALTER POLICY wlc_insert_self ON public.worker_location_consents WITH CHECK (((org_id = get_user_org_id()) AND (worker_id = (SELECT auth.uid()))));
ALTER POLICY wlc_select_self_or_manager ON public.worker_location_consents USING (((org_id = get_user_org_id()) AND ((worker_id = (SELECT auth.uid())) OR is_manager())));
-- NOTE: the following C4 targets were later REPLACED by section 10 (C5+C6) and must NOT be
-- mirrored as ALTERs for policies that section 10 drops:
--   "Users can upload media" is dropped+merged in 10; payroll_closures worker policy dropped in 10;
--   profiles "Users can update their own profile" dropped in 10; safety "Workers can view own acks" dropped in 10;
--   time_events "Workers can insert their own clock events" dropped in 10.
-- Keep migrations consistent: apply 09 first, then 10, exactly as prod history.
