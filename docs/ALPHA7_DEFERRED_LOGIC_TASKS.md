# Alpha-7 Deferred Logic Tasks

This log separates approved reliability fixes from changes that would alter product behavior or access rules.

## Messages / Tasks / Notifications Fix Pack

Completed scope:

- Preserve worker message history when a message is marked read.
- Keep message read state as a read marker, not a history filter.
- Keep Priority `Task` task creation behind explicit selection.
- Prevent duplicate task creation for the same priority-task message on retry/realtime overlap.
- Keep task start/done UI state tied to successful task updates.
- Keep notification read/dismiss behavior separate from source message/task visibility.
- Debounce message and notification realtime refresh bursts.

Not changed:

- Who can send messages.
- Who can see tasks.
- Task lifecycle names or business meaning.
- Archive/Trash behavior.
- Payroll or salary history.
- GPS, shifts, clock-in, clock-out, and Safety Brief.
- Supabase RLS or Storage policies.
- Database schema or migrations.
- File upload allowed types.

## Deferred Until Separate Owner Approval

- Pagination or major history loading changes for messages/tasks.
- App-wide realtime architecture rewrite.
- Role/access redesign.
- Supabase Direct SQL Step 0 and any RLS/Storage hardening.
- Project access behavior changes.
- Archive/payroll/GPS/shift behavior changes.
- Any change that moves messages into tasks automatically.
- Any change that hides read messages or read tasks from history.

## Known Limitation

Authenticated production testing was not available in this pass. Manual owner/manager/worker QA is required after deployment using `docs/OWNER_MANUAL_QA_CHECKLIST.md`.

## File / Media Reliability Fix Pack

Completed scope:

- Keep existing PDF, Word, Excel, CSV, photo, and video support consistent across validation and upload helpers.
- Preserve original display filenames while generating safe storage filenames when needed.
- Handle iPhone `.mov` / `video/quicktime` and generic picker MIME cases without changing allowed business file categories.
- Keep task attachment upload success tied to both Storage upload and media metadata insert.
- Normalize private bucket paths before receipt signed URL batch creation.
- Validate manager task attachment media IDs as same-org/same-project before storing them in task metadata.

Not changed:

- Storage policies.
- Supabase RLS.
- Bucket config.
- Database schema or migrations.
- Who can view/upload files in normal same-org workflows.
- Archive/Trash business meaning.
- Payroll or salary archive.
- GPS, shifts, clock-in, clock-out, and Safety Brief.
- Message/task business meaning.

Deferred until separate owner approval:

- Direct SQL Storage/RLS verification.
- Storage policy hardening.
- RLS file access hardening.
- File metadata schema redesign.
- Broad file access redesign.
- Orphaned storage cleanup jobs.
- Archive/Trash file retention redesign.
- App-wide media pagination, lazy loading, or performance redesign if it changes visible behavior.

## Low-Risk Performance Fix Pack

Completed scope:

- Reduce hidden-tab fallback polling for worker notification bell, manager work alert bell, and worker task polling.
- Preserve catch-up reload on visibility return.
- Keep realtime subscriptions and fallback polling while pages are visible.
- Avoid notification/work-alert state updates when polls return identical lists.
- Reduce Command Center route refresh bursts without removing live refresh.
- Remove verbose upload debug logs from project media and task attachment hot paths.

Not changed:

- Which projects, tasks, messages, notifications, or files are visible.
- Message/task read, taken, done, history, or notification behavior.
- Archive/Trash behavior.
- Payroll or salary archive.
- GPS, shifts, clock-in, clock-out, and Safety Brief.
- Roles, permissions, auth/session behavior.
- Supabase RLS, Storage policies, schema, or migrations.
- Jarvis action permissions or model routing.

Deferred until separate owner approval:

- Pagination or virtualized large lists.
- Changing query scopes or filters.
- Changing which records are loaded.
- App-wide realtime architecture rewrite.
- Command Center data-loading redesign.
- Message/task data-loading redesign.
- Database indexes, migrations, or query-plan optimization.
- Production runtime profiling requiring authenticated session.

## Mobile UX / Realtime Task Status Fix Pack

Completed scope:

- Restore top quick navigation in manager and worker shells.
- Add project navigation links/actions without changing project data or GPS logic.
- Use signed-in profile names in greetings instead of raw role labels.
- Move manager work alert bell away from the mobile sign-out area.
- Merge realtime task status updates into manager task board, project detail tasks, and worker task state.
- Avoid native number-input coordinate step validation for high-precision project/store coordinates while keeping existing parser validation.

Not changed:

- Roles, permissions, and auth/session behavior.
- Project visibility and project lifecycle.
- Archive/Trash business meaning.
- Payroll or salary archive.
- GPS, geofence, clock-in, clock-out, and shifts.
- Supabase RLS, Storage policies, schema, or migrations.
- File allowed types.
- Jarvis permissions and model routing.
- Message/task/notification business meaning.

Deferred until separate owner approval:

- Supervisor access policy changes.
- App-wide realtime architecture rewrite.
- Query/filter changes that alter visible data.
- Pagination or virtualized task/project lists.
- Database indexes, migrations, or query-plan optimization.

## Project Route Guardrails Fix Pack

Completed scope:

- Added shared UUID validation for elevated server routes before service-role mutations.
- Added malformed-ID rejection to project edit/trash/archive/planning routes.
- Added ID validation around manager task creation, message-to-task dispatch, worker project tasks, worker task claim/seen, schedule actions, media transcode, AI photo analysis, and worker video-link routes.
- Added explicit actor-org check before media transcode and AI photo-analysis service-role metadata writes.
- Preserved same-org manager/supervisor operational workflows and worker workflows.

Not changed:

- Roles, permissions, or broad project visibility rules.
- Supervisor access policy.
- Project lifecycle meaning.
- Archive/Trash business meaning.
- Payroll or salary archive.
- GPS, geofence, clock-in, clock-out, and shifts.
- Message/task lifecycle or business meaning.
- File allowed types, Storage policies, Supabase RLS, database schema, or migrations.

Deferred until separate owner approval:

- Supervisor access tightening or role/access redesign.
- Hard/permanent delete policy decisions.
- Direct SQL Supabase Step 0.
- RLS/Storage hardening.
- Project access model changes.
- GPS/clock/shift route behavior changes.
