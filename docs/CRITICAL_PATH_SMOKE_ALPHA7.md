# Alpha-7 Critical Path Smoke

Purpose: a stable “core app health” smoke checklist for future changes. Use it when a change affects broad shared surfaces, when the Impact Map is unclear, or before an owner-approved production deploy.

This checklist is not a replacement for targeted QA. It is the smallest broad smoke pass for the app’s critical daily workflows.

## How To Use

- Start with the Impact Map from `docs/REGRESSION_IMPACT_RULES_ALPHA7.md`.
- Run only the impacted sections for normal changes.
- Run the full checklist for broad shared components, release candidates, or suspicious regressions.
- Record pass/fail one item at a time.
- If one item fails, stop broad fixing and create a focused hotfix task.

## Core Smoke Checklist

Authentication and shell:

- Login works for owner/admin, manager, supervisor, worker, and driver-like field user where available.
- Sign out remains reachable.
- Protected routes redirect/block without a session.

Projects and navigation:

- Open project from project card/list.
- `Поехать` works.
- Copy address copies the full human-readable address.
- Project detail opens without a blank/broken page.
- Active project badge appears on the active shift project.

Shift flow:

- Start shift.
- Active project shows current shift state.
- Finish shift.
- Checkout notes/evidence rules remain as approved.
- GPS/no-GPS behavior remains unchanged for normal projects.

Tasks:

- Create normal task.
- Open task details.
- Take task.
- Complete task.
- Normal task remains visible through read/taken/done lifecycle.
- Task status updates live where the current realtime flow supports it.
- Task notification clear does not hide the source task.

Materials:

- Material queue opens.
- Open material task appears for eligible field users.
- Eligible user can take material task.
- Owner/manager sees who took it.
- Material task can be completed.
- Normal task behavior is unchanged.

Messages:

- Send private/direct message.
- Recipient sees message.
- Sender keeps sent message in history.
- Recipient read status updates.
- Notification clear does not remove source message.
- Second message can be sent/read without leaving the page.
- Message does not become a task unless explicitly created as task behavior.

Media and files:

- Upload photo.
- Upload video, including iPhone MOV/QuickTime where practical.
- Upload PDF/document.
- Upload Word/Excel/CSV.
- Worker upload still works.
- Manager upload still works.
- Task attachment open/download works.
- Message attachment open/download works.
- Project media tabs show `Все`, `Фото`, `Видео`, `Документы / PDF`.
- Existing delete permissions remain unchanged.

Journal photo back:

- Open journal photo.
- Browser/app Back returns to Journal, not Tasks.
- Journal scroll/filter state is preserved where practical.

Compliance and safety:

- GPS consent prompt works when required.
- GPS consent accepted/skipped behavior remains version-aware.
- Safety Brief works when required.
- Same-version Safety Brief is not repeated unnecessarily.

Offline and weak network:

- Offline banner appears.
- Queued action shows `Ожидает соединения`.
- Reconnect shows sync state.
- Reconnect sync resolves without duplicate actions.
- Last-loaded field pages show cached/stale data where implemented.

Project notes:

- Worker can add public project note where allowed.
- Owner/manager can see project note.
- Project note is not a task or private message.
- Project note live merge works where the current realtime flow supports it.

Release diagnostics:

- Owner/admin can open `/admin/diagnostics`.
- Commit/version/build/deploy environment are visible.
- Normal users cannot access diagnostics.
- No secrets, tokens, PINs, service-role keys, database URLs, payroll/private records, or session data are exposed.

## Expected Failure Handling

- Report one failed item at a time.
- Do not ask for “fix everything.”
- Do not broaden the fix beyond the failed workflow.
- Re-run only the impacted checklist section plus any shared-component checks from the Impact Map.
