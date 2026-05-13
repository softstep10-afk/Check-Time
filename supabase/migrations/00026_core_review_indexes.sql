-- 00026 — Core review indexes
--
-- No data rewrite, no RLS rewrite. These indexes support the manager
-- command center, audit review, archive/payroll smoke checks, and receipt
-- proof lookups added during the core hardening pass.

begin;

create index if not exists idx_audit_org_action_created
  on public.audit_log(org_id, action, created_at desc);

create index if not exists idx_audit_org_target_created
  on public.audit_log(org_id, target_type, target_id, created_at desc);

create index if not exists idx_tasks_active_project_status_created
  on public.tasks(project_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_tasks_active_assignee_status_created
  on public.tasks(assigned_to, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_media_active_project_created
  on public.media(project_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_media_receipts_project_created
  on public.media(project_id, created_at desc)
  where deleted_at is null
    and metadata->>'category' = 'receipt';

create index if not exists idx_time_events_adjust_worker_created
  on public.time_events(profile_id, event_time desc)
  where event_type = 'adjust';

create index if not exists idx_payroll_closures_run_worker_cutoff
  on public.payroll_closures(payroll_run_id, profile_id, closed_through desc);

commit;
