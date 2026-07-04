-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 05: C1 — drop duplicate indexes ----------
DROP INDEX IF EXISTS public.idx_media_active_project_created;
DROP INDEX IF EXISTS public.idx_time_events_project_archive_lookup;
