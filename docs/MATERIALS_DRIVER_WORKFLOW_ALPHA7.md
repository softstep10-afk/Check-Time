# Materials / Driver Workflow Alpha-7

## Scope

This pack adds an existing-task-based material workflow for drivers without changing database schema, RLS, Storage policies, payroll, shifts, GPS, archive/trash, messages, or media-delete privileges.

Material requests are still normal task rows. The material-specific meaning is stored in `tasks.metadata`, using the existing `due_date`, `assigned_to`, `priority`, and status lifecycle.

## How Material Tasks Are Created

- Manager/owner project detail has a Materials section for material orders.
- A material order writes one or more normal `tasks` rows.
- The material assignee dropdown shows profiles with role `driver` plus explicitly configured material-driver profile ids from `MATERIAL_DRIVER_PROFILE_IDS`.
- Missing or non-driver material assignees are rejected by the server route.
- The material flow no longer falls back to the full team when assigning delivery.
- Metadata marks the task as material:
  - `category: "material"`
  - `taskKind: "material"`
  - `materialRequest: true`
  - `materialName`
  - `urgency`
  - `neededDate`
  - `driverUserId`
  - `schedule_kind: "delivery"`
  - `schedule_scope: "material"`
- The selected assignee is stored in `assigned_to`.
- The needed day is stored in existing `due_date`.
- Urgent material requests use existing urgent priority.
- The UI shows a saving state while the material task is being created and does not show success before the server responds.

Normal task creation remains available and unchanged.

## Driver Identification

The app uses the existing `driver` role for the focused material queue and material assignment options. It also supports `MATERIAL_DRIVER_PROFILE_IDS` for a stable profile-id-based material-driver capability when someone must remain in another worker-like role, such as supervisor.

There is no hardcoded `Sanya` or display-name rule.

If Sanya is the assigned driver, the UI shows his profile display name from normal profile data.

If Sanya should appear in the material assignee dropdown in production, either his profile must be configured with role `driver`, or his stable profile id must be listed in `MATERIAL_DRIVER_PROFILE_IDS` so he can stay supervisor-driver. Owner/admin can set a normal driver role through the team UI: `Команда` -> Sanya profile -> `Роль` -> `Водитель` -> `Сохранить профиль`.

No hardcoded Sanya rule is used. No SQL/manual database mutation is required when the owner/admin UI is available.

## Driver View

- Users with role `driver`, plus configured profile ids in `MATERIAL_DRIVER_PROFILE_IDS`, see the worker task queue focused to material tasks.
- Non-driver workers keep the normal task queue behavior.
- Material task cards show project, material name, urgent/non-urgent state, needed date, and normal task status.
- Read/taken/done stays the existing task lifecycle.

## Schedule

Material tasks with `due_date` appear on the assigned day through the existing schedule task/delivery calendar path.

This does not feed payroll, paid periods, clock-in/out, GPS, or shift calculation.

## Indicators

- Project cards and project detail show a material-needed badge when open material tasks exist.
- Urgent material requests show the urgent material badge.
- Assigned material requests show an assigned/seen state when existing task read metadata supports it.
- Manager/owner task views show material badges and needed dates.

## Notifications / Realtime

Existing task realtime is reused:

- New material task INSERT appears in the driver queue without manual refresh.
- Worker banner text includes project, urgency, material, and needed date when available.
- Manager/owner task/project views merge realtime task status updates.
- Notification behavior remains a signal; it does not convert tasks into messages or delete source tasks.

## Production QA Hotfix Notes

- Material tasks can only be assigned to driver-role profiles or configured material-driver profile ids.
- Normal task assignment remains unchanged.
- Material save shows pending feedback and prevents duplicate save clicks.
- Task take/done actions show pending feedback while the server request is active.
- Private/direct message persistence remains separate from material tasks; no material task creates a chat message automatically.
- Mobile project navigation can show "Поехать", ask for Apple Maps / Google Maps / Tesla-share preference once, and then reuse that local preference.
- Navigation preference is stored locally in the browser only and does not require schema changes.

## What Was Not Changed

- No payroll calculation.
- No salary archive.
- No archive/trash meaning.
- No GPS, geofence, clock-in/out, or shift logic.
- No Supabase RLS.
- No Storage policies or bucket config.
- No database schema change.
- No migrations.
- No production data mutation.
- No deployment.
- No role redesign.
- No message/task lifecycle redesign.
- No media delete privilege change.

## Manual QA

- Manager creates an urgent material task for a driver.
- Manager creates a non-urgent material task for a driver.
- Confirm "Добавить материал" only lists drivers in the assignee dropdown.
- Confirm Sanya appears only if his profile role is `driver` or his profile id is configured in `MATERIAL_DRIVER_PROFILE_IDS`.
- Confirm there is no full-team fallback.
- Confirm saving material shows "Сохраняем..." / "Сохраняем материал..." and duplicate save does not duplicate a task.
- Driver sees material tasks without manual refresh.
- Driver receives the material task notification/banner.
- Driver sees project name, material name, urgency, and needed date.
- Driver schedule shows the material task on the selected day.
- Owner/manager sees material-needed badge on project card/detail.
- Owner/manager sees driver read/taken/done changes.
- Normal worker tasks still work.
- Normal messages still work.
- Notifications do not delete or hide source tasks.

## Driver Role Setup

- Confirm Sanya has role `driver` or his profile id is configured in `MATERIAL_DRIVER_PROFILE_IDS` before testing driver-only dropdowns.
- If he should stay supervisor-driver, keep role `supervisor` and use `MATERIAL_DRIVER_PROFILE_IDS`.
- If he should be a normal driver, owner/admin sets it in team profile settings.
- Manager/supervisor/worker cannot assign the driver role.
- Driver remains worker-like and does not become manager-tier.
- Driver sees the material-focused workflow.
- Normal workers still see normal tasks.
- Direct SQL Supabase Step 0 remains separate/blocked.
- Production RLS/Storage verification remains separate/blocked.

## Deferred

- Database-level material task indexes or schema columns.
- RLS policy review for material tasks through Direct SQL.
- Separate Materials/Driver dashboard redesign.
- Driver route planning or Tesla/API integration.
