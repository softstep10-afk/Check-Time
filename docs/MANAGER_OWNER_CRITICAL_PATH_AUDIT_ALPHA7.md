# Alpha-7 Manager/Owner Critical Path Audit

Mode: read-first audit with low-risk fixes only. No runtime business logic changes were required.

## Impact Map

Likely affected surfaces inspected:

- Manager project list and project detail.
- Project navigation actions and address copy.
- Project media tabs, upload/open/download/delete, and document picker support.
- Task create/assign/status surfaces.
- Material request modal and manager task creation route.
- Bulk/private messages and read-status merge.
- Worker status, active shifts, checkout proof media, and command center views.
- Public project notes.
- Archive, Trash, payroll archive visibility, and payroll page finance gate.
- Owner/admin diagnostics.
- Owner/admin audit signatures and consent review.

Screens using these surfaces:

- `/projects`
- `/projects/[id]`
- `/tasks`
- `/command-center`
- `/messages`
- `/archive`
- `/trash`
- `/payroll`
- `/admin/audit`
- `/admin/diagnostics`

Dangerous zones declared:

- Payroll/archive/trash were inspected only for visibility and guard coverage.
- No payroll calculation, archive/trash logic, GPS/shift logic, RLS, Storage policy, schema, migration, production data, role redesign, task/message lifecycle, material queue rule, or media delete semantic change was made.

## Findings

### Open Project And Navigation

- Manager project cards use a full-card native `Link` to `/projects/[id]`.
- Nested address/navigation controls sit above that card link and use separate action surfaces.
- `ProjectNavigationActions` is present on manager project cards and at the top of project detail.
- Address copy uses the project navigation/address helper path that preserves the full human-readable address.

### Project Media

- Project detail uses `filterProjectMediaByCategory`.
- Media tabs are present for all/photo/video/documents.
- `ACCEPT_ALL_UPLOADS` is used on manager project uploads and material/spec attachments.
- Existing open/download behavior stays in shared task/media components.
- Delete remains controlled by `canDeleteMedia` UI and the server-side Andrey/Sergey/configured helper.

### Tasks And Material Requests

- `ManagerTasksPage` subscribes to task INSERT/UPDATE/DELETE realtime events and merges rows with `mergeRealtimeTaskRow`.
- Project detail uses the same task merge helper for project-local task status updates.
- `/api/manager/tasks` loads the authenticated manager profile through `requireManagerContext`.
- Material task creation validates selected assignees with `isEligibleMaterialTaker`.
- Open material requests remain allowed when no assignee is selected.
- Attachment media IDs are validated with `assertTaskAttachmentMediaTargets`.

### Messages

- `BulkMessageComposer` merges sent-message history with `mergeMessagesById`.
- Message INSERT/UPDATE realtime subscriptions keep manager history stable.
- Existing private message tests cover sender/recipient persistence and notification-as-signal behavior.

### Worker Status, Active Shifts, Checkout Videos

- Manager realtime subscriptions include time/task/media/project surfaces where needed.
- Checkout proof linking and validation are covered by checkout link tests.
- No checkout video rule or shift calculation code was changed.

### Public Project Notes

- Worker project notes write through `/api/worker/project-notes`.
- Notes are stored in project settings via `appendProjectPublicNote`, separate from tasks and messages.
- The route checks authenticated profile, same org project, assignment/exclusion access, and archived project rejection.
- Manager project list/detail read and display public note counts/content.

### Archive, Trash, Payroll Archive

- Archive route builds archived project rows and only builds paid payroll archive when `hasFinanceAccess` passes.
- Payroll page redirects non-finance users to `/overview`.
- Trash remains a separate deleted-row surface.
- Existing archive/payroll tests cover archive vs trash separation and finance-hidden payroll archive amounts.

### Diagnostics And Audit Signatures

- `/admin/diagnostics` requires manager context and redirects non-owner/admin profiles to `/overview`.
- Diagnostics show release/build metadata only; they do not expose secrets, service keys, payroll records, private tokens, PINs, or sessions.
- `/admin/audit` loads `worker_location_consents` and `safety_acknowledgements` for owner/admin signature review and CSV export.

## No Fix Applied

No confirmed low-risk manager/owner runtime regression was found during this pass, so no app runtime behavior was changed.

## Targeted Regression Coverage

Added source guards assert that:

- Manager project cards/details keep open/navigation/copy/media/note surfaces.
- Manager task/material route guards and realtime merge helpers remain present.
- Message history merges read updates without dropping history.
- Media delete remains helper-gated.
- Archive/payroll/Trash visibility remains separated and finance-gated.
- Diagnostics and audit signature review remain owner/admin-only.

## Manual QA Needed

- Owner opens `/projects`, taps a project card, taps `Поехать`, and copies address.
- Owner opens project detail and checks media tabs, notes, tasks, material request, and uploads.
- Owner creates a normal task and material request.
- Owner sends a private message and sees read status update.
- Owner opens Archive and Trash and confirms they remain separate.
- Finance-authorized owner/admin opens Payroll and payroll archive.
- Non-finance manager confirms payroll amounts are hidden.
- Owner/admin opens `/admin/audit` and verifies `Подписи и согласия`.
- Owner/admin opens `/admin/diagnostics` and confirms release metadata only.
