# Alpha-7 Archive / Trash Audit

Mode: read-only code audit.  
Date: 2026-05-22.  
Production URL: https://check-time-five.vercel.app

## Confirmation

- No application behavior was changed.
- No payroll calculation, payroll archive, project lifecycle, archive/trash behavior, RLS, Storage policy, schema, migration, GPS, shift, or production data changes were made.
- No SQL was run.
- Direct SQL Supabase Step 0 remains blocked, so this report is based on local code and local migration files only.

## Files Inspected

- `src/lib/archive-utils.ts`
- `src/lib/manager-data.ts`
- `src/app/api/manager/projects/[id]/archive/route.ts`
- `src/app/api/manager/projects/[id]/route.ts`
- `src/app/(manager)/archive/page.tsx`
- `src/app/(manager)/archive/projects/[id]/page.tsx`
- `src/app/(manager)/trash/page.tsx`
- `src/app/(manager)/projects/page.tsx`
- `src/app/(manager)/projects/[id]/page.tsx`
- `src/components/manager/ArchivePage.tsx`
- `src/components/manager/ArchiveProjectMediaList.tsx`
- `src/components/manager/ProjectsPage.tsx`
- `src/components/manager/ProjectDetailPage.tsx`
- `src/app/(manager)/payroll/history/page.tsx`
- `tests/lib/archive-utils.test.ts`
- `tests/lib/payroll-period-utils.test.ts`
- `supabase/migrations/00023_archive_foundation.sql`
- `supabase/migrations/00003_schema_gap.sql`

## Archive Routes And UI

Project archive write path:

- `src/app/api/manager/projects/[id]/archive/route.ts`
- The route authenticates through `requireManagerContext`.
- It validates the project id before service-role work.
- It scopes the target project by `profile.org_id`.
- It writes `status: "archived"` and `deleted_at: null`.
- When archive metadata columns exist, it also writes `archived_at` and `archived_by`.
- It revalidates `/archive`, `/projects`, `/tasks`, and affected project paths.

Archive page read path:

- `src/app/(manager)/archive/page.tsx`
- It loads archive data through `getArchivePageData`.
- It builds project archive rows with `buildArchivedProjectRows`.
- It builds payroll archive rows with `buildPaidPayrollArchive` only when the viewer has finance access.

Archived project detail:

- `src/app/(manager)/archive/projects/[id]/page.tsx`
- It only opens a project when `isArchivedProject(project)` is true.
- `isArchivedProject` requires `status === "archived"` and `deleted_at` empty.
- Archived project tasks and media are shown read-only and filtered to non-deleted linked rows.

Confirmed behavior in code:

- Archive is historical project state, not deleted-row recovery.
- Archived project history remains available through `/archive` and `/archive/projects/[id]`.
- Related tasks, media, sessions, and assignments are not deleted by the archive route.

## Trash Routes And UI

Project move-to-trash path:

- `src/app/api/manager/projects/[id]/route.ts` `DELETE`
- The route authenticates through `requireManagerContext`.
- It validates the project id before service-role work.
- It scopes lookup and update by `profile.org_id`.
- It writes `deleted_at` and also sets `status: "archived"`.
- It returns `{ ok: true, softDeleted: true }`.
- It does not hard-delete the project row.

Trash page:

- `src/app/(manager)/trash/page.tsx`
- It lists rows where `deleted_at` is not null from:
  - `projects`
  - `profiles`
  - `tasks`
  - receipt media rows
- Restore sets `deleted_at: null`.
- Permanent delete is blocked for projects in the UI.
- Empty Trash excludes projects and only deletes removable non-project items.

Task and receipt trash behavior:

- `src/components/manager/ProjectDetailPage.tsx`
- Task delete writes `deleted_at` and keeps the row for Trash/audit references.
- Receipt delete writes `deleted_at` on `media`.

Confirmed behavior in code:

- Trash is driven by `deleted_at`, not by project archive status alone.
- Project hard delete through normal UI is blocked.
- Non-project trash items can be permanently deleted from the Trash page.

## Archive / Trash Separation

The local code keeps Archive and Trash separate by using two different signals:

- Archive: `projects.status === "archived"` and `projects.deleted_at` is null.
- Trash: `deleted_at` is not null.

Important helpers:

- `isArchivedProject(project)` returns true only for archived, non-deleted projects.
- `isActiveProjectForOperations(project)` excludes deleted projects and archived projects.
- `buildArchivedProjectRows` ignores deleted projects, deleted tasks, and deleted media.
- `getActiveOperationalProjects`, `getActiveOperationalTasks`, and `getActiveOperationalMedia` keep archived project data out of active operational views.

Tests already cover the key separation:

- `tests/lib/archive-utils.test.ts` asserts archived project tasks/media are removed from active operations but preserved in archive rows.
- It asserts `deleted_at` rows are Trash, not Archive.
- It asserts deleted tasks/media are not counted as archived project history.

## Project Close Behavior

No separate project "close" route was found in this audit.

The project lifecycle paths found are:

- active project edit/update through `PATCH /api/manager/projects/[id]`.
- archive through `POST` or `PATCH /api/manager/projects/[id]/archive`.
- soft-delete/trash through `DELETE /api/manager/projects/[id]`.
- archived project detail redirect from `/projects/[id]` to `/archive/projects/[id]` when status is archived.

The `projects.status` type still includes `completed`, but the current archive UI is specifically keyed to `status: "archived"`.

## Payroll Archive References

Payroll archive is still separate from Trash:

- `buildPaidPayrollArchive` builds paid payroll history from paid pay period items and closed payroll ledger rows.
- Paid pay period sources:
  - `pay_periods.status === "paid"` or `paid_at` exists.
  - `pay_period_items.status === "paid"` or parent period is paid.
- Closed ledger sources:
  - `payroll_runs.status` is `paid`, `confirmed`, or `exported`.
  - `payroll_line_items` provide paid worker/project splits.
- The Archive page shows payroll archive only when `hasFinanceAccess` passes.
- `/payroll/history` also requires finance access and shows paid/ledger history separately from Trash.

No code path inspected for Trash changes payroll runs, pay periods, pay period items, payroll closures, or payroll line items.

## Suspicious Coupling / Unknowns

1. Project Trash restore may restore to Archive, not active Projects.
   - The project soft-delete route writes both `deleted_at` and `status: "archived"`.
   - The Trash restore handler only clears `deleted_at`.
   - Result from code: restoring a trashed project can make it an archived project, not an active project.
   - This may be intentional recovery safety, but owner confirmation is needed before changing it.

2. Project delete UI copy still uses permanent/delete wording in places.
   - The API soft-deletes projects and normal UI blocks project hard delete.
   - Some UI text names the action as permanent/delete while the route returns `softDeleted: true`.
   - Copy changes are user-facing and should be owner-approved if adjusted.

3. Direct production database state is unverified.
   - Local migration `00023_archive_foundation.sql` states Archive is historical read-only project state and Trash remains `deleted_at`.
   - Direct SQL Step 0 is still blocked, so applied production migration state is unknown.

## Findings

Confirmed:

- Archive and Trash are not replaced by each other in local code.
- Archive excludes rows with `deleted_at`.
- Trash is based on `deleted_at`.
- Project archive route does not delete related tasks/media/sessions.
- Project normal delete route is a soft-delete path.
- Trash UI protects projects from permanent delete.
- Payroll archive/history is still separate from Trash and remains finance-gated.

Not confirmed:

- Actual production RLS and applied migration state.
- Whether production has `projects.archived_at` and `projects.archived_by`; code has fallback behavior if those columns are missing.
- Owner-intended destination after restoring a trashed project.

## Fixes Requiring Owner Approval

- Decide whether restoring a trashed project should return it to active Projects, remain in Archive, or ask the user to choose.
- Clarify project delete/archive UI wording if the owner wants different labels.
- Direct SQL Step 0 to verify production archive/trash schema and policies.
- Any payroll archive behavior changes.
- Any hard-delete policy changes.

## Manual QA Recommendations

- Archive an active project and confirm it appears in Archive, not Trash.
- Open the archived project and confirm tasks, media, workers, and sessions remain visible as history.
- Move a project to Trash and confirm it appears in Trash.
- Restore a trashed project and confirm whether it returns to Archive or active Projects; owner should decide if that behavior is correct.
- Confirm project hard delete remains unavailable from normal UI.
- Confirm old paid payroll periods remain visible in Archive/Payroll history for finance users.
- Confirm non-finance managers do not see payroll amounts in Archive.

## Conclusion

Local code currently preserves the owner distinction:

- Archive is for historical/closed project and paid payroll history.
- Trash is for deleted/restorable records.

No evidence was found that Trash replaced Archive in the current local code. The only owner-decision item is the exact behavior after restoring a trashed project whose status was also set to `archived`.
