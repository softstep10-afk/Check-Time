# AI Action Model

This model defines the future AI action boundary. It is not implemented yet.

## Core Flow

1. AI drafts.
2. Owner approves.
3. System executes.
4. Audit records.

AI may help prepare work, but sensitive changes require human approval before execution.

## Allowed Future AI Behavior

- Draft summaries.
- Draft messages.
- Draft estimates, invoices, change orders, and client updates when those modules exist.
- Suggest next actions.
- Classify documents or messages.
- Prepare `prepared_actions` records when that future layer exists.
- Read only data the current user is allowed to read.
- Use the same server APIs as humans.

## Forbidden AI Behavior

AI cannot:

- send emails automatically
- change money without approval
- change payroll without approval
- change access grants without approval
- change storage visibility without approval
- publish client-visible records without approval
- bypass RLS
- bypass private storage signed URL checks
- see data outside current user permissions
- use service-role or admin channels as a hidden shortcut
- mutate production data without an approved system action path

## Future Prepared Actions

`prepared_actions` and action approvals are a future layer. They are not implemented yet.

When implemented, they must include:

- action type
- target entity
- proposed payload
- proposing user or AI context
- required approval role
- approval status
- execution status
- audit event id
- timestamps

No AI god-mode. No bypass channel.
