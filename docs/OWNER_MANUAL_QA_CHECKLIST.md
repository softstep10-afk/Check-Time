# Owner Manual QA Checklist

Run this after deploys that touch application code or user workflows.

## Alpha-7 Deploy Candidate Must-Check

- Top quick nav row appears near the top on mobile.
- Project navigation offers Apple Maps.
- Project navigation offers Google Maps.
- Tesla-friendly share/copy option is available.
- Copy address remains available.
- First mobile `Поехать` asks for a navigation app and can save it as default.
- Next mobile `Поехать` uses the saved default immediately.
- `Открыть другим способом` lets the user choose a one-time alternative without changing the default unless requested.
- Mobile flicker/blinking is not obvious during normal navigation.
- Manager sees worker task status changes without manual browser refresh.
- Worker task state updates without losing the task.
- Messages send, read status appears, and history stays intact.
- Sender sees message read status update live without leaving the page.
- Notification bell count updates and clearing a notification does not hide the source message/task.
- Project PDF, Word, Excel, CSV, photo, and video uploads/open/download work.
- Task attachments open/download.
- Message attachments open/download.
- iPhone `.mov` video upload/open/download does not break the flow.
- Archive and Trash remain separate.
- Payroll archive/paid history remains visible.
- Worker flow works: clock screen, tasks, messages, files allowed by existing workflow.
- Manager flow works: projects, team, messages, tasks, schedule.
- Owner/admin Jarvis diagnostics are visible only to owner/admin.
- Normal users do not see provider/model diagnostics.

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
- Completion form closes after a successful done save.
- The task details modal does not open automatically after completion.
- Worker can still manually open task details with `Открыть детали`.
- Task does not disappear after read.
- Read, seen, claimed, and completed states still make sense.

## Mobile Project And Task UX

- Tap the manager project card body once; it opens the project on the first tap.
- Tap the worker project card body once; it opens the project on the first tap.
- On a phone, tap project title, empty card space, and lower card body once; each body tap opens immediately.
- Confirm there are no dead zones on the project card body.
- Confirm the visible `Поехать` button appears on project cards when address or coordinates exist.
- Tap `Поехать` on a project card; it opens navigation and does not open the project detail accidentally.
- Open a project detail page and confirm `Поехать` is visible near the title/address without scrolling.
- Open a project-related schedule entry and confirm `Поехать` appears when that project has an address or coordinates.
- Tap address/navigation/copy controls; they do not accidentally open the project.
- Tap copy address/location; copy still works and does not open the project.
- Copy address from a project card and verify the full street, city, state, and ZIP are copied.
- Copy address from project detail and verify the full ZIP/ZIP+4 is not truncated.
- Mobile task buttons fit inside the screen after taking a task.
- `Открыть детали`, `Взять` / `Начать`, and `Готово` stack cleanly on mobile.
- Jarvis floating button does not cover task action buttons.
- Mark a normal task done without entering a description.
- Mark a material task done without entering a description.
- Completion files/notes still save when provided.

## Journal / Active Project / Project Notes

- Open `Журнал`, tap a photo or document, then press browser/device Back.
- Confirm Back closes the media viewer and returns to `Журнал`, not `Задачи`.
- Confirm Journal scroll/filter context is still usable after closing media.
- Start a shift on one project and open `Проекты`.
- Confirm only the active project card shows `На смене здесь` / `Текущая смена`.
- Open that project and confirm the active shift badge is visible near the top.
- Add a public project note as a worker.
- Confirm the note stays in project history, shows author and timestamp, and is not a task/private message.
- Confirm owner/manager can see the note on the project detail/card indicator.
- Confirm a worker without project access cannot add/view that project note.
- In Journal/material/project/task/message upload flows, open the file picker from Downloads/Files.
- Confirm PDF, Word, Excel, CSV, photo, and video files are selectable where the button is for files/documents.
- Confirm photo-only/video-only capture buttons remain photo/video focused where intentionally separate.
- Confirm unsupported file types still show a clear error.

## Driver Time Projects / No-GPS Driver Time

- Owner/manager creates a project named like `Водитель — <Name>`.
- Owner/manager enables the driver time project option.
- Project can be saved without GPS coordinates.
- Driver sees the driver time project in the worker project list.
- Driver clocks in without GPS.
- Owner/manager sees the active driver shift and running time.
- No `No GPS` warning is shown for the driver time project.
- Driver checks out and hours are counted normally.
- A normal construction project without GPS still shows the existing GPS warning.
- Payroll, shifts, archive/trash, and GPS behavior for normal projects remain unchanged.

## GPS Consent / Safety Signatures

- Mobile worker starts a normal shift and sees `Передача геолокации`.
- With checkbox unchecked and name entered, `Подтвердить и продолжить` stays disabled.
- With checkbox checked and empty/spaces-only name, the button stays disabled.
- With checkbox checked and any non-empty signed name, the button enables immediately.
- Confirm GPS consent and verify the modal closes only after save succeeds.
- Reopen/reload same worker for the same consent version; GPS consent is not asked again.
- Use `Пропустить — начать без передачи` and verify it is recorded as skipped/no-GPS, not accepted GPS consent.
- Confirm Safety Brief once.
- Start another shift with the same Safety Brief version and verify Safety Brief is not asked repeatedly.
- Owner/admin opens `Admin -> Audit -> Подписи и согласия`.
- GPS consent record shows worker, signed name, version, accepted/skipped status, and timestamp.
- Safety Brief acknowledgement shows worker, version, project/context, and timestamp.
- CSV export from `Подписи и согласия` works.

## Materials / Driver Workflow

- Driver setup note: Sanya gets the focused driver material queue only when his profile role is `driver` or his stable profile id is configured in `MATERIAL_DRIVER_PROFILE_IDS`.
- If Sanya must remain supervisor-driver, do not change him from `supervisor` to `driver`; configure his profile id in `MATERIAL_DRIVER_PROFILE_IDS`.
- Owner/admin can set a normal driver through `Команда` -> Sanya profile -> `Роль` -> `Водитель` -> `Сохранить профиль`.
- No hardcoded Sanya rule is used.
- Driver remains worker-like and sees the material-focused workflow.
- Supervisor-driver configured by profile id remains worker-like and does not gain manager/admin powers.
- Normal workers still see normal tasks.
- Normal workers also see open shared material tasks.
- No SQL/manual DB mutation is required when the owner/admin UI is available.
- Direct SQL Supabase Step 0 and production RLS/Storage verification remain separate blocked items.
- Open "Добавить материал".
- Confirm the default assignee option is `Любой водитель или рабочий`.
- Dictate or paste `Гипс 5 листов 5/8` into `Вставить спецификацию из Excel`.
- Confirm one editable row appears with material `Гипс`, quantity `5`, unit `листов`, and note/spec `5/8`.
- Dictate or paste repeated text like `Гипс 5 листов 5/8 гипс гипс пять гипс пять листов 5/8`.
- Confirm the parser cleans repeats and does not create duplicate spam rows.
- Paste 5 rows from Excel/Google Sheets into `Вставить спецификацию из Excel`.
- Confirm `Найдено X позиций` appears and the pasted positions become editable.
- Edit one position, remove one position, and add one manually with `Добавить позицию`.
- Attach an Excel/CSV specification file.
- Attach a PDF/photo specification file.
- Confirm saving with no selected person creates an open shared material task.
- Confirm the optional assignee dropdown shows eligible field users only: workers, drivers, and configured supervisor-drivers.
- Confirm Sanya can remain supervisor-driver through `MATERIAL_DRIVER_PROFILE_IDS` when focused driver behavior is needed.
- Confirm the dropdown does not fall back to the full team.
- If no eligible field users exist, confirm the UI shows an empty/none-available state instead of managers/owners/admins.
- Manager creates an urgent open material task.
- Manager creates a non-urgent open material task.
- Confirm saving material shows "Сохраняем..." / "Сохраняем материал..." and duplicate save does not create duplicate tasks.
- Driver sees the material task immediately in the worker task area.
- Worker sees the open material task in addition to normal assigned tasks.
- Worker or driver can press `Взять`; first take wins.
- A second user trying to take the same open material task sees `Задачу уже взял другой человек`.
- Eligible field users receive the existing task notification/banner for the material task where realtime/RLS allows it.
- Driver/worker sees project name, material name, urgency, and needed date.
- Driver/worker can open/download attached material request files through the existing task attachment controls.
- Schedule shows the material task on the selected needed date.
- Owner/manager sees a material-needed badge on project card/detail.
- Owner/manager sees who took/read/completed the task.
- Normal worker task flow still works for non-driver workers.
- Normal tasks do not disappear after read/taken/done.
- Messages remain messages; material request remains a task.
- Notifications can clear without deleting or hiding source tasks.

## Production QA Combined Hotfix

Material drivers:

- Open "Добавить материал".
- Confirm the default option is `Любой водитель или рабочий`.
- Confirm the optional assignee dropdown shows eligible field users, not the full team.
- Confirm Sanya can remain supervisor-driver through `MATERIAL_DRIVER_PROFILE_IDS`.
- Confirm there is no full-team fallback to managers/owners/admins.
- Create an urgent material task.
- Create a non-urgent material task.
- Confirm eligible field users see the open material task and can take it.

Action indicators:

- Saving material shows "Сохраняем..." / "Сохраняем материал...".
- Duplicate save does not duplicate a material task.
- Saved photo/media delete shows "Удаляем...".
- Failed delete shows an error and the UI does not pretend the item was deleted.
- Taking a task shows a pending state.
- Marking a task done shows a pending state.
- False success does not appear before the server response.

Private messages:

- Sender sees a private message after sending.
- Recipient sees the private message after opening/reading.
- Message remains after notification clear.
- Message remains after read status update.
- Owner/manager read status remains visible where supported.
- No private message disappears by itself.
- Private message does not become a task automatically.

Mobile "Поехать":

- Mobile project card/detail shows "Поехать".
- Project card `Поехать` is visible before opening the project when a destination exists.
- Project detail `Поехать` is visible near the top title/address area.
- Tapping `Поехать` does not trigger the project-card open action.
- First tap asks for Apple Maps, Google Maps, or Tesla/share/copy.
- Confirm `Открывать так по умолчанию` stores the selected app locally.
- Confirm next normal `Поехать` opens the saved default immediately.
- Confirm `Открыть другим способом` opens Apple/Google/Tesla/share/copy for one time without resetting the stored default.
- Apple Maps works.
- Google Maps works.
- Tesla/share/copy copies or shares a safe destination; no Tesla login/API is used.
- Future tap opens the saved app directly.
- User can choose another app with `Открыть другим способом` or clear the default with `Сбросить выбор`.
- Copy address/location still works.

Live task/message statuses:

- Worker presses `Взять`; manager sees the task move to `В работе` without leaving the page.
- Worker marks task done; manager sees `Готово` without leaving the page.
- Worker sees his own task status update immediately after the server succeeds.
- Sender sees private/direct message read status update without leaving the message page.
- Recipient message remains in history after reading or pressing `Понял`.
- Notification clear does not remove the source message/task.

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
- `create_project` requires confirmation.
- Jarvis does not say done before the confirmed action completes.
- Jarvis reports failure if a confirmed write does not return a real created record id.
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

## Project Route Guardrails Fix Pack

Run this after deploying `fix(alpha7): add org guards to elevated project routes`.

What was fixed:

- Elevated project/task/message/media/schedule routes reject malformed IDs before service-role mutations.
- Media transcode and AI photo analysis verify the authenticated actor org matches the target media org before elevated metadata writes.
- Existing same-org manager/supervisor and worker workflows were preserved.

Manual checks:

- Manager creates a project normally.
- Manager edits a project normally.
- Manager archives a project and confirms it appears in Archive, not Trash.
- Manager moves a project to Trash and confirms Trash remains a recovery area.
- Manager creates a task with and without attachments.
- Priority `Task` message creates a task only when explicitly selected.
- Worker creates a project task where the existing worker project workflow allows it.
- Worker claims an available project/delivery task.
- Worker opens tasks so seen/read metadata updates without hiding the task.
- Schedule delivery claim/complete still works for the same users as before.
- Project videos that need transcoding still start processing.
- AI photo analysis remains available to the same manager/owner flows as before.
- No supervisor/role access policy should be considered fixed by this pack; that requires a separate owner decision.

## Jarvis Action Audit / Safe Hardening

Run this after deploying `fix(alpha7): harden jarvis action confirmation`.

Manual checks:

- Ask Jarvis to create a task and confirm it only prepares an action first.
- Confirm the task is created only after owner/admin presses the prepared action.
- Ask Jarvis to create a project and confirm it only prepares an action first.
- Confirm the project is created only after owner/admin presses the prepared action.
- Confirm Jarvis does not say the action is done before the confirmed write succeeds.
- Confirm a normal manager/supervisor/worker cannot confirm owner/admin Jarvis write actions.
- Confirm unsupported write requests do not silently mutate messages, documents, payroll, projects, or tasks.
- Confirm provider/model diagnostics are visible only to owner/admin.

## Media Delete Privilege Hotfix

Run this after deploying `fix(alpha7): restrict media deletion to Andrey and Sergey`.

Manual checks:

- Log in as Andrey and confirm saved photo/media delete actions are visible and work.
- Log in as Sergey and confirm saved photo/media delete actions are visible and work.
- Log in as a manager who is not Andrey or Sergey and confirm saved photo/media delete actions are hidden or blocked.
- Log in as supervisor and confirm saved photo/media delete actions are hidden or blocked.
- Log in as worker and confirm saved photo/media delete actions are hidden or blocked.
- If manually testable, direct API delete attempts by a non-privileged user return 403.
- Confirm upload/open/download still work for existing allowed project files, receipts, task attachments, message attachments, photos, and videos.

## Offline / Weak-Network Field Mode

Run this after deploying `fix(alpha7): stabilize offline field workflows`.

Manual checks:

- Turn on airplane mode and confirm the worker shell shows `Нет соединения — работаем офлайн`.
- Before airplane mode, load worker `Задачи`, `Проекты`, one project detail, and `Сообщения`.
- In airplane mode, reopen `Задачи` and confirm last-loaded tasks remain visible with `Офлайн — показаны последние загруженные данные` and `Обновлено: <time>`.
- In airplane mode, open `Проекты` and confirm the last-loaded project list remains visible.
- In airplane mode, tap a project that was opened before; confirm a cached project summary appears.
- In airplane mode, tap a project that was never opened; confirm a friendly no-cache message appears instead of a broken/blank page.
- In airplane mode, open `Сообщения` and confirm last-loaded private/direct message history remains visible.
- In airplane mode, tap `Взять` on an open normal/material task and confirm `Ожидает соединения`.
- Turn the connection back on and confirm the action syncs without creating a duplicate claim.
- If another person already took the material task, confirm the second user sees a clear already-taken error.
- In airplane mode, send a private/direct message without a file and confirm it is queued, not shown as a confirmed send.
- Reconnect and confirm the message appears in sender and recipient history.
- Reconnect and confirm cached/stale warnings clear after fresh data loads.
- Confirm notification clear still does not remove the source message/task.
- Start/finish a task on weak network and confirm no green success appears before server confirmation.
- Try upload on weak connection and confirm upload success appears only after Storage + metadata succeeds.
- Check-in/check-out weak-signal queue still syncs after reconnect and does not duplicate shifts.

## Deploy Readiness Smoke

Run this immediately after any owner-approved Alpha-7 deployment:

- Production `/` redirects or responds as expected.
- Production `/login` returns 200.
- Owner PIN login works.
- Manager PIN login works.
- Worker PIN login works.
- Perform the Alpha-7 deploy candidate must-check section above.
- Record deployment ID, deployment URL, commit hash, and any failed manual QA item.

## Final Alpha-7 QA Section

A. Driver setup

- Confirm Sanya has role `driver`.
- Confirm Sanya appears in material dropdown.
- Confirm non-drivers do not appear.
- Confirm driver-only filtering.

B. Material workflow

- Create urgent material task.
- Create non-urgent material task.
- Confirm notification/banner.
- Confirm schedule date.
- Confirm project material badge.
- Confirm seen/taken/done realtime.

C. Messages

- Confirm sender history.
- Confirm recipient history.
- Confirm read status.
- Confirm notification clear does not remove message.

D. Actions

- Confirm save indicator.
- Confirm delete indicator.
- Confirm take/done indicator.
- Confirm no duplicate writes.

E. Navigation

- Confirm `Поехать` first choice.
- Confirm stored preference.
- Confirm Apple/Google/Tesla-share.
- Confirm copy address.
