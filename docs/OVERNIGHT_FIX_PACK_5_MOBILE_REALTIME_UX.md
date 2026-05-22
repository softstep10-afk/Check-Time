# Overnight Fix Pack 5: Mobile UX And Realtime Task Status

## Scope

This pack fixes current user-facing regressions without changing business workflows.

- Restore compact top quick navigation.
- Add project navigation actions for Apple Maps, Google Maps, and Tesla-friendly copy/share.
- Use real profile names in greetings instead of raw role labels.
- Reduce mobile flicker caused by broad task refreshes.
- Restore realtime task status updates in manager and worker task views.

No payroll, archive/trash, GPS, shifts, clock-in/out, RLS, Storage policy, schema, migration, Jarvis permission, or production data changes are included.

## What Was Fixed

### Top quick navigation

- Manager layout now shows a compact horizontal quick navigation row near the top.
- Worker shell now shows a compact horizontal quick navigation row near the top.
- Existing side/bottom navigation remains unchanged.
- Existing finance and owner-only visibility rules are preserved.

### Project navigation actions

- Project cards and project detail views now include direct navigation actions.
- Apple Maps uses `https://maps.apple.com/?daddr=...`.
- Google Maps uses `https://www.google.com/maps/dir/?api=1&destination=...`.
- Tesla option uses safe share/copy text only. No Tesla API, OAuth, or tokens are used.
- Coordinates are preferred when available; address is used as fallback.
- Existing copy-address button remains available.

### Greetings

- PIN login now returns the matched profile name so the success greeting can say the person's name.
- Worker header greeting uses the worker's actual profile name.
- Manager mobile header greeting uses the signed-in profile name.
- Raw labels such as `Worker` or `Manager` are not used as greeting fallbacks.

### Coordinate input mobile/native validation

- Project latitude/longitude fields now use text inputs with decimal keyboard hints.
- Validation still happens through the existing coordinate parser before save.
- This avoids browser number-step popups for high-precision coordinates.
- GPS/geofence/project save logic is unchanged.

### Mobile bell placement

- Manager work alert bell is moved away from the mobile top bar so it does not cover sign out.
- The bell remains available and realtime-enabled.

### Realtime task status

- Manager task board now merges task INSERT/UPDATE/DELETE realtime payloads into local task state.
- Project detail task list now merges task INSERT/UPDATE/DELETE realtime payloads into local task state.
- Worker shell now merges task INSERT/UPDATE realtime payloads into visible task state.
- Task read/taken/done rows remain visible according to the existing list behavior.
- Broad route refreshes for task-heavy manager pages were reduced where local realtime state now preserves correctness.

## What Was Not Changed

- Payroll and salary archive.
- Archive/trash business meaning.
- Roles, permissions, and auth/session behavior.
- Project create/edit/delete/archive lifecycle.
- GPS, geofence, clock-in, clock-out, and shift logic.
- Supabase RLS, Storage policies, database schema, and migrations.
- File allowed types.
- Jarvis permissions and model routing.
- Message/task/notification business meaning.
- Production data.

## Manual QA

Manager/owner:

- Open mobile manager view and confirm top quick navigation is visible near the top.
- Confirm the floating alert bell does not cover the sign-out button.
- Open Projects and confirm each project still opens normally.
- Confirm copy address still works.
- Confirm Apple Maps opens with coordinates when project GPS exists.
- Confirm Google Maps opens with coordinates when project GPS exists.
- Confirm Tesla/share copies or shares the destination without requiring Tesla login.
- Change a worker task status from a worker session and confirm manager Tasks page updates without manual browser refresh.
- Open a project detail page and confirm its task section updates without manual browser refresh.
- Paste `47.799137872580424, -122.24154212345678` into coordinates and confirm no browser nearest-valid-value popup appears.

Worker:

- Log in by PIN and confirm the greeting uses the actual profile name.
- Confirm worker top quick navigation is visible near the top.
- Open task, mark taken, mark done, and confirm the task remains visible in the expected section.
- Confirm manager-side task status updates without manual refresh.
- Confirm notifications still update and do not hide source tasks.

## Deferred

- Supervisor access policy changes; those are role/permission changes and belong in a separate owner-approved task.
- Pagination or virtualized task/project lists.
- App-wide realtime architecture rewrite.
- Query-scope changes that alter visible data.
- Supabase RLS/Storage verification, still blocked without Direct SQL access.
- Database-level performance/query-plan audit.
