# Alpha-7 Regression Impact Rules

Purpose: every future change must start with a small Impact Map so we protect working flows without forcing the owner to retest the whole app every time.

This is a process guardrail. It does not change app behavior.

## Mandatory Impact Map

Before changing code, write an Impact Map in the working update, PR note, or task report.

The Impact Map must include:

1. Files, components, routes, scripts, or docs likely to change.
2. All known screens using those components.
3. Business flows that could be affected.
4. Dangerous zones touched, or `none`.
5. What must not change.
6. Targeted regression tests to run.
7. Manual QA limited to the affected flows only.

Use:

```bash
npm run alpha7:impact-template
```

If the change is broad or touches a shared component, also use `docs/CRITICAL_PATH_SMOKE_ALPHA7.md`.

Dangerous-zone definitions live in `docs/DANGEROUS_ZONES_ALPHA7.md`.

## Shared Component Rule

If a shared component is changed:

- List every known screen that imports or renders it.
- Add or verify tests for every affected use.
- Do not deploy until the affected flows are covered.
- Prefer source-level guards when full UI automation is not practical.

## Worker Mobile UI Rule

If a task touches worker mobile UI, check:

- Check-in.
- Active project.
- Checkout.
- Tasks.
- Messages.
- Project media.
- Project navigation.
- Offline banner.

## Project Card Rule

If a task touches project cards, check:

- Open project.
- `Поехать`.
- Copy address.
- Active project badge.
- Project notes.
- Media/document access.

## Media / Upload Rule

If a task touches media or upload, check:

- Photo.
- Video.
- PDF.
- Word, Excel, CSV.
- Worker upload.
- Manager upload.
- Task attachment.
- Message attachment.
- Open/download/delete.

Media delete permissions must not broaden unless the owner explicitly approves that exact behavior.

## Task Rule

If a task touches task behavior, check:

- Create task.
- Open task.
- Take task.
- Complete task.
- Material task.
- Normal task.
- Status realtime.
- Notification behavior.

Messages and tasks must remain separate unless the owner explicitly approves a separate behavior change.

## Message Rule

If a task touches messages, check:

- Sender history.
- Recipient history.
- Read status.
- Notification clear.
- Second message without reload.
- Message does not become task.

Notification state is only a signal; clearing it must not hide or delete the source message.

## Minimum Final Report Addendum

Every future final report should include:

- Impact Map completed: yes/no.
- Shared components changed: yes/no.
- Affected screens.
- Dangerous zones touched: none/list.
- Regression tests run.
- Manual QA scope.
- Explicit list of forbidden zones not touched.

## Forbidden Without Owner Approval

- Deploy.
- SQL.
- Migrations.
- Schema changes.
- Supabase RLS changes.
- Storage policy changes.
- Production data mutation.
- Payroll changes.
- Archive/trash changes.
- GPS, geofence, clock-in/out, or shift changes.
- Broad role redesign.
- Media delete privilege redesign.
- Message/task lifecycle redesign.
