-- ============================================================================
-- WASH & RESET — schema reconciliation
--
-- This script drops all application tables from public and re-runs the
-- project's migrations in order (00001 … 00010), leaving the schema in
-- exactly the shape the application code expects.
--
-- Only legacy/inconsistent objects are removed. postgis's own tables
-- (spatial_ref_sys, geography_columns, geometry_columns) are left alone.
-- Supabase's auth.* / storage.* schemas are untouched.
--
-- Run this ONCE in the Supabase SQL editor. Afterwards run each of the
-- project's migrations (00001-00010) in order, also from the SQL editor.
--
-- ⚠️  DESTRUCTIVE. Deletes every app-table row. Confirmed safe after
--     audit 2026-04-19: all tables either empty or contain demo seeds only.
-- ============================================================================

begin;

-- Drop application tables. Order handles FK dependencies via CASCADE.
drop table if exists public.audit_log               cascade;
drop table if exists public.clients                 cascade;
drop table if exists public.daily_reports           cascade;
drop table if exists public.events                  cascade;
drop table if exists public.managers                cascade;
drop table if exists public.media                   cascade;
drop table if exists public.messages                cascade;
drop table if exists public.pay_period_items        cascade;
drop table if exists public.pay_periods             cascade;
drop table if exists public.payroll_closures        cascade;
drop table if exists public.payroll_line_items      cascade;
drop table if exists public.payroll_runs            cascade;
drop table if exists public.project_assignments     cascade;
drop table if exists public.projects                cascade;
drop table if exists public.profiles                cascade;
drop table if exists public.store_visits            cascade;
drop table if exists public.supply_stores           cascade;
drop table if exists public.tasks                   cascade;
drop table if exists public.time_events             cascade;
drop table if exists public.user_capabilities       cascade;
drop table if exists public.worker_live_locations   cascade;
drop table if exists public.worker_location_consents cascade;
drop table if exists public.workers                 cascade;
drop table if exists public.app_settings            cascade;
drop table if exists public.organizations           cascade;

-- Drop application types. Some of the tables we dropped own these; CASCADE
-- takes care of most, but types created in later migrations might linger.
drop type if exists public.user_role                cascade;
drop type if exists public.project_status           cascade;
drop type if exists public.time_event_type          cascade;
drop type if exists public.checkout_video_status    cascade;
drop type if exists public.task_priority            cascade;
drop type if exists public.task_status              cascade;
drop type if exists public.media_type               cascade;
drop type if exists public.payroll_status           cascade;
drop type if exists public.message_priority         cascade;
drop type if exists public.pay_period_status        cascade;

-- Drop helper functions from migrations 00002 / 00003 / 00010 — they
-- reference tables we just dropped and will be re-created by the
-- appropriate migration.
drop function if exists public.get_user_org_id()    cascade;
drop function if exists public.get_user_role()      cascade;
drop function if exists public.is_manager()        cascade;
drop function if exists public.is_owner()          cascade;
drop function if exists public.has_capability(text) cascade;
drop function if exists public.handle_updated_at()  cascade;
drop function if exists public.auto_close_open_session() cascade;

commit;

-- ============================================================================
-- After this script finishes with "Success. No rows returned", run:
--   00001_foundation.sql
--   00002_rls_policies.sql
--   00003_schema_gap.sql
--   00004_geofence_grace.sql
--   00005_app_settings.sql
--   00006_worker_require_video.sql
--   00008_project_gps_radius.sql
--   00009_message_priority.sql
--   00010_user_capabilities.sql
-- in the SQL editor, in this order.
-- ============================================================================
