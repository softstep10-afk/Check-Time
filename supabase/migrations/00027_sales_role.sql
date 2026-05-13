-- 00027 — sales role
--
-- Adds a non-finance operational role for estimators / sales reps.
-- Shift review acknowledgements are stored append-only in time_events.metadata
-- on an `adjust` event, so no schema column is required for that part.

alter type public.user_role add value if not exists 'sales';
