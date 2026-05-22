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

