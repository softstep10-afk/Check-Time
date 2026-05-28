# Materials / Driver Workflow Alpha-7

## Scope

This pack adds an existing-task-based material workflow for drivers without changing database schema, RLS, Storage policies, payroll, shifts, GPS, archive/trash, messages, or media-delete privileges.

Material requests are still normal task rows. The material-specific meaning is stored in `tasks.metadata`, using the existing `due_date`, `assigned_to`, `priority`, and status lifecycle.

## How Material Tasks Are Created

- Manager/owner project detail has a Materials section for material orders.
- A material order writes one or more normal `tasks` rows.
- The material assignee selector is optional and defaults to `Любой водитель или рабочий`.
- If no person is selected, the material task is created as an open shared queue item with `assigned_to = null`.
- Open material tasks are visible to eligible field users: role `worker`, role `driver`, and explicitly configured material-driver profile ids from `MATERIAL_DRIVER_PROFILE_IDS`.
- If a person is selected, the server validates that the assignee is an eligible field user.
- Non-field roles such as manager/owner/admin are not material takers unless a separate approved capability path says otherwise.
- The material flow no longer falls back to the full team.
- Metadata marks the task as material:
  - `category: "material"`
  - `taskKind: "material"`
  - `materialRequest: true`
  - `materialName`
  - `urgency`
  - `neededDate`
  - `driverUserId` when a person is selected, otherwise `null`
  - `schedule_kind: "delivery"`
  - `schedule_scope: "material"`
  - `materialItems` when the request was pasted/imported as a specification list
  - `attachment_media_ids` when Excel/CSV/PDF/photo/spec files are attached to the request
- The selected assignee is stored in `assigned_to`; open queue material tasks keep `assigned_to = null` until a field user presses `Взять`.
- The needed day is stored in existing `due_date`.
- Urgent material requests use existing urgent priority.
- The UI shows a saving state while the material task is being created and does not show success before the server responds.
- In `Добавить материал`, manager/owner can paste rows from Excel/Google Sheets into `Вставить спецификацию из Excel`.
- The same paste area also accepts simple dictated/plain text such as `Гипс 5 листов 5/8`.
- Repeated voice/dictation fragments are cleaned conservatively before rows are created.
- Parsed rows become editable material positions. The user can edit, remove, or manually add positions before saving.
- Manager/owner can attach Excel, CSV, PDF, photo, or another already-supported file type to the material request. Files use the existing task attachment upload/open/download path.

Normal task creation remains available and unchanged.

## Driver / Field User Eligibility

The app uses the existing `driver` role for the focused material queue. Open material tasks can also be taken by normal workers. It also supports `MATERIAL_DRIVER_PROFILE_IDS` for a stable profile-id-based material-driver capability when someone must remain in another worker-like role, such as supervisor.

There is no hardcoded `Sanya` or display-name rule.

If Sanya takes or is assigned to a material task, the UI shows his profile display name from normal profile data.

If Sanya should have the focused driver-only material queue while staying supervisor, his stable profile id must be listed in `MATERIAL_DRIVER_PROFILE_IDS`. Owner/admin can set a normal driver role through the team UI: `Команда` -> Sanya profile -> `Роль` -> `Водитель` -> `Сохранить профиль`, but that is not required for open material queue visibility when a normal worker can take the task.

No hardcoded Sanya rule is used. No SQL/manual database mutation is required when the owner/admin UI is available.

## Driver View

- Users with role `driver`, plus configured profile ids in `MATERIAL_DRIVER_PROFILE_IDS`, see the worker task queue focused to material tasks.
- Non-driver workers keep the normal task queue behavior.
- Normal workers also see open material tasks and can press `Взять`.
- The first eligible field user to take an open material task owns it; later attempts show that someone else already took it.
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

- New open material task INSERT appears in eligible field users' queues without manual refresh where existing realtime/RLS allows it.
- After a field user takes an open material task, owner/manager sees who took it via the existing `assigned_to`/claimed metadata.
- Worker banner text includes project, urgency, material, and needed date when available.
- Manager/owner task/project views merge realtime task status updates.
- Notification behavior remains a signal; it does not convert tasks into messages or delete source tasks.

## Production QA Hotfix Notes

- Material tasks default to an open shared field queue.
- Optional assignment accepts eligible field users: workers, drivers, and configured supervisor-drivers.
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

- Manager creates an urgent material task with `Любой водитель или рабочий`.
- Manager creates a non-urgent material task with `Любой водитель или рабочий`.
- Confirm "Добавить материал" does not require a driver/person.
- Confirm the optional assignee dropdown lists eligible field users, not the full team.
- Confirm Sanya can remain supervisor-driver through `MATERIAL_DRIVER_PROFILE_IDS` when focused driver behavior is needed.
- Confirm there is no full-team fallback.
- Confirm a worker can press `Взять` on an open material task.
- Confirm a second worker sees a clear already-taken error if they try after someone else took it.
- Confirm saving material shows "Сохраняем..." / "Сохраняем материал..." and duplicate save does not duplicate a task.
- Dictate or paste `Гипс 5 листов 5/8` into `Вставить спецификацию из Excel`, press import, and confirm one editable row appears: `Гипс`, `5`, `листов`, `5/8`.
- Dictate or paste repeated text like `Гипс 5 листов 5/8 гипс гипс пять гипс пять листов 5/8` and confirm it does not create duplicate spam rows.
- Copy 5 rows from Excel/Google Sheets and paste into `Вставить спецификацию из Excel`.
- Confirm the UI says how many positions were found.
- Edit one pasted position, remove one position, and add one manually.
- Attach an Excel/CSV file and a PDF/photo specification document.
- Save the material request and confirm the created material task(s) keep the line items in `metadata.materialItems`.
- Open the task as driver/worker and confirm the material name/list context and files are still available through normal task attachments.
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
