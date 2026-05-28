#!/usr/bin/env node

const template = String.raw`Alpha-7 Impact Map

1. Files/components/routes likely to change
- 

2. Screens using those components
- 

3. Business flows that could be affected
- 

4. What must not change
- No deploy unless owner approves.
- No SQL, migrations, schema, RLS, or Storage changes unless explicitly approved.
- No production data mutation.
- No payroll, archive/trash, GPS/clock-in/out, or shift behavior change unless explicitly approved.
- No media delete permission, task/message lifecycle, material queue, or role redesign unless explicitly approved.

5. Targeted regression tests to run
- 

6. Manual QA limited to affected flows
- 

Shared component checklist, if applicable
- Known screens listed.
- Tests/guards cover every affected use.
- No deploy until affected flows are covered.

Worker mobile UI checklist, if applicable
- Check-in.
- Active project.
- Checkout.
- Tasks.
- Messages.
- Project media.
- Project navigation.
- Offline banner.

Project card checklist, if applicable
- Open project.
- Поехать.
- Copy address.
- Active project badge.
- Project notes.
- Media/document access.

Media/upload checklist, if applicable
- Photo.
- Video.
- PDF.
- Word/Excel/CSV.
- Worker upload.
- Manager upload.
- Task attachment.
- Message attachment.
- Open/download/delete.

Task checklist, if applicable
- Create task.
- Open task.
- Take task.
- Complete task.
- Material task.
- Normal task.
- Status realtime.
- Notification behavior.

Message checklist, if applicable
- Sender history.
- Recipient history.
- Read status.
- Notification clear.
- Second message without reload.
- Message does not become task.
`;

console.log(template);
