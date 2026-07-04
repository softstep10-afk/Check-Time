-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 06: C2 — hot FK indexes ----------
CREATE INDEX IF NOT EXISTS idx_time_events_adjusted_by ON public.time_events(adjusted_by);
CREATE INDEX IF NOT EXISTS idx_time_events_adjusts_event_id ON public.time_events(adjusts_event_id);
CREATE INDEX IF NOT EXISTS idx_media_org ON public.media(org_id);
CREATE INDEX IF NOT EXISTS idx_media_time_event ON public.media(time_event_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by ON public.tasks(assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_by ON public.tasks(completed_by);
