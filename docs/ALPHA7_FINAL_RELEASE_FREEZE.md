# Alpha-7 Final Release Freeze

Date: 2026-05-28

Production URL: `https://check-time-five.vercel.app`

Purpose: freeze Alpha-7 into a verifiable state before continuing new feature development. This pack is documentation and process only. It does not deploy, run SQL, create migrations, change schema/RLS/Storage, or mutate production data.

## Current Release Discipline

Before any deploy:

- Confirm branch and intended commit:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git log -10 --oneline
```

- `git status --short` must be empty.
- The intended commit must be named in the owner approval message.
- Full Alpha-7 checks must pass.
- Dangerous-zone review must be clean or explicitly owner-approved.
- Impact Map must exist for the change.
- Targeted manual QA must be defined from the impacted flows.
- Do not deploy generated report noise, unrelated files, local experiments, or uncommitted work.

## Known Production Deploy Trail

Known owner-approved deployed commits from the Alpha-7 hardening sequence in this thread:

- `303f358` `fix(alpha7): improve material messages and navigation feedback`
- `a7238c8` `fix(alpha7): support supervisor driver material assignment`
- `c0d8991` `fix(alpha7): repair consent confirmation and audit records`
- `6229988` `fix(alpha7): stabilize offline field workflows`
- `d404c88` `fix(alpha7): restore visible offline state`
- `26435b0` `fix(alpha7): stabilize material voice paste parsing`
- `9ef4a83` `fix(alpha7): make project cards open reliably on mobile`
- `60a781d` `fix(alpha7): make project card first tap reliable`
- `82fdd08` `fix(alpha7): restore visible worker checkout action`
- `c023509` `chore(alpha7): add production readiness diagnostics`

Production diagnostics were added in `c023509`. Owner/admin should verify `/admin/diagnostics` after every deploy and compare the displayed commit with the intended release commit.

## Local Hardening Commits Not Automatically Deployed

The current branch may contain local hardening commits after the last known production deployment. These commits must not be assumed deployed until Vercel diagnostics or an approved deploy confirms them:

- `265527e` / `347a220` `chore(alpha7): add regression impact guardrails`
- `a73d0d4` `fix(alpha7): stabilize worker mobile critical path`
- `dd6e39a` `fix(alpha7): stabilize manager owner critical path`
- `9de5056` `docs(alpha7): prepare supabase step0 audit pack`
- The commit containing this final release freeze pack.

Use `git rev-parse HEAD` and `/admin/diagnostics` to verify the latest intended commit before deploy.

## Production Diagnostics

Owner/admin-only route:

`/admin/diagnostics`

It should show:

- App version.
- Commit SHA.
- Short SHA.
- Branch/ref.
- Build time.
- Deploy environment.
- Deployment URL.

It must not show:

- Service-role keys.
- Database URLs.
- Supabase secrets.
- Private tokens.
- PINs.
- Session cookies.
- Payroll/private production records.

## Known Risks

- Direct SQL Supabase Step 0 has not been run by Codex.
- Production RLS policy bodies are not directly verified by this final pass.
- Storage policy bodies and bucket configuration are not directly verified by this final pass.
- Applied production migration state is not directly verified by this final pass.
- Grants and service-role bypass risks still need owner-approved Supabase Step 0 review.
- Authenticated owner/manager/worker/driver manual QA is still required.
- Some critical behavior depends on production environment/config values, for example `MATERIAL_DRIVER_PROFILE_IDS`.
- Production diagnostics can confirm deployed commit only after owner/admin login.
- Known dangerous local SQL file `supabase/migrations/00099_wash_and_reset.sql` must remain unexecuted and reported as dangerous.

## Blocked Supabase / RLS / Storage Items

These are separate blocked items, not app-code hotfixes:

- Applied migration verification.
- RLS enabled/forced state verification.
- RLS policy body review.
- Storage bucket policy review.
- Storage bucket config review.
- Grants review for `anon`, `authenticated`, and `service_role`.
- Schema/table/column mismatch review.
- Service-role route bypass risk review against production DB state.
- Safety/GPS consent table verification.
- Payroll/archive table and RLS verification.

Use:

- `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`
- `docs/DANGEROUS_ZONES_ALPHA7.md`
- `npm run inventory:service-role`
- `npm run alpha7:route-mutation-map`

## Do Not Touch Zones Without Explicit Owner Approval

- Payroll calculation and paid-period logic.
- Salary archive and payroll archive.
- Shift/clock-in/clock-out calculations.
- GPS/geofence warning logic.
- Archive/trash lifecycle.
- Supabase migrations.
- Supabase RLS policies.
- Storage policies and bucket config.
- Production data rows.
- Broad role hierarchy.
- Material queue business rules.
- Message/task lifecycle.
- Media delete privilege semantics.
- Auth/session/PIN handling.
- Jarvis mutation permissions.

## Required Final Checks

Run before any release decision:

```bash
npm run alpha7:invariant-gate --if-present
npm run alpha7:route-mutation-map --if-present
npm run alpha7:coverage-map --if-present
npm run alpha7:danger-zone-diff --if-present
npm run check:dangerous
npm run inventory:service-role
npm run smoke:public
npm run lint
npx tsc --noEmit
npm test
npm run build
npm run alpha7:predeploy
npm run alpha7:release-audit --if-present
npm run alpha7:critical-smoke --if-present
```

Expected known caveats:

- `check:dangerous` should continue reporting the known local dangerous SQL file.
- `lint` may show existing warnings if they are already known; new errors block deploy.
- Generated reports may update timestamps; do not commit report noise unless explicitly intended.

## Rollback Procedure

If production QA fails after deploy:

1. Stop new changes.
2. Record failed item, user role, device, URL, timestamp, and deployed commit from `/admin/diagnostics`.
3. Decide whether to:
   - roll back Vercel to the previous known good deployment, or
   - prepare a separate hotfix commit.
4. Do not run SQL during app rollback.
5. Do not mutate production data during app rollback.
6. Use `docs/ROLLBACK_CHECKLIST.md`.
7. After rollback or hotfix deploy, run unauthenticated smoke and targeted manual QA for impacted flows.

## Freeze Decision

Recommended state after this pack:

- Keep Alpha-7 feature work frozen until owner runs `docs/ALPHA7_FINAL_QA_CHECKLIST.md`.
- Do not deploy local guardrail/audit/freeze commits unless owner explicitly approves a readiness/process deploy.
- If production QA finds a bug, create one focused hotfix task and Impact Map for that single issue.

