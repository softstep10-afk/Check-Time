# Alpha-7 Project Route Guardrails

Scope: elevated project, task, message, media, worker-video, and schedule routes that use `createAdminClient` or service-role writes.

This pack is architectural hardening only. It does not redesign roles, project visibility, worker workflows, project lifecycle, archive/trash behavior, payroll, GPS, shifts, RLS, Storage policies, schema, or migrations.

## What Was Hardened

- Added a shared UUID guard for server routes before service-role mutations.
- Project edit, trash, archive, and planning routes now reject malformed project route IDs before admin-client lookup or update.
- Manager task creation validates project, assignee, and attachment media IDs before the task dispatch helper can write.
- Priority-message task dispatch validates message, recipient, and optional project IDs before admin-client reads/writes.
- Worker project task creation validates project ID before project access checks and service-role task creation.
- Worker task claim and task-seen routes validate task IDs before elevated task updates.
- Schedule writes validate project, assignee, and delivery task IDs before service-role inserts/updates.
- Worker check-in/check-out video link routes validate time event IDs before calling the service-role media linker.
- Media transcode validates media ID and checks the authenticated actor profile org against the media row before service-role metadata writes.
- AI photo analysis validates media ID and confirms authenticated media belongs to the actor org before service-role analysis persistence.

## What Was Already Guarded

- Manager project create uses the authenticated manager profile org from the server, not client-supplied org/company IDs.
- Manager project update/delete/archive/planning writes remain scoped by `projects.id` plus `profile.org_id`.
- Task dispatch validates target project and assigned profile are same-org before inserting tasks.
- Task attachment media validation checks same-org, same-project, non-deleted media before storing IDs in task metadata.
- Worker task claim reads the task through the user-scoped client first, then re-checks org/project predicates on the admin update.
- Mux webhook uses HMAC verification and updates by existing media row predicates. It has no user session by design.

## Preserved Behavior

- Same-org manager/supervisor operational project, task, message, media, and schedule workflows remain allowed.
- Worker same-org task claim, project task creation, task seen, and media-link workflows remain allowed.
- Existing project visibility rules were not changed.
- Existing worker project assignment/exclusion checks were not changed.
- Existing schedule delivery/task behavior was not changed.
- Existing message/task separation was not changed.
- Existing file/media allowed types and private bucket behavior were not changed.

## Deferred

- Supervisor access policy changes require a dedicated owner-approved role/access task.
- Hard/permanent delete ownership rules require owner confirmation if a destructive route is introduced later.
- Direct SQL Supabase Step 0 remains blocked, so real production RLS/Storage policy state is still unverified.
- RLS and Storage policy hardening remain deferred.
- Project access model redesign remains deferred.
- GPS/clock-in/clock-out and shift logic remain out of scope.
