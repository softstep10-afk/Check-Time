-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 07: drop dead clients module (owner decision; single test row archived in PROJECT_BACKLOG.md) ----------
DROP TABLE IF EXISTS public.project_clients, public.client_contacts, public.clients;
