# Rollback Checklist

Production URL: `https://check-time-five.vercel.app`

Use rollback only after identifying the exact bad deploy or commit.

Alpha-7 reminder: app rollback is separate from database rollback. None of the Alpha-7 deploy readiness steps require SQL, migrations, RLS changes, Storage policy changes, or production data mutation.

## Identify Current State

- Current branch: `git branch --show-current`.
- Current commit: `git rev-parse HEAD`.
- Latest commit summary: `git log -1 --stat`.
- Vercel deployment list or inspect output.
- Current production alias target.

## Identify Last Good State

- Last known good commit hash.
- Last known good Vercel deployment ID.
- What was verified on that deployment.
- Whether the issue is app code, environment, database, or external service.

## Before Rollback

- Confirm the rollback target belongs to the same project.
- Confirm the rollback target used the expected environment variables.
- Confirm no database migration is required for the rollback.
- Confirm no production data change is needed.
- Confirm owner approval if user-visible behavior will change.
- Confirm whether the issue is in app code, environment config, external provider, or Supabase data/policy state.

## Do Not Roll Back Blindly

- Do not roll back database state unless the owner explicitly approves the exact database action.
- Do not run `00099_wash_and_reset.sql`.
- Do not run reset, wash, drop, truncate, or destructive migrations.
- Do not change RLS or Storage policies during app rollback.
- Do not change roles, auth, payroll, GPS, or project access during app rollback.

## App Deploy Rollback

- Prefer Vercel rollback or alias promotion to a known good deployment.
- Keep database untouched unless separately approved.
- After rollback, check production `/` and `/login`.
- Run owner manual QA for the affected workflow.
- Record rollback deployment ID and commit.

## Alpha-7 Rollback Smoke

- Confirm login works for owner/manager/worker.
- Confirm top quick nav does not block sign out or notification bells.
- Confirm realtime task status updates or document if the rollback target predates that fix.
- Confirm messages/history/read status.
- Confirm project files and attachments.
- Confirm Archive and Trash still mean separate things.
- Confirm payroll archive remains visible.
- Confirm Jarvis write actions do not mutate without confirmation.

## After Rollback

- Confirm production URL points to the intended deployment.
- Confirm `git status --short` is clean locally.
- Record what changed and what did not change.
- Create a separate follow-up task for the root cause.
