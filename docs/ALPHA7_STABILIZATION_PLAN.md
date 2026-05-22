# Alpha-7 Stabilization Plan

This plan protects the current Construction Clock application while Alpha-7 work continues.

## Current Rule

Do not change web application business logic or user workflows without explicit owner approval.

The app should behave the same for owner, manager, worker, projects, tasks, messages, files, archive, payroll, shifts, GPS, Jarvis, and notifications unless a task is explicitly approved as a behavior restore or product change.

## Current Order Of Work

1. Repo hygiene, documentation, read-only audits, and deployment guardrails.
2. Direct SQL Supabase Step 0 after the owner provides safe SQL access.
3. Owner-reviewed architecture fixes that do not change workflows.
4. Application behavior changes only as separate owner-approved tasks.

## Allowed Now

- Documentation and checklists.
- Static code scans.
- Service-role route inventory.
- Dangerous migration and secret-reference detection.
- Public unauthenticated smoke checks.
- Predeploy wrapper scripts that only run local checks.
- Read-only performance observations.
- Tests that only assert existing behavior.

## Deferred To Owner-Approved Tasks

- Messages and read status behavior.
- Tasks, task visibility, claiming, completion, and notifications.
- Archive and Trash behavior.
- Payroll and payroll archive behavior.
- Roles, permissions, and user access behavior.
- Project creation/edit/access behavior.
- GPS, geofence, shifts, clock-in, and clock-out behavior.
- File upload or attachment behavior.
- Jarvis action permissions and write behavior.
- Command Center refresh and navigation behavior.
- Any route behavior that changes what a user can do or see.

## Blocked

- Direct SQL Supabase Step 0 until safe direct SQL access or an active Supabase Dashboard session is available.
- RLS or Storage policy verification through SQL until that gate is open.
- Production database inspection that requires DB URL, SQL Editor, or Supabase access token.
- Any production data mutation.

## Deployment Gate

Before production deploy:

- Confirm the branch and HEAD.
- Confirm `git status --short` is clean.
- Run `npm run check:dangerous`.
- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm test`.
- Run `npm run build`.
- Run `npm run smoke:public` when network access is available.
- Confirm no dirty files after checks.
- Confirm the change does not touch a deferred area unless owner approval is recorded.

## Dangerous Zones

Do not change these without explicit owner approval:

- Payroll calculations and payroll archive.
- Roles, auth, and permissions.
- Supabase RLS.
- Supabase Storage policies and buckets.
- Database schema and migrations.
- Shifts, time events, worker clock-in, and worker clock-out.
- GPS, geofence, project locations, and Safety Brief.
- Archive and Trash behavior.
- Jarvis actions and write permissions.
- Service-role server routes.
- Finance access.
- Production data.

## Owner Manual Verification After Deploy

Use `docs/OWNER_MANUAL_QA_CHECKLIST.md` after each deploy that affects application code.

For non-logic guardrail commits, minimum smoke is:

- Production `/` redirects to `/login`.
- Production `/login` returns 200.
- Known dangerous local reset SQL is not served by production.
- Owner confirms no visible app behavior changed.

## Rollback Notes

Use `docs/ROLLBACK_CHECKLIST.md`.

Rollback application deploys separately from database changes. Do not run reset or wash migrations. Do not roll back production database state unless the owner explicitly approves the exact database action.

