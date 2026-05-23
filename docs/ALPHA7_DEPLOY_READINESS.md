# Alpha-7 Deploy Readiness

Mode: no deploy. This file prepares the owner deploy decision only.

Production URL: `https://check-time-five.vercel.app`

## Required Local Gate

Run and keep passing:

- `npm run check:dangerous`
- `npm run inventory:service-role`
- `npm run smoke:public`
- `npm run lint`
- `npx tsc --noEmit`
- `npm test`
- `npm run build`
- `npm run alpha7:predeploy`

The known lint baseline is 5 warnings and 0 errors.

## Git Gate

- Confirm branch is `fix/postdeploy-qa-audit-patches`.
- Confirm `git status --short` is clean.
- Confirm the intended latest commit hash.
- Do not use `git add -A`.
- Do not deploy uncommitted or dirty work.

## Safety Gate

Confirm no changes were made to:

- Payroll calculations.
- Salary archive or paid-period history.
- Archive/Trash business meaning.
- GPS, geofence, shift, clock-in, clock-out.
- Supabase RLS.
- Storage policies or bucket config.
- Database schema or migrations.
- File allowed business access.
- Production data.

## Blocked Items Before Deployment

Deployment can proceed only as an app-code decision. These are still blocked:

- Direct SQL Supabase Step 0.
- Actual production RLS/Storage policy verification.
- Database query-plan/performance audit.

Do not substitute PostgREST output for the blocked Direct SQL audit.

## Environment Items To Confirm

- Existing production env vars are present.
- No secrets are printed in logs.
- `DETECT_STORE_VISIT_WEBHOOK_SECRET` is configured if the owner wants the store-visit webhook gate enforced. If unset, the function intentionally remains backward-compatible.
- No migration or Supabase SQL action is part of this deploy.

## Owner Deploy Decision Checklist

- Owner reviewed `docs/ALPHA7_OWNER_STATUS_PACK.md`.
- Owner reviewed `docs/OWNER_MANUAL_QA_CHECKLIST.md`.
- Owner accepts that authenticated production QA still needs to happen after deploy.
- Owner accepts that Direct SQL Step 0 is still blocked.
- Owner confirms Sanya has role `driver` before testing driver-only material dropdowns, or plans to set it through `Команда` -> profile -> `Роль` -> `Водитель`.
- Owner explicitly says deploy.

## Post-Deploy Smoke Checklist

- Production `/` redirects or responds as expected.
- Production `/login` returns 200.
- PIN login works for owner/manager/worker.
- Driver login works for a profile with role `driver`; driver remains worker-like and sees material-focused queue.
- Top quick nav row appears on mobile.
- Project navigation actions work.
- Task status updates realtime without manual browser refresh.
- Messages/read status/history work.
- Notifications clear without hiding messages/tasks.
- Project files and attachments open/download.
- Jarvis create_task/create_project require confirmation and report done only after success.
- Archive and Trash remain separate.
- Payroll archive remains visible.

## Rollback Decision

If post-deploy QA finds a P0/P1 regression:

- Identify deployment ID and commit.
- Prefer Vercel app rollback to the last verified deployment.
- Do not rollback database state.
- Do not run `00099_wash_and_reset.sql`.
- Use `docs/ROLLBACK_CHECKLIST.md`.
