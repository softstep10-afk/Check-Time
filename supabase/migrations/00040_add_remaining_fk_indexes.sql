-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 08: C3 — remaining FK indexes ----------
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_store_visits_org ON public.store_visits(org_id);
CREATE INDEX IF NOT EXISTS idx_store_visits_store ON public.store_visits(store_id);
CREATE INDEX IF NOT EXISTS idx_live_loc_org ON public.worker_live_locations(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_closures_org ON public.payroll_closures(org_id);
CREATE INDEX IF NOT EXISTS idx_payroll_line_items_project ON public.payroll_line_items(project_id);
CREATE INDEX IF NOT EXISTS idx_media_flags_flagged_by ON public.media_flags(flagged_by);
CREATE INDEX IF NOT EXISTS idx_media_flags_reviewed_by ON public.media_flags(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_daily_reports_project ON public.daily_reports(project_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_profile ON public.daily_reports(profile_id);
CREATE INDEX IF NOT EXISTS idx_pay_periods_created_by ON public.pay_periods(created_by);
CREATE INDEX IF NOT EXISTS idx_pay_periods_approved_by ON public.pay_periods(approved_by);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_run_by ON public.payroll_runs(run_by);
CREATE INDEX IF NOT EXISTS idx_profile_rates_org ON public.profile_rates(org_id);
CREATE INDEX IF NOT EXISTS idx_assignments_org ON public.project_assignments(org_id);
CREATE INDEX IF NOT EXISTS idx_project_exclusions_org ON public.project_exclusions(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_archived_by ON public.projects(archived_by);
CREATE INDEX IF NOT EXISTS idx_safety_acks_check_in_event ON public.safety_acknowledgements(check_in_event_id);
CREATE INDEX IF NOT EXISTS idx_user_capabilities_granted_by ON public.user_capabilities(granted_by);
CREATE INDEX IF NOT EXISTS idx_wlc_org ON public.worker_location_consents(org_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON public.app_settings(updated_by);
