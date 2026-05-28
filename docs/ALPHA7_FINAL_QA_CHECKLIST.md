# Alpha-7 Final QA Checklist

Use this after a production deploy or before declaring Alpha-7 ready for daily company use. This checklist is manual QA only. Do not run SQL, migrations, schema changes, RLS changes, Storage policy changes, or production data mutations while executing it.

## 0. Release Identity

- Open `/admin/diagnostics` as owner/admin.
- Confirm commit SHA matches the intended deployed commit.
- Confirm app version/build time/deploy environment are visible.
- Confirm no secrets, service-role keys, database URLs, tokens, PINs, payroll/private data, or session values are visible.
- Confirm `git status --short` was clean before deploy.

## 1. Roles

Check with safe test accounts or real users only when owner approves:

- Owner/admin can open owner/admin surfaces.
- Manager can open manager daily surfaces.
- Supervisor remains worker-like unless existing flow says otherwise.
- Worker remains worker-like.
- Driver sees material-focused workflow and does not see manager/admin controls.
- Supervisor-driver stays supervisor and becomes material-driver capable only through approved `MATERIAL_DRIVER_PROFILE_IDS` config.
- No hardcoded Sanya rule exists; Sanya-specific behavior comes from role/config, not name matching.

## 2. Worker Mobile Critical Path

- Log in on mobile.
- Complete GPS consent if prompted.
- Complete Safety Brief if prompted.
- Open Projects tab.
- Tap project card title/body/lower area once; project opens on first tap.
- Tap `Поехать`; it does not open the project accidentally.
- Copy address; full ZIP/ZIP+4 is preserved.
- Start shift.
- Confirm active project badge appears.
- Open active project.
- Confirm `Завершить смену` is visible and reachable.
- Finish shift with empty notes when rules allow.
- Confirm required checkout video still blocks checkout until uploaded when the worker requires video.
- Confirm GPS/no-GPS behavior remains unchanged for normal projects.

## 3. Tasks

- Manager creates a normal task.
- Worker sees the task without leaving/re-entering if realtime is active.
- Worker opens task details manually.
- Worker takes task.
- Manager sees task taken/in progress without leaving page.
- Worker marks task done.
- Manager sees done without leaving page.
- Task remains visible after read/taken/done.
- No duplicate task appears after realtime update.
- Completion notes/files remain optional unless a specific rule requires them.
- Completion details modal does not auto-open after marking done.

## 4. Material Queue

- Owner/manager opens `Добавить материал`.
- Default assignee is `Любой водитель или рабочий`.
- If no person is selected, the material task becomes open/shared.
- Worker sees open material task in addition to normal tasks.
- Driver sees material tasks but not normal construction tasks.
- Eligible field user takes open material task.
- Second user cannot take already-taken task and sees a clear error.
- Owner/manager sees who took/read/done.
- Schedule shows material task by due date.
- Material notification text includes project/material/urgency.
- Material file attachments open/download.

## 5. Material Paste / Voice / Documents

- Paste 5 rows from Excel or Google Sheets.
- Confirm rows parse into editable material positions.
- Dictate or paste `Гипс 5 листов 5/8`.
- Confirm one reasonable row appears.
- Dictate repeated text and confirm duplicates are cleaned, not spammed into many rows.
- Add/remove/edit manual positions.
- Attach Excel/CSV file.
- Attach PDF/photo.
- Save material request.

## 6. Messages

- Manager sends private/direct message to worker.
- Sender sees sent message in history.
- Recipient sees received message in history.
- Recipient clicks read/`Понял`.
- Message remains in normal history.
- Sender sees read status update live.
- Clearing notification does not remove source message.
- Sending a second message works without reload.
- Message does not become a task.

## 7. Project Navigation

- Project card shows `Поехать` when address or coordinates exist.
- Project detail shows `Поехать` near the top.
- First navigation choice can store Apple Maps.
- First navigation choice can store Google Maps.
- Tesla remains share/copy only; no Tesla API/OAuth/token flow appears.
- Saved preference is reused.
- `Открыть другим способом` lets user choose one-time alternative.
- Coordinates are preferred for navigation.
- Address fallback works.
- Copy address remains human-readable and complete.

## 8. Media / Uploads / Journal

- Project media tabs show `Все`, `Фото`, `Видео`, `Документы / PDF`.
- Images appear under `Фото`.
- Videos appear under `Видео`.
- PDF/Word/Excel/CSV appear under documents.
- Upload photo works.
- Upload video works, including iPhone MOV/QuickTime when supported by validation.
- Upload PDF/Word/Excel/CSV works from Downloads/Files.
- Open/download still works.
- Delete appears only for approved Andrey/Sergey/configured identity helper.
- Non-privileged users cannot delete.
- Open Journal photo/media, press browser/device Back, and return to Journal, not Tasks.

## 9. Project Notes

- Worker with project access adds public project note.
- Note shows author and timestamp.
- Owner/manager sees note on project detail/card indicator.
- Worker without project access cannot add/view note.
- Note is not a task.
- Note is not a private message.
- Project notes update live or after safe focused refresh without broad page reload.

## 10. Offline / Weak Network

- Load worker project/task/message pages online.
- Turn on airplane mode.
- Offline banner appears: `Нет соединения` / `Работаем офлайн`.
- Previously loaded worker data remains visible with stale warning and timestamp.
- Task take queues as `Ожидает соединения`.
- Material task take queues safely.
- Private message without file queues safely.
- Reconnect shows `Синхронизация...`.
- After sync, queued action resolves to sent/updated state.
- No duplicate queued actions.
- No fake success before server confirmation.

## 11. Safety / GPS Consent Audit

- GPS consent confirm button enables when checkbox is checked and signed name is non-empty.
- Accepted GPS consent saves once per version.
- Same version does not ask repeatedly.
- New version can ask again.
- Skip/no-GPS records `consented=false`, not accepted consent.
- Safety Brief saves once per version.
- Owner/admin opens `Admin -> Audit -> Подписи и согласия`.
- GPS consent and Safety Brief rows are visible.
- CSV export works.

## 12. Manager / Owner Daily Flow

- Owner opens project from project card.
- Project media tabs/counts render.
- Upload/open/download/delete media behavior is preserved.
- Create task.
- Assign task.
- Create material request.
- Send/read message.
- Worker status and active shifts update.
- Checkout videos are visible where expected.
- Public project notes visible.
- Command Center readable with list limits.
- Jarvis next actions and action journal still present.
- Owner attention queue and operations list remain accessible.

## 13. Archive / Trash / Payroll

- Archive and Trash remain separate.
- Archived project history is visible in Archive.
- Deleted rows appear in Trash.
- Payroll archive/paid history visible only to finance-authorized owner/admin/manager.
- Non-finance manager does not see payroll amounts.
- No payroll calculation behavior changed during QA.

## 14. Supabase Step 0 Blockers

Do not attempt to solve these during manual app QA:

- Applied migrations.
- RLS policy bodies.
- Storage policy bodies.
- Grants.
- Schema mismatch.
- Service-role bypass risk.
- Media bucket configuration.
- Safety/GPS consent table shape.
- Payroll/archive RLS.

Use `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md` only when owner approves direct SQL review.

## 15. If QA Fails

- Report one failed item at a time.
- Include role, device, browser, URL, exact action, expected behavior, observed behavior, and diagnostics commit SHA.
- Do not ask Codex to “fix everything” in one task.
- Create a separate focused hotfix commit.
- Do not deploy until checks pass and owner approves.
