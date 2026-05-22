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
