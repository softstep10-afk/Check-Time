# Alpha-7 Next Actions

## Immediate Next Action

Owner deploy decision.

What changes:

- Nothing changes until the owner explicitly approves deployment.
- If approved, the current app code can be deployed after a final clean status and full predeploy check.

What does not change:

- No database migration.
- No RLS or Storage policy change.
- No production data mutation.
- No payroll/archive/GPS/shift logic change.

What could break:

- User-facing regressions that only show during authenticated production use.
- Environment-specific Jarvis/media/webhook behavior.
- Realtime behavior under real mobile network conditions.

Owner approval required: yes, explicit deploy approval is required.

## After Deploy

Run the owner manual QA checklist in `docs/OWNER_MANUAL_QA_CHECKLIST.md`.

Priority order:

1. Login and top mobile navigation.
2. Realtime task status.
3. Messages/read status/notifications.
4. Project files and attachments.
5. Archive/Trash and payroll archive verification.
6. Jarvis action confirmation and diagnostics visibility.

## Still Blocked

- Direct SQL Supabase Step 0.
- Real RLS/Storage policy verification.
- Database performance/query plan audit.
- Production log review without dashboard access.

## Deferred Owner Decisions

- Supervisor access policy.
- Role/access redesign.
- Storage/RLS hardening.
- Archive/Trash retention redesign.
- Payroll model consolidation.
- App-wide realtime/data-loading redesign.
- Pagination or virtualized large lists.
