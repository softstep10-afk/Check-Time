# Grants Hardening Plan Alpha-7

Date: 2026-05-29

Status: owner-approved grants hardening applied.

## Impact Map

Files and areas changed:

- `supabase/migrations/00030_database_grants_hardening.sql`
- `docs/GRANTS_HARDENING_PLAN_ALPHA7.md`
- `docs/SUPABASE_STEP0_RESULTS_ALPHA7.md`

Screens and workflows that could be affected:

- Login shell and public unauthenticated pages.
- Owner, manager, worker, driver authenticated Supabase reads/writes.
- Project media, task attachments, messages, project notes, shifts, payroll, and archive screens.
- Storage signed URL and upload flows.

What must not change:

- Authenticated app behavior stays RLS-controlled.
- Owner/manager/worker/driver workflows keep their existing allowed reads and writes.
- Payroll calculations, shifts, GPS, archive/trash, media delete semantics, task/message/material lifecycles unchanged.
- No production data deletion.

Targeted checks:

- Public smoke.
- Service-role inventory.
- Route mutation map.
- Dangerous-zone diff.
- Lint, typecheck, tests, build, predeploy.
- Manual QA after next deploy for owner/manager/worker/driver core flows.

## Findings

Step 0 found broad grants:

- `anon` had SELECT plus write-like grants across public/storage relations.
- `authenticated` had broad relation grants, including privileges the app does not need directly: `TRUNCATE`, `REFERENCES`, and `TRIGGER`.
- RLS is enabled on the expected critical public tables, which mitigates normal authenticated access.

## Applied Hardening

Migration:

- `supabase/migrations/00030_database_grants_hardening.sql`

Applied model:

- Revoke from `anon` on public/storage relations:
  - `INSERT`
  - `UPDATE`
  - `DELETE`
  - `TRUNCATE`
  - `REFERENCES`
  - `TRIGGER`
- Revoke from `authenticated` on public/storage relations:
  - `TRUNCATE`
  - `REFERENCES`
  - `TRIGGER`

Preserved for `authenticated`:

- `SELECT`
- `INSERT`
- `UPDATE`
- `DELETE`

Reason: the app still uses normal Supabase client flows with RLS for many authenticated actions, including tasks, messages, media rows, project notes, payroll owner screens, project assignment changes, and soft-delete/update flows. Revoking these blindly would risk production breakage.

Managed-role note:

- The SQL Editor session runs as `postgres` and is not a member of
  `supabase_admin` or `supabase_storage_admin`.
- The migration successfully removes unnecessary grants from app-owned public
  tables.
- Supabase-managed/PostGIS reference grants can still appear for
  `geometry_columns`, `geography_columns`, `spatial_ref_sys`, and Storage
  metadata relations because their explicit grantor is managed by Supabase.
- Storage object access is still constrained by the Phase 1 Storage policies
  applied in `00029_storage_policy_hardening_draft.sql`.

## Verification

After apply, verify with:

```sql
select table_schema, grantee, privilege_type, count(*) as grant_count
from information_schema.role_table_grants
where table_schema in ('public', 'storage')
  and grantee in ('anon', 'authenticated')
group by table_schema, grantee, privilege_type
order by table_schema, grantee, privilege_type;
```

Expected:

- App-owned public tables have no `anon` write-like grants.
- App-owned public tables have no `authenticated` `TRUNCATE`, `REFERENCES`, or
  `TRIGGER` grants.
- `authenticated` still has the app-required grants guarded by RLS.

Verified after apply:

- `app_anon_write_remaining = 0`
- `app_authenticated_restricted_remaining = 0`
- Residual managed grants remain only on PostGIS reference relations and
  Supabase Storage metadata relations.

## Rollback

If a production flow unexpectedly fails because of grants:

1. Do not change data.
2. Identify the missing privilege and table from the error.
3. Restore the minimum required grant only for the affected role/table.
4. Re-run targeted manual QA for that flow.

Do not restore broad blanket grants unless owner explicitly approves an emergency rollback.

## Manual QA

After next deploy:

- Owner opens overview, projects, team, payroll, diagnostics.
- Manager opens project, creates task, sends message, uploads media.
- Worker opens Projects, takes/completes task, uploads task/journal media.
- Driver opens/takes material task and uploads material evidence.
- Public `/`, `/login`, and protected `/projects` smoke remains unchanged.

## Recommendation

Grants P1 is closed for the app-owned unnecessary grant surface found in Step 0:

- anonymous write-like grants removed;
- authenticated non-app relation privileges removed;
- authenticated app behavior preserved under RLS.

Remaining managed-grant follow-up:

- Supabase-managed Storage metadata grants and PostGIS reference grants should
  be treated as platform/extension grant surface, not app-table grant surface.
- Do not attempt to force-revoke them without Supabase-supported role access and
  a separate rollback-tested plan.
- Future app grants hardening can reduce authenticated INSERT/UPDATE/DELETE
  table-by-table only after route-by-route and client-flow proof that the
  privilege is unused.
