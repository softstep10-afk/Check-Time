# Materials / Driver Workflow Alpha-7

## Scope

This pack adds an existing-task-based material workflow for drivers without changing database schema, RLS, Storage policies, payroll, shifts, GPS, archive/trash, messages, or media-delete privileges.

Material requests are still normal task rows. The material-specific meaning is stored in `tasks.metadata`, using the existing `due_date`, `assigned_to`, `priority`, and status lifecycle.

## How Material Tasks Are Created

- Manager/owner project detail has a Materials section for material orders.
- A material order writes one or more normal `tasks` rows.
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

Normal task creation remains available and unchanged.

## Driver Identification

The app uses the existing `driver` role for the focused material queue. There is no hardcoded `Sanya` or display-name rule.

If Sanya is the assigned driver, the UI shows his profile display name from normal profile data.

## Driver View

- Users with role `driver` see the worker task queue focused to material tasks.
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
- Driver sees material tasks without manual refresh.
- Driver sees project name, material name, urgency, and needed date.
- Driver schedule shows the material task on the selected day.
- Owner/manager sees material-needed badge on project card/detail.
- Owner/manager sees driver read/taken/done changes.
- Normal worker tasks still work.
- Normal messages still work.
- Notifications do not delete or hide source tasks.

## Deferred

- Config-based special driver assignment if owner does not want to use the existing `driver` role.
- Database-level material task indexes or schema columns.
- RLS policy review for material tasks through Direct SQL.
- Separate Materials/Driver dashboard redesign.
- Driver route planning or Tesla/API integration.
