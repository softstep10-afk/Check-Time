# Overnight Fix Pack 4 - Low-Risk Performance

## Scope

This pack reduces redundant client work without changing visible data, user workflows, access rules, or database behavior.

- Message/notification bell polling.
- Manager work alert bell realtime/poll overlap.
- Worker task fallback polling.
- Command Center route refresh debounce.
- File/media upload console noise.
- Pure list state stability helper.

No pagination, virtualized lists, query-scope changes, RLS/Storage/schema changes, role changes, or deployment were performed.

## What Was Fixed

- Worker notification bell now skips fallback polling while the tab is hidden and reloads on visibility return.
- Manager work alert bell now skips hidden-tab poll/realtime reload scheduling and reloads on visibility return.
- Worker task fallback polling now runs only while the tab is visible; realtime and visibility refresh remain in place.
- Notification/work-alert list state now keeps the current array reference when a poll returns the same records, reducing unnecessary renders.
- Command Center live refresh is still active but less aggressive during event bursts, reducing repeated full route refreshes from broad realtime tables.
- Project media and task attachment upload debug `console.log` noise was removed; errors and warnings remain.

## What Was Not Changed

- Project visibility.
- Message visibility/history/read behavior.
- Task visibility/read/taken/done behavior.
- Notification meaning.
- Archive/Trash behavior.
- Payroll and salary archive.
- GPS, shifts, clock-in, and clock-out behavior.
- Roles, permissions, auth/session behavior.
- Supabase RLS, Storage policies, bucket config, database schema, or migrations.
- File allowed types, upload/open/download behavior.
- Jarvis action permissions and model routing.

## What Was Deferred

- Pagination.
- Virtualized large lists.
- Changing query scopes or record filters.
- Changing which records are loaded.
- App-wide realtime channel consolidation.
- Command Center redesign or server data loading redesign.
- Message/task data loading redesign.
- Database indexes, query plans, or migrations.
- Supabase/RLS/Storage performance optimization.
- Authenticated production runtime profiling.

## Manual QA Checklist

- Projects page load feels normal.
- Project detail opens normally.
- Messages send, open, read, and remain in history.
- Tasks open, taken, and done states remain correct.
- Worker notification bell count updates when visible.
- Manager work alert bell updates when visible.
- Command Center opens and live data is not visibly missing.
- Jarvis owner/admin diagnostics remain hidden from normal users.
- File open/download still works.
- No missing records compared with before the performance pack.

## Known Limitations

- Direct SQL Supabase Step 0 remains blocked.
- Real production RLS/Storage policies and query plans were not inspected.
- No authenticated production timing profile was captured.
