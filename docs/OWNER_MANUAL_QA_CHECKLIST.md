# Owner Manual QA Checklist

Run this after deploys that touch application code or user workflows.

## Messages

- Manager sends a message to one worker.
- Manager can send a second message without reload.
- Manager can send to multiple workers.
- Manager can send to the whole crew.
- Message stays in history.
- Worker opens the message.
- Manager sees read status if the old UI supported it.
- Normal message does not become a task automatically.
- Priority `Task` creates a real task only when explicitly selected.

## Tasks

- Manager creates a normal task.
- Worker sees the task.
- Worker opens the task.
- Worker can take the task.
- Worker can mark the task done.
- Task does not disappear after read.
- Read, seen, claimed, and completed states still make sense.

## Files

- Project PDF upload works.
- Project photo upload works.
- Project video upload works.
- Project Word upload works.
- Project Excel upload works.
- Project CSV upload works.
- Task attachments still open.
- Message attachments still open.
- Open/download fallback works for unsupported preview formats.
- iPhone `.mov` video uploads do not break the flow.
- Files remain linked to the correct project/task/message after read, taken, done, and notification-read actions.

## Coordinates

- Paste `47.307322, -122.228453`.
- Latitude and longitude split into the correct fields.
- Manual typing still works.
- Device GPS behavior is unchanged.
- Address lookup behavior is unchanged.

## Archive And Trash

- Closed project goes where the owner expects.
- Trash is only for mistakenly deleted records.
- Archive is not replaced by Trash.
- Old archived projects remain accessible.
- Payroll archive is not touched.

## Payroll

- Old paid periods are visible.
- Salary calculation is unchanged.
- Shift history remains visible.
- Paid payroll history remains in the expected archive/history area.

## Jarvis

- `create_task` requires confirmation.
- Jarvis does not say done before the confirmed action completes.
- No owner-only action happens without confirmation.
- Provider/model names do not appear to normal users.
- Diagnostics remain owner/admin-only.

## Performance

- Projects page speed feels acceptable.
- Command Center speed feels acceptable.
- Messages page speed feels acceptable.
- Tasks page speed feels acceptable.
- No obvious refresh storm after sending messages or updating tasks.
- Notification bells update after new message/task events.
- Returning to the app after the tab was hidden refreshes message/task signals.

## Messages / Tasks / Notifications Fix Pack

Run this after deploying `fix(alpha7): harden message task notification flows`.

What was fixed:

- Worker message history marks messages read only after the read update succeeds.
- Message/task conversion remains explicit: only Priority `Task` creates a task.
- Priority-task conversion is idempotent, so retries should not create duplicate tasks for the same message.
- Worker project task start state updates locally only after the task update succeeds.
- Worker and manager notification bells mark message notifications read without deleting or hiding the source message.
- Message and notification realtime refreshes are debounced to avoid burst reloads.

What was not changed:

- No payroll, archive, role, RLS, Storage, GPS, shift, file type, or schema behavior changed.
- No new message, task, or notification features were added.
- No production authenticated smoke was performed by the agent; owner/manual QA is still required after deployment.

Manager checks:

- Send a message to one worker.
- Send a second message without reload.
- Confirm both messages remain in history.
- Confirm read status appears after the worker opens the message.
- Send a normal message and confirm it does not become a task.
- Select Priority `Task` and confirm exactly one real task is created.
- Create a normal task.
- Confirm the worker sees the task.
- Confirm manager sees taken/done statuses after worker action.

Worker checks:

- Open a message.
- Confirm the message remains in message history.
- Open a task.
- Confirm the task remains visible after opening.
- Mark the task taken/started.
- Confirm the task remains visible.
- Mark the task done.
- Confirm the task appears in completed/history area instead of disappearing.

Notification checks:

- Bell count updates when a new message/task arrives.
- Clicking or marking a notification read can clear the signal.
- Source message remains visible in message history.
- Source task remains visible in open/completed task views.
- No duplicate message/task cards appear after repeated realtime updates.

## File / Media Reliability Fix Pack

Run this after deploying `fix(alpha7): harden file and media reliability`.

What was fixed:

- Existing PDF, Word, Excel, CSV, photo, and video support is validated consistently.
- Generic picker MIME with a known allowed extension is handled before upload.
- Storage filenames are safe even when a picker omits the original filename.
- iPhone `.mov` / `video/quicktime` uploads keep a usable extension.
- Task attachment IDs are validated as same-org/same-project before manager task metadata stores them.
- Private bucket open/download paths are signed and normalized.

What was not changed:

- No Storage policy, RLS, bucket, schema, migration, payroll, GPS, shift, archive/trash, role, or business-access behavior changed.
- No new file categories were added.
- No production authenticated smoke was performed by the agent; owner/manual QA is still required after deployment.

Owner/manager checks:

- Upload PDF, Word, Excel, CSV, photo, and video files to a project.
- Open and download each document/video file.
- Open project photos normally.
- Create a task with an attachment if the current UI supports it.
- Send a message with an attachment if the current UI supports it.
- Confirm attachments remain after read, taken, done, and notification-clear actions.

Worker checks:

- Open/download project files where the existing worker workflow allows it.
- Open/download task attachments.
- Open/download message attachments.
- Upload worker media/video where the existing workflow supports it.
- Confirm iPhone `.mov` video does not break upload/open/download.

Archive/Trash checks:

- Confirm file history is not unexpectedly removed by Archive or Trash.
- Confirm payroll archive is not touched.

## Low-Risk Performance Fix Pack

Run this after deploying `fix(alpha7): reduce redundant refresh and subscriptions`.

What was fixed:

- Hidden tabs do less fallback polling for notification/task signals.
- Visible tabs still receive realtime and fallback polling updates.
- Command Center live refresh remains active but refresh bursts are coalesced more calmly.
- Notification/work-alert polls no longer force state updates when the returned list is identical.
- Upload debug logs were removed from file/media hot paths.

What was not changed:

- No project, message, task, notification, file, archive/trash, payroll, GPS, shift, role, permission, RLS, Storage, schema, migration, or Jarvis action behavior changed.

Manual checks:

- Projects page speed feels normal.
- Project detail opens normally.
- Messages send, open, read, and remain in history.
- Tasks open, can be taken, can be marked done, and remain visible where expected.
- Worker notification bell count updates while visible.
- Manager work alert bell updates while visible.
- Hide the tab, return to it, and confirm notification/task signals catch up.
- Command Center opens and live data is not visibly missing.
- Jarvis owner/admin diagnostics remain hidden from normal users.
- Files still open/download.
- No missing records compared with before this pack.

## Mobile UX / Realtime Task Status Fix Pack

Run this after deploying `fix(alpha7): restore mobile navigation and realtime task updates`.

What was fixed:

- Top quick navigation is visible near the top for manager and worker mobile shells.
- Project navigation actions offer Apple Maps, Google Maps, and Tesla-friendly copy/share.
- Copy address remains available.
- Greetings use the signed-in person's name instead of raw role labels.
- High-precision coordinate inputs no longer trigger browser nearest-valid-value popups.
- Manager work alert bell no longer overlaps the mobile sign-out button.
- Manager task board, project detail task list, and worker task state merge realtime task status updates.

Manual checks:

- Log in by PIN and confirm the greeting uses the actual profile name.
- Confirm manager/worker top quick navigation appears near the top and does not replace existing nav.
- Open Projects from the quick row.
- On a project, test Apple Maps, Google Maps, Tesla/share, and copy address.
- Paste `47.799137872580424, -122.24154212345678` into project coordinates and confirm it saves without browser step validation.
- On mobile manager view, confirm notification bells do not cover sign out.
- Worker opens a task, marks it taken, then done.
- Manager sees task status update on Tasks and Project Detail without manual browser refresh.
- Worker still sees task rows after read/taken/done in the existing expected sections.
- Notification read/dismiss still does not hide source task/message.
