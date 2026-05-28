# Predeploy Checklist

Use this before any production deploy.

## Git State

- Confirm the task has an Impact Map from `docs/REGRESSION_IMPACT_RULES_ALPHA7.md`.
- Confirm branch: `git branch --show-current`.
- Confirm HEAD: `git rev-parse HEAD`.
- Confirm clean tree: `git status --short`.
- Confirm changed files are intended.
- Do not deploy with unrelated dirty files.
- Do not use `git add -A`.

## Regression Impact Gate

- Impact Map lists changed files/components/routes.
- Impact Map lists all known screens that use changed shared components.
- Impact Map lists affected business flows.
- Impact Map declares dangerous zones touched: `none` or exact list from `docs/DANGEROUS_ZONES_ALPHA7.md`.
- Impact Map says what must not change.
- Targeted regression tests were run for affected flows.
- Manual QA scope is limited to affected flows and is written down.
- Critical-path smoke sections from `docs/CRITICAL_PATH_SMOKE_ALPHA7.md` are selected for broad/shared changes.
- If a shared component changed, every known use has a test/source guard or manual QA line.
- If worker mobile UI changed, QA covers check-in, active project, checkout, tasks, messages, project media, project navigation, and offline banner as applicable.
- If project cards changed, QA covers open project, `Поехать`, copy address, active project badge, project notes, and media/document access.
- If media/upload changed, QA covers photo, video, PDF, Word/Excel/CSV, worker upload, manager upload, task attachment, message attachment, and open/download/delete.
- If tasks changed, QA covers create/open/take/complete, material task, normal task, status realtime, and notification behavior.
- If messages changed, QA covers sender history, recipient history, read status, notification clear, second message without reload, and message does not become task.

## Local Checks

- Install dependencies only if needed.
- Run `npm run check:dangerous`.
- Run `npm run inventory:service-role`.
- Run `npm run lint`.
- Run `npx tsc --noEmit`.
- Run `npm test`.
- Run `npm run build`.
- Run `npm run smoke:public` when network access is available.
- Run `npm run alpha7:danger-zones`.
- Run `npm run alpha7:route-guards`.
- Run `npm run alpha7:coverage-map`.
- Run `npm run alpha7:rc-safety-gate` for local Alpha-7 regression gates.
- Run `npm run alpha7:release-audit --if-present` and compare local HEAD with the intended production commit.
- Run `npm run alpha7:impact-template --if-present` when preparing a new task or release report.
- Run `npm run alpha7:critical-smoke --if-present` to verify the critical smoke checklist remains available.
- Run `npm run alpha7:predeploy` before owner-approved deploys.
- Confirm `git status --short` is still clean after checks.

## Public Smoke

- Local `/login` renders if a local server is already running.
- Local protected route redirects to `/login` without a session.
- Production `/` redirects to `/login`.
- Production `/login` returns 200.
- Production does not serve `supabase/migrations/00099_wash_and_reset.sql`.

## Safety Checks

- No secrets printed in logs.
- No `.env*` files staged.
- No service-role key value committed.
- No database URL committed.
- No accidental Supabase SQL execution.
- No migrations created or run.
- No RLS or Storage policy changes.
- No bucket changes.
- No production data mutation.
- No business logic changes unless explicitly owner-approved.
- If file/media code changed, confirm the owner manual QA file section is scheduled after deploy.
- If release diagnostics changed, confirm `/admin/diagnostics` is owner/admin-only and exposes only version/build metadata.
- If any dangerous zone from `docs/DANGEROUS_ZONES_ALPHA7.md` was touched unexpectedly, stop and report before deploy.

## Forbidden Without Owner Approval

- Payroll.
- Roles and permissions.
- Auth/session behavior.
- Project access behavior.
- Messages and tasks behavior.
- Archive and Trash behavior.
- GPS, shifts, clock-in, clock-out, and Safety Brief.
- Jarvis action behavior.
- File upload behavior.
- Supabase RLS, Storage policies, and schema.

## Dangerous-Zone Declaration

- Every task must state `Dangerous zones touched: none` or list the exact dangerous zones.
- Unexpected dangerous-zone diffs require stop-and-report.
- Do not hide payroll, shift, GPS, archive/trash, auth/session, service-role, Storage, RLS, schema, material queue core, or task/message lifecycle changes inside unrelated work.

## Release Diagnostics

- Before deploy, record intended commit SHA.
- After deploy, owner/admin opens `/admin/diagnostics`.
- Confirm app version, commit SHA, build time, deployment environment, and deployment URL are visible.
- Confirm no service-role key, database URL, token, PIN, or private production data is visible.
