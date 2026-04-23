-- ============================================================================
-- 00016 — projects.timeline_status + projects.budget_status (clickable dots)
--
-- ⚠️  RUN MANUALLY via the Supabase SQL editor. Do NOT auto-apply.
--
-- Adds two text columns to public.projects that drive dots 2 and 3 in the
-- new traffic-light header on each project card (Wave 6 Section 2). Dot 1
-- keeps the existing activity-state logic (live/open/stale/inactive)
-- derived from live presence + last event time.
--
--   timeline_status — project schedule health
--     on_track  (default, lime)
--     at_risk   (yellow)
--     delayed   (red)
--
--   budget_status — project cost health
--     on_budget   (default, lime)
--     over_budget (yellow)
--     critical    (red)
--
-- The UI cycles the values on click (on_track → at_risk → delayed →
-- on_track; on_budget → over_budget → critical → on_budget) and writes
-- the new value straight to the row via the authenticated user's
-- existing update RLS on public.projects.
--
-- Rollback:
--   alter table public.projects drop column if exists timeline_status;
--   alter table public.projects drop column if exists budget_status;
-- ============================================================================

alter table public.projects
  add column if not exists timeline_status text default 'on_track';

alter table public.projects
  add column if not exists budget_status text default 'on_budget';

-- Backfill any pre-existing rows so the UI never sees NULL.
update public.projects set timeline_status = 'on_track' where timeline_status is null;
update public.projects set budget_status = 'on_budget' where budget_status is null;

-- Guardrails — keep free-form writes from silently breaking the UI.
alter table public.projects
  drop constraint if exists projects_timeline_status_check;
alter table public.projects
  add constraint projects_timeline_status_check
  check (timeline_status in ('on_track', 'at_risk', 'delayed'));

alter table public.projects
  drop constraint if exists projects_budget_status_check;
alter table public.projects
  add constraint projects_budget_status_check
  check (budget_status in ('on_budget', 'over_budget', 'critical'));
