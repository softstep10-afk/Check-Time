# Predeploy Checklist

Use this before any production deploy.

## Git State

- Confirm branch: `git branch --show-current`.
- Confirm HEAD: `git rev-parse HEAD`.
- Confirm clean tree: `git status --short`.
- Confirm changed files are intended.
- Do not deploy with unrelated dirty files.
- Do not use `git add -A`.

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

## Release Diagnostics

- Before deploy, record intended commit SHA.
- After deploy, owner/admin opens `/admin/diagnostics`.
- Confirm app version, commit SHA, build time, deployment environment, and deployment URL are visible.
- Confirm no service-role key, database URL, token, PIN, or private production data is visible.
