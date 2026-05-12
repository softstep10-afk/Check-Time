-- 00023 — Archive foundation
--
-- Archive is historical read-only project state. Trash remains deleted_at.
-- This migration does not delete related records and does not change broad RLS.

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_projects_archive_lookup
  on public.projects(org_id, status, archived_at desc, updated_at desc)
  where deleted_at is null;

create index if not exists idx_tasks_project_archive_lookup
  on public.tasks(project_id, status, updated_at desc)
  where deleted_at is null;

create index if not exists idx_media_project_archive_lookup
  on public.media(project_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_time_events_project_archive_lookup
  on public.time_events(project_id, event_time desc);

create index if not exists idx_payroll_runs_archive_lookup
  on public.payroll_runs(org_id, status, period_end desc);

create index if not exists idx_payroll_line_items_worker_project
  on public.payroll_line_items(profile_id, project_id);

create index if not exists idx_pay_periods_archive_lookup
  on public.pay_periods(org_id, status, end_date desc);

create index if not exists idx_pay_period_items_worker_period
  on public.pay_period_items(worker_id, pay_period_id);
