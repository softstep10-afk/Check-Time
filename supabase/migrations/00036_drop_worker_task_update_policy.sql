-- Applied manually to prod on 2026-07-03 via SQL Editor. This file is documentation-of-record; do not re-apply.

-- ---------- 04: B4 — drop worker direct-update policy (writes now via server routes) ----------
DROP POLICY "Workers can update tasks assigned to them" ON public.tasks;
