# Alpha-7 Dangerous Zones

Purpose: define areas where accidental changes can break payroll, access control, production data safety, or core field workflows.

This is a permanent stop-and-report rule for future work.

## Dangerous Zones

- Payroll, salary, paid periods, payroll archive.
- Shifts, time events, clock-in, clock-out.
- GPS, geofence, live locations, no-GPS warning logic.
- Archive and Trash behavior.
- Supabase RLS policies.
- Supabase Storage policies and buckets.
- Database schema and migrations.
- Supabase Edge Functions.
- Service-role routes and admin clients.
- Auth/session/PIN login.
- Team/role hierarchy.
- Material queue core rules.
- Task/message lifecycle.
- Media delete permissions.
- Jarvis mutation/action permissions.

## Mandatory Declaration

Every task must state one of:

- `Dangerous zones touched: none`
- `Dangerous zones touched: <exact list>`

If the answer is not clearly `none`, the task must explain:

- Why the dangerous area is touched.
- What exact behavior is intended to change.
- What must remain unchanged.
- Which tests and manual QA cover it.
- Whether owner approval explicitly covers that exact area.

## Stop-And-Report Rules

Stop before implementation if:

- An unexpected dangerous file appears in `git status` or `git diff`.
- A requested fix would require SQL, migration, schema, RLS, or Storage policy changes.
- A safe UI/script/docs task starts touching payroll, GPS, archive/trash, shifts, auth/session, material queue core, or task/message lifecycle.
- A broad refactor would touch unrelated dangerous areas.
- The task would require production data mutation that was not explicitly approved.

## Required Local Commands

Use these before deploy decisions:

```bash
npm run alpha7:danger-zone-diff --if-present
npm run check:dangerous
npm run inventory:service-role
npm run alpha7:route-mutation-map --if-present
```

`00099_wash_and_reset.sql` is a known local danger file. It must not be executed, deleted, or normalized away without explicit owner approval.

## Shared Component Escalation

Shared components are dangerous-adjacent when they sit in critical workflows:

- `WorkerShell`
- `WorkerProjectView`
- `TasksPage`
- `NotificationBell`
- `ManagerWorkAlertBell`
- `ProjectNavigationActions`
- Project cards/lists.
- Upload/file attachment components.
- Checkout modal and clock components.

Changing one of these does not automatically mean “blocked,” but it does require an Impact Map that lists every known screen and workflow using it.

## What Not To Do

- Do not hide a dangerous-zone change inside a “small cleanup.”
- Do not make unrelated formatting/refactor churn in dangerous files.
- Do not broaden role or permission behavior as a side effect.
- Do not change database policies or schema to make tests pass.
- Do not mutate production data to satisfy a local check.
