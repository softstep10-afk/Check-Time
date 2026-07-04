-- 00044 — Overlong-shift auto-close cron (24h max-shift cap)
-- ALREADY LIVE in prod (vlrajjwbaxikbwvqdpft), provisioned by hand via the
-- Supabase SQL editor. This file is documentation-of-record only; do NOT
-- re-apply. Mirrors the live pg_cron job, function, and grants byte-for-byte
-- in behavior.
--
-- Note: on Supabase, pg_cron is provisioned in the `cron` schema; cron.schedule
-- and cron.job live there.

create extension if not exists pg_cron;

create or replace function public.close_overlong_open_sessions()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare closed_count integer;
begin
  with open_shifts as (
    select te.id, te.org_id, te.profile_id, te.project_id, te.event_time
    from public.time_events te
    where te.event_type = 'clock_in'
      and te.event_time < now() - interval '24 hours'
      and not exists (
        select 1 from public.time_events te2
        where te2.profile_id = te.profile_id
          and te2.event_type in ('clock_out','auto_out')
          and te2.event_time > te.event_time
      )
  )
  insert into public.time_events (org_id, profile_id, project_id, event_type, event_time, notes, metadata)
  select org_id, profile_id, project_id, 'auto_out',
    event_time + interval '24 hours',
    'Auto-closed: shift exceeded 24h cap',
    jsonb_build_object('auto_closed_reason','max_shift_cap','auto_closed_by','cron','capped_from_event', id)
  from open_shifts;
  get diagnostics closed_count = row_count;
  return closed_count;
end;
$function$;

revoke execute on function public.close_overlong_open_sessions() from anon, authenticated;

select cron.schedule('close-overlong-shifts', '17 * * * *', 'select public.close_overlong_open_sessions()');
