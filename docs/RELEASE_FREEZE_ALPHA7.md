# Alpha-7 Release Freeze Checklist

Production URL: `https://check-time-five.vercel.app`

Use this checklist before any owner-approved production deploy. This is release discipline only; it does not require SQL, migrations, RLS changes, Storage policy changes, or production data mutation.

## Freeze Rules

- Deploy only from a clean git tree.
- Deploy only after full Alpha-7 checks pass.
- Record the intended commit hash before deploy.
- Do not deploy hidden local files or unrelated work.
- Do not change environment variables during deploy unless the owner approved the exact variable.
- Do not run SQL, migrations, reset scripts, or wash scripts as part of app release.

## Required Local Snapshot

Run and save the output in the release note:

```bash
git branch --show-current
git rev-parse HEAD
git status --short
git log -5 --oneline
npm run alpha7:release-audit --if-present
```

Expected:

- Branch is the intended release branch.
- `git status --short` is empty.
- `HEAD` matches the commit approved for release.
- Release audit does not show a dirty tree or unexplained local/production mismatch.

## Required Checks

Run:

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
```

Known local warning area: `00099_wash_and_reset.sql` should continue to be reported as dangerous local SQL and must not be executed.

## Owner/Admin Diagnostics

After deploy, owner/admin can open:

`/admin/diagnostics`

Verify:

- App version is visible.
- Commit SHA is visible.
- Build time is visible.
- Deployment environment is visible.
- No service-role key, database URL, private token, payroll/private data, PIN, or session secret is shown.

## Production Smoke

Unauthenticated smoke only:

- `/` redirects or renders the login gate.
- `/login` returns 200.
- `/projects` redirects/blocks to login without exposing data.

Authenticated owner QA then follows `docs/OWNER_MANUAL_QA_CHECKLIST.md`.

## Rollback Discipline

- Roll back app deployment separately from database state.
- Prefer Vercel rollback or alias promotion to a known good deployment.
- Do not roll back or mutate database state without separate owner approval.
- Use `docs/ROLLBACK_CHECKLIST.md`.
