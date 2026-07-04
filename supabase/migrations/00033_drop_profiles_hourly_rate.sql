-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 01: A1 — drop legacy rate column ----------
ALTER TABLE public.profiles DROP COLUMN hourly_rate;
