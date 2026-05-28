# Alpha-7 Production Readiness Report

Date: 2026-05-28

Scope: release hardening, project media organization, safe performance/realtime stabilization, and owner/admin production diagnostics.

## Release Visibility

Added owner/admin diagnostics at `/admin/diagnostics`.

Visible fields:

- App version from `package.json`.
- Commit SHA from Vercel/git build environment when available.
- Short commit SHA.
- Branch/ref when available.
- Build time.
- Deployment environment.
- Vercel deployment URL when available.
- Node environment.

This page is manager-shell protected and additionally restricted to `owner` / `admin`. It does not expose service keys, database URLs, private tokens, PINs, payroll records, or production data.

## Release Audit

Added local read-only command:

```bash
npm run alpha7:release-audit
```

It reports:

- Current branch.
- Local HEAD.
- Dirty/uncommitted files.
- Recent commits.
- Vercel production inspect summary when CLI access is available.
- Local commits not reflected in inspected production when the deployed commit can be detected.

The script does not deploy, write files, run SQL, call Supabase, or print secrets.

## Dangerous-Zone Audit

Continue to run:

```bash
npm run alpha7:danger-zone-diff
npm run check:dangerous
```

Dangerous areas remain manual-review zones:

- `supabase/migrations/**`
- Supabase functions, RLS, Storage policies, and schema files.
- Payroll/salary/paid-period logic.
- Shift, GPS, geofence, clock-in/out logic.
- Archive/trash behavior.
- Role hierarchy and media delete permissions.
- Jarvis mutation permissions and service-role routes.

No SQL, migrations, schema, RLS, Storage, payroll, archive/trash, GPS, shift, material queue, or message/task lifecycle changes are part of this readiness pass.

## Project Media Readiness

Project media now has a clearer library structure:

- `Все`
- `Фото`
- `Видео`
- `Документы / PDF`

Existing upload/open/download/delete permission behavior is preserved through the same attachment list and media viewer surfaces.

## Performance / Realtime Readiness

Safe stabilization added:

- Stable list hydration for worker and manager project task lists to avoid redraw churn when server props contain unchanged rows.
- Stable worker project media hydration.
- Project public notes realtime updates in manager and worker project views.
- Project note updates merge into existing state without broad page refresh.

## Manual QA Required

Before calling Alpha-7 stable for daily use:

- Owner runs `docs/OWNER_MANUAL_QA_CHECKLIST.md`.
- Owner verifies `/admin/diagnostics` after deploy.
- Owner verifies media category tabs on a project with photos, videos, and PDF/doc files.
- Owner verifies live project notes update without leaving the page.
- Owner verifies task/message/material realtime behavior remains stable.
