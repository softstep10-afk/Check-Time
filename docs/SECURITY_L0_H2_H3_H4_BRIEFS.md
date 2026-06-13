# L0 Security H2/H3/H4 Implementation Briefs

Status: planning only. Do not run SQL.

## H2 Time Events / GPS Hardening

### Current Risk

`supabase/migrations/00002_rls_policies.sql` defines `time_events` SELECT as org-wide:

```sql
using (org_id = public.get_user_org_id())
```

Because `time_events` contains `gps_point`, `gps_accuracy_m`, and `gps_source`, ordinary org users may be able to read other workers' shift/GPS rows through direct DB/API access.

### Source Inventory

- `src/lib/worker-data.ts`: worker shell data and own time history.
- `src/lib/manager-data.ts`: manager page datasets, project summaries, team/payroll/timeline page data.
- `src/app/(manager)/overview/page.tsx`: active sessions, shift review, location status.
- `src/app/(manager)/team/[id]/page.tsx`: worker detail and shift history.
- `src/app/(manager)/timeline/page.tsx`: time-event timeline and GPS-sensitive review signals.
- `src/app/(manager)/location-data/page.tsx`: live location display.
- `src/components/worker/WorkerShell.tsx`: worker clock state, own time events, live location writes.
- `src/app/api/payroll/run/route.ts`: payroll run time-event reads.
- `src/app/api/payroll/export/route.ts`: payroll export time-event reads.
- `src/app/api/team/pay-worker/route.ts`: pay-worker time-event reads.
- `src/app/api/worker/clock-out/route.ts`: service-role clock-out write after auth checks.
- `src/lib/checkout-link-server.ts`: checkout video/time-event validation and update.

### Intended Model

- Worker/driver: own `time_events` only.
- Supervisor: no org-wide GPS by default; crew scope requires a future explicit crew model.
- Owner/admin/manager: operational visibility for overview, team, projects, timeline, and location.
- Finance/payroll: can read time needed for payroll, but should not require raw GPS unless also owner/admin/manager.
- Client: no access.

### Candidate RLS Shape — DO NOT RUN

```sql
drop policy if exists "Users can view time events in their org" on public.time_events;

create policy time_events_select_own_or_operational_manager
on public.time_events
for select
using (
  org_id = public.get_user_org_id()
  and (
    profile_id = auth.uid()
    or public.get_user_role() in ('owner', 'admin', 'manager')
  )
);

drop policy if exists wll_select_self_or_manager on public.worker_live_locations;

create policy wll_select_own_or_operational_manager
on public.worker_live_locations
for select
using (
  org_id = public.get_user_org_id()
  and (
    worker_id = auth.uid()
    or public.get_user_role() in ('owner', 'admin', 'manager')
  )
);
```

### Required Code Changes Before SQL

- Add explicit time-event select constants for operational, payroll, and worker-self reads.
- Separate payroll-safe time reads from GPS-inclusive operational reads.
- Confirm worker pages never rely on org-wide `time_events`.
- Confirm supervisors do not depend on `public.is_manager()` for GPS visibility.

### Tests

- Source guard: worker paths cannot select org-wide `time_events`.
- Source guard: payroll paths do not request `gps_point` unless explicitly operational.
- Role matrix tests: worker/driver self-only, supervisor denied cross-worker GPS, manager allowed.
- Regression tests for payroll preview, shift review, overview active sessions, and location page.

### QA

- Worker own history loads.
- Worker cannot view another worker's events through API.
- Manager overview/team/timeline/location load.
- Payroll page opens for finance/owner.
- No HTTP 500, no React #418.

### Rollback

Restore the previous broad SELECT policy only if production breaks, then re-open H2 with narrower code changes.

### First Implementation Task

Create `src/lib/time-event-selects.ts` with explicit operational/payroll/worker select strings and source guards.

## H3 Tasks Policy Cleanup

### Current Risk

The repo does not contain a literal `tasks_all_org` policy name, but `supabase/migrations/00002_rls_policies.sql` has the equivalent broad task SELECT:

```sql
using (org_id = public.get_user_org_id() and deleted_at is null)
```

Workers may see too many org tasks. Also, task update policies depend on `public.is_manager()`, which later migrations widened to include supervisor in some contexts.

### Source Inventory

- `src/lib/manager-data.ts`: manager task reads for overview/projects/tasks.
- `src/app/api/manager/tasks/route.ts`: manager task creation.
- `src/lib/server/task-dispatch.ts`: service-role task creation and audit.
- `src/components/manager/ManagerTasksPage.tsx`: manager task board.
- `src/components/worker/WorkerShell.tsx`: worker task reads/status updates/offline replay.
- `src/components/worker/WorkerProjectView.tsx`: worker project task reads/updates.
- `src/app/api/worker/tasks/seen/route.ts`: worker task seen/update path.
- `src/app/api/worker/claim-task/route.ts`: worker claim task path.
- `src/app/api/worker/project-tasks/route.ts`: worker project task read path.
- `src/app/api/schedule/route.ts`: schedule/task read and write surface.

### Intended Permissions

- Owner/admin/manager: create, assign, update, archive tasks in org.
- Worker/driver: view assigned tasks and explicitly visible project tasks only.
- Worker/driver: update status/seen/completion only through constrained server API.
- Supervisor: no broad manager-equivalent task power until owner approves supervisor scope.
- Client: no internal task access.
- Deleted/archived tasks: hidden from worker and ordinary active views.

### Candidate SQL Shape — DO NOT RUN

```sql
drop policy if exists "Users can view tasks in their org" on public.tasks;

create policy tasks_select_owner_admin_manager
on public.tasks
for select
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and public.get_user_role() in ('owner', 'admin', 'manager')
);

create policy tasks_select_assigned_worker
on public.tasks
for select
using (
  org_id = public.get_user_org_id()
  and deleted_at is null
  and assigned_to = auth.uid()
);

drop policy if exists "Managers can update any task" on public.tasks;

create policy tasks_update_owner_admin_manager
on public.tasks
for update
using (
  org_id = public.get_user_org_id()
  and public.get_user_role() in ('owner', 'admin', 'manager')
)
with check (
  org_id = public.get_user_org_id()
  and public.get_user_role() in ('owner', 'admin', 'manager')
);
```

### Required API / Code Changes Before SQL

- Remove direct broad worker task updates from client components.
- Keep worker task mutation behind narrow APIs that re-check assignment/project visibility.
- Define whether unassigned project-wide tasks are visible through project assignment or `project_access_mode`.
- Confirm schedule route does not depend on broad task reads for worker-tier roles.

### Tests

- Source guard for direct worker `.from("tasks").update(...)` usage.
- Worker assigned task view/update tests.
- Worker cannot update assignment, project, metadata, or deleted status.
- Manager task board create/update/archive tests.
- Supervisor denied broad task update unless explicitly granted later.

### QA

- Manager task board loads.
- Project detail task list loads.
- Worker assigned tasks load.
- Worker project tasks load only where expected.
- Deleted tasks stay out of active lists.

### Rollback

Restore prior task SELECT/UPDATE policies if critical worker/manager task flows break.

### First Implementation Task

Create task source guard tests and inventory remaining direct worker task update paths.

## H4 SECURITY DEFINER Hardening

### Current Risk

Helper functions are SECURITY DEFINER across multiple migrations. Some early helpers lacked explicit `search_path`; several functions grant EXECUTE to `anon` even though RLS only needs authenticated callers.

### Function Inventory

- `public.get_user_org_id()` — `supabase/migrations/00002_rls_policies.sql`
- `public.get_user_role()` — `supabase/migrations/00002_rls_policies.sql`
- `public.is_manager()` — created in `00002`, widened/replaced in `00013`, `00015`, `00017`
- `public.is_owner()` / `public.is_owner(uuid)` — `00015`, `00017`
- `public.has_capability(text)` — `00014_phase1_data_foundation.sql`
- `public.has_finance_access()` — `00022_finance_access.sql`
- `public.user_has_pay_period_items(uuid)` — `00021_payroll_rls_no_recursion.sql`
- `public.pay_period_in_user_org(uuid)` — `00021_payroll_rls_no_recursion.sql`
- `public.prevent_payroll_closure_overlap()` — `00025_payroll_idempotency.sql`
- `public.handle_updated_at()` — `00001_foundation.sql`
- `public.auto_close_open_session()` — `00001_foundation.sql`

### Intended Model

- Every SECURITY DEFINER function sets `search_path = public`.
- Function bodies use schema-qualified references.
- RLS helper functions keep `authenticated` EXECUTE where policies require them.
- Remove `anon` EXECUTE unless a public unauthenticated flow explicitly needs it.
- Trigger-only functions should not be broadly executable by client roles.
- No semantic changes in H4 unless separately approved.

### Candidate SQL Shape — DO NOT RUN

```sql
alter function public.get_user_org_id() set search_path = public;
alter function public.get_user_role() set search_path = public;
alter function public.is_manager() set search_path = public;
alter function public.is_owner() set search_path = public;
alter function public.has_capability(text) set search_path = public;
alter function public.has_finance_access() set search_path = public;

revoke all on function public.has_capability(text) from public;
revoke all on function public.has_capability(text) from anon;
grant execute on function public.has_capability(text) to authenticated;

revoke all on function public.has_finance_access() from public;
revoke all on function public.has_finance_access() from anon;
grant execute on function public.has_finance_access() to authenticated;
```

### Verification SQL — DO NOT RUN

```sql
select
  n.nspname,
  p.proname,
  pg_get_function_arguments(p.oid) as args,
  p.prosecdef,
  p.proconfig,
  p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, args;

select
  has_function_privilege('anon', 'public.has_finance_access()', 'execute') as anon_finance_execute,
  has_function_privilege('authenticated', 'public.has_finance_access()', 'execute') as auth_finance_execute;
```

### Staged Rollout Order

1. Read-only live function inventory.
2. Add search_path hardening for helper functions with no semantic change.
3. Remove anon EXECUTE from non-public helpers.
4. Run RLS smoke as authenticated owner/manager/worker.
5. Only then consider function body rewrites.

### Tests

- Source guard: all SECURITY DEFINER migrations include `set search_path`.
- Source guard: no new helper grants EXECUTE to anon unless allowlisted.
- Role QA after H4: login, overview, worker clock, payroll open, clients/projects load.

### Rollback

Re-grant previous EXECUTE privileges or restore prior function definitions from migrations if RLS/auth breaks.

### First Implementation Task

Create a read-only function inventory script/report and an allowlist for anon-executable functions.
