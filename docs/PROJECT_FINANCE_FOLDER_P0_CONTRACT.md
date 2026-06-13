# Project Finance Folder P0 Contract

Status: CONTRACT PREPARED, IMPLEMENTATION NOT STARTED

Production baseline:
- URL: https://check-time-five.vercel.app
- Deploy: dpl_79ucDxQb79GAs2bYUhVYeUYo7LUZ
- Commit: 25f336d1ca61f6e058aebd2e4dadfe247a4182ab
- Branch baseline for this doc: fix/postdeploy-qa-audit-patches at 93097ed65c093734068c87eac6e5ba30a831770d

This is an implementation contract only. It does not create SQL, migrations, RLS, storage policies, API routes, UI, estimates, invoices, client portal, or AI behavior.

## Scope

Build, in future batches, a restricted internal finance folder inside each project for:

- Estimates
- Invoices
- Change Orders
- Extras / Extra Work
- PDFs / Other

This folder is internal only. It is not the Client Portal and it is not accounting logic.

## Explicit Non-Scope

- No estimates/invoices accounting engine.
- No client portal.
- No client-visible publishing.
- No payroll changes.
- No GPS or clock-in/out changes.
- No auth redesign.
- No storage policy changes in P0.
- No AI action layer.
- No hardcoded named users.
- No broad manager access.
- No broad `finance_access` reuse as the primary access model.

## Source Inventory

Exact files inspected and the pattern they establish:

| Area | File | Purpose |
| --- | --- | --- |
| Project detail route | `src/app/(manager)/projects/[id]/page.tsx` | Server route fetches project detail data, checks `hasFinanceAccess`, queries `project_clients`, and renders `ProjectDetailPage`. |
| Project detail UI | `src/components/manager/ProjectDetailPage.tsx` | Main project detail surface; contains project client card, project media uploads, receipt handling, planning sections, and signed URL usage. |
| Current planning/doc surface | `src/components/manager/ProjectPlanningSections.tsx` | Existing project planning/materials/estimate-like UI stored in `projects.settings`; useful UI reference, not the target security model. |
| Planning settings model | `src/lib/project-planning.ts` | JSON settings helpers for material spec and project estimations; useful parser tests, not suitable as restricted finance-folder source of truth. |
| Planning attachment upload | `src/lib/project-planning-attachments.ts` | Uploads planning attachments to the `media` bucket and inserts `media` rows; useful validation/path reference, not sufficient for restricted folder access. |
| Planning save API | `src/app/api/manager/projects/[id]/planning/route.ts` | Uses `requireManagerContext`, `hasFinanceAccess`, admin client, org/project guard, and project settings update. |
| Media drawer | `src/components/shared/MediaGalleryDrawer.tsx` | Filterable media drawer, signed thumbnails, signed viewer URLs, and download signed URLs. |
| Media modal | `src/components/shared/MediaViewerModal.tsx` | Full-screen media viewer pattern for photo/video/PDF/document with signed URLs. |
| Project media library | `src/components/shared/ProjectMediaLibrary.tsx` | Tab/category pattern for project media. |
| Media categorization | `src/lib/media-gallery.ts` | Pure helpers for media categorization, filters, pagination, and worker visibility. |
| Project media categories | `src/lib/project-media-library.ts` | Pure helper for photo/video/document category tabs. |
| Upload validation | `src/lib/upload-limits.ts` | Central MIME and size validation for photo/video/PDF/document uploads. |
| Storage path normalization | `src/lib/task-attachments.ts` | Upload helper plus `normalizeStoragePath` and `getSignableStoragePath` guards before signing. |
| Media delete API | `src/app/api/media/[id]/route.ts` | Mutating route pattern with UUID validation, auth/profile lookup, elevated admin client, and soft delete. |
| File attachment guard | `src/lib/server/file-attachment-guard.ts` | Server-side org/project/media target validation before linking attachments. |
| UUID guards | `src/lib/server/id-guards.ts` | Shared UUID validation helpers for server routes. |
| Clients list UI | `src/components/manager/ClientsPage.tsx` | Alpha-8 client list/card/search/create pattern. |
| Client detail UI | `src/components/manager/ClientDetailPage.tsx` | Tab pattern and client Projects tab; useful for future category tabs. |
| Client data server helpers | `src/lib/clients-data.ts` | Server data helper using `requireManagerContext`, org-scoped queries, and audit feed reads. |
| Project-client link helpers | `src/lib/client-project-links.ts` | Pure builder helpers for project/client summaries and link options. |
| Project-client API | `src/app/api/manager/projects/[id]/client/route.ts` | API route pattern: UUID validation, manager context, admin client, org/project/client checks, soft-unlink, audit, revalidate. |
| Audit helper | `src/lib/audit-server.ts` | Best-effort server audit insert into `audit_log`. |
| Client audit helper | `src/lib/audit.ts` | Client-side audit helper; future finance folder should prefer server audit for sensitive mutations. |
| Capabilities | `src/lib/capabilities.ts` | Existing global capability registry including `finance_access`. |
| Finance access helper | `src/lib/finance-access.ts` | Existing owner/admin or global `finance_access` capability. Too broad for per-project finance folder grants. |
| Role helpers | `src/lib/roles.ts` | Role hierarchy and owner/admin helper functions. |
| Team role permissions | `src/lib/role-permissions.ts` | Owner/admin restrictions for sensitive team role changes. |
| Manager context/route guard | `src/lib/manager-data.ts` | `requireManagerContext` redirects unauthenticated users and non-manager roles; future finance APIs need narrower checks on top. |
| Manager layout | `src/app/(manager)/layout.tsx` | Sidebar/mobile route visibility and realtime table refresh patterns. |
| Permission action | `src/app/(manager)/admin/users/[id]/permissions/actions.ts` | Existing capability toggle checks and `capability_changed` audit event. |
| API team update | `src/app/api/team/update-profile/route.ts` | Same-org elevated mutation pattern with role/finance checks. |
| DB types | `src/types/database.ts` | Current `UserRole`, `Project`, `Media`, `BusinessClient`, and `ProjectClient` type shapes. |
| Phase 1B migration | `supabase/migrations/00033_alpha8_client_project_link.sql` | Additive table, org_id, status, no DELETE policy, owner/admin/manager RLS style. |
| Finance access migration | `supabase/migrations/00022_finance_access.sql` | Shows why `finance_access` is broad: payroll, pay periods, receipts, and media receipt visibility. |
| Storage draft | `supabase/migrations/00029_storage_policy_hardening_draft.sql` | Private media bucket hardening draft; useful rationale but not to be changed in this block. |
| Client-project tests | `tests/lib/alpha8-client-project-link.test.ts` | Source-grounded test style for migrations, UI surfaces, APIs, forbidden tokens, and docs map. |
| Media signing tests | `tests/lib/media-signing-guards.test.ts` | Source tests for malformed storage paths and signed URL guard behavior. |
| Project planning tests | `tests/lib/project-planning.test.ts` | Pure helper tests for project planning JSON settings; useful for legacy contrast. |
| Project media tests | `tests/lib/project-media-library.test.ts` | Pure helper tests for category tabs and document classification. |
| Route guard scanner | `scripts/alpha7-route-mutation-guard-map.mjs` | Static source guard pattern for mutating/elevated routes. |
| Auth route guard tests | `tests/lib/auth-route-guards.test.ts` | Production protected-route redirect/source guard pattern. |
| Finance visibility tests | `tests/lib/finance-visibility.test.ts` | Existing finance visibility checks for summaries and AI snapshot. |
| Team finance source tests | `tests/lib/team-roster-finance-columns-source.test.ts` | Source guard style for keeping finance controls out of broad team roster. |
| i18n | `src/lib/i18n/translations.ts` | Translation key style for project detail, clients, uploads, messages, and existing projectEstimates copy. |
| Living map | `docs/Карта проекта.md` | Project status, queue, safe build order, migration history rule. |
| Constitution | `docs/ARCHITECTURE_CONSTITUTION.md` | L0 rules: grants for sensitive folders, server checks plus RLS, private storage plus signed URLs. |
| Build recipe | `docs/BLOCK_BUILD_RECIPE.md` | Required 8-step build recipe and STOP conditions. |
| DB-0 Gate | `docs/DB_0_GATE.md` | Mandatory pre-migration verification and no `supabase db push` rule. |

## Existing Patterns To Reuse

Private file storage:
- Existing app uploads private business files to the `media` bucket through Supabase Storage in `src/lib/task-attachments.ts`, `src/lib/project-planning-attachments.ts`, and `src/components/manager/ProjectDetailPage.tsx`.
- Reuse the private-storage posture and no-public-URL rule.
- Do not reuse the `media` bucket for Project Finance Folder because existing media RLS intentionally allows operational project media to manager/supervisor/project-assigned users.

Signed URLs:
- `src/components/shared/MediaGalleryDrawer.tsx` uses 600s thumbnail URLs and 3600s viewer/download URLs.
- `src/components/shared/MediaViewerModal.tsx` uses signed URLs for inline viewer and download.
- `src/lib/task-attachments.ts` has `normalizeStoragePath` and `getSignableStoragePath` to prevent malformed signing.
- Reuse this pattern, but issue finance signed URLs only through server routes after finance-folder access checks.

Upload validation:
- `src/lib/upload-limits.ts` is the current single source for file size and MIME validation.
- Reuse the validation shape, but define finance-folder-specific allowed types and max sizes in the future helper.

Project section/card pattern:
- `src/components/manager/ProjectDetailPage.tsx` and `src/components/manager/ProjectPlanningSections.tsx` use collapsible project sections.
- Reuse the section layout, but the future folder should be hidden entirely for no-access roles.

Tabs/category pattern:
- `src/components/manager/ClientDetailPage.tsx` uses tabs.
- `src/components/shared/ProjectMediaLibrary.tsx` uses media category tabs.
- Reuse category tabs for Estimates, Invoices, Change Orders, Extras, PDFs / Other.

Manager route guard:
- `src/lib/manager-data.ts` `requireManagerContext` is the entry gate for manager app pages/routes.
- Reuse it as a first gate only. It is not enough for finance folder access.

Finance access capability:
- `src/lib/finance-access.ts` and `supabase/migrations/00022_finance_access.sql` define broad org-wide finance access.
- Do not use it as the primary finance-folder authorization. It is too broad and covers payroll/receipts/pay-periods.

Audit log:
- `src/lib/audit-server.ts` writes `audit_log` server-side.
- `src/app/api/manager/projects/[id]/client/route.ts` shows before/after audit usage for sensitive project-client changes.
- Reuse server audit events for finance folder grants and file mutations.

Soft delete / no hard delete:
- `project_clients` uses `status` active/inactive and no DELETE policy in `supabase/migrations/00033_alpha8_client_project_link.sql`.
- Media delete is soft via app route.
- Reuse `status = active/archived` and no DELETE policy for finance files.

i18n:
- `src/lib/i18n/translations.ts` centralizes user text.
- Future UI must add translation keys rather than inline user-visible strings.

Source guard tests:
- `tests/lib/alpha8-client-project-link.test.ts`, `tests/lib/media-signing-guards.test.ts`, and `scripts/alpha7-route-mutation-guard-map.mjs` show the local source-test style.
- Future batches should add source guards for no broad manager access, no client access, no DELETE route/policy, no public URLs, and no use of `finance_access` as the folder gate.

## Access Model Decision

Option A: reuse `finance_access`

Pros:
- Existing helper and capability UI exist.
- Owner/admin bypass already works.

Cons:
- Too broad: current `finance_access` opens payroll, pay periods, receipts, project totals, and AI financial context.
- It is org-wide, not per-project.
- It cannot express "manager A can see project X only".

Assessment: reject as primary model.

Option B: global capability `project_finance_files_access`

Pros:
- Simple capability toggle.
- Easier than per-project grants.

Cons:
- Still org-wide.
- Violates owner requirement for specific manager/sales manual access.
- Does not scale to per-project finance folder privacy.

Assessment: reject for P0.

Option C: per-project grants in `project_finance_access_grants`

Pros:
- Matches owner requirement exactly.
- Grants are scoped by `org_id`, `project_id`, and `profile_id`.
- Can support different permissions per project.
- Server checks and RLS can enforce the same rule.
- Easy to audit grant/revoke.

Cons:
- Requires new table and helper functions.
- Requires owner/admin grant UI.
- Requires role matrix tests.

Assessment: recommended P0 model.

Option D: hybrid global admin capability plus per-project grants

Pros:
- Could support future accounting/bookkeeper global role/capability.

Cons:
- Too early; risks recreating broad access before the folder is proven.
- Adds another bypass path that must be audited.

Assessment: defer. Owner/admin role bypass plus per-project grants is enough for MVP.

Recommendation:
- Use `project_finance_access_grants`.
- Owner/admin always full access.
- Manager and sales users require an active per-project grant.
- Future accounting/bookkeeper can be added later as either a role or grant-eligible profile type after a separate access decision.
- Workers, supervisors, drivers, subcontractors, and clients are denied.
- UI hiding is cosmetic only. Server APIs and RLS are authoritative.

## Access Rules

Owner/Admin:
- Full view/upload/download/replace/archive/manage-access on every project in their org.

Granted manager:
- Access only to project rows where an active grant exists for that profile.
- Permissions come from grant booleans.

Granted sales:
- Same as granted manager.
- No broad sales access.

Future accounting/bookkeeper:
- Not implemented in P0.
- May become grant-eligible later after role/access design.

Denied always:
- worker
- supervisor
- driver
- subcontractor
- client / client portal user
- anonymous user
- cross-org user
- inactive/deleted profile

## Data Contract

Future SQL must pass DB-0 Gate first. This is design only, not executable SQL.

### A. `project_finance_access_grants`

Purpose:
- Stores explicit per-project access for selected manager/sales profiles.
- Separates sensitive finance-folder access from broad roles and global finance capabilities.

Fields:

| Column | Type | Null | Purpose |
| --- | --- | --- | --- |
| `id` | uuid primary key default uuid_generate_v4() | no | Stable grant id. |
| `org_id` | uuid references `organizations(id)` | no | Org isolation. |
| `project_id` | uuid references `projects(id)` | no | Project scope. |
| `profile_id` | uuid references `profiles(id)` | no | Granted user. |
| `access_level` | text default `custom` | no | Human-readable grant preset: `viewer`, `editor`, `manager`, `custom`. |
| `can_view` | boolean default true | no | Allows list and metadata read. |
| `can_upload` | boolean default false | no | Allows new file upload. |
| `can_download` | boolean default true | no | Allows signed download URL. |
| `can_replace` | boolean default false | no | Allows new version upload. |
| `can_archive` | boolean default false | no | Allows archiving file rows. |
| `can_manage_access` | boolean default false | no | Future permission to manage grants; P0 should reserve it for owner/admin only. |
| `status` | text default `active` | no | `active` or `revoked`. |
| `note` | text | yes | Owner/admin reason or context. |
| `granted_by` | uuid references `profiles(id)` | no | Audit-linked actor. |
| `granted_at` | timestamptz default now() | no | Grant time. |
| `revoked_by` | uuid references `profiles(id)` | yes | Revoking actor. |
| `revoked_at` | timestamptz | yes | Revocation time. |
| `created_at` | timestamptz default now() | no | Standard timestamp. |
| `updated_at` | timestamptz default now() | no | Standard timestamp. |

Constraints:
- `status in ('active', 'revoked')`.
- `access_level in ('viewer', 'editor', 'manager', 'custom')`.
- Partial unique index: one active grant per `(project_id, profile_id)`.
- Permission implication check: `can_upload`, `can_download`, `can_replace`, `can_archive`, and `can_manage_access` require `can_view = true`.
- Grant target must be same org as project and actor.
- Grant target role must be `manager` or `sales` in P0. Future accounting/bookkeeper is separate.

Indexes:
- `(org_id, project_id, status)`.
- `(org_id, profile_id, status)`.
- unique `(project_id, profile_id) where status = 'active'`.
- `(granted_by, granted_at desc)`.

RLS model:
- SELECT: owner/admin in same org, active granted profile for own grants, or future can_manage_access holder.
- INSERT: owner/admin in same org only for P0.
- UPDATE: owner/admin in same org only for P0; revoke through status update.
- DELETE: no policy.

Audit events:
- `project_finance_access_granted`
- `project_finance_access_revoked`

### B. `project_finance_files`

Purpose:
- Stores the current finance-folder file record for a project.
- Owns the active metadata and pointer to current storage path/version.

Fields:

| Column | Type | Null | Purpose |
| --- | --- | --- | --- |
| `id` | uuid primary key default uuid_generate_v4() | no | Stable file id. |
| `org_id` | uuid references `organizations(id)` | no | Org isolation. |
| `project_id` | uuid references `projects(id)` | no | Project scope. |
| `category` | text | no | `estimate`, `invoice`, `change_order`, `extra`, `pdf`, `other`. |
| `storage_path` | text | no | Current version object path in private finance bucket. |
| `filename` | text | no | Display/download filename. |
| `mime_type` | text | no | Validated MIME. |
| `file_size` | bigint | no | Size in bytes. |
| `uploaded_by` | uuid references `profiles(id)` | no | Initial uploader. |
| `current_version` | integer default 1 | no | Current version number. |
| `status` | text default `active` | no | `active` or `archived`. |
| `note` | text | yes | Internal note. |
| `archived_by` | uuid references `profiles(id)` | yes | Archive actor. |
| `archived_at` | timestamptz | yes | Archive timestamp. |
| `created_at` | timestamptz default now() | no | Standard timestamp. |
| `updated_at` | timestamptz default now() | no | Standard timestamp. |

Constraints:
- `category in ('estimate', 'invoice', 'change_order', 'extra', 'pdf', 'other')`.
- `status in ('active', 'archived')`.
- `file_size > 0`.
- `current_version >= 1`.
- `storage_path` unique.

Indexes:
- `(org_id, project_id, category, status, updated_at desc)`.
- `(org_id, project_id, status)`.
- `(uploaded_by, created_at desc)`.
- unique `(storage_path)`.

RLS model:
- SELECT: owner/admin or active grant with `can_view`.
- INSERT: owner/admin or active grant with `can_upload`.
- UPDATE: owner/admin or active grant with the relevant permission:
  - metadata update: `can_upload` or `can_replace`
  - archive: `can_archive`
  - replace current pointer: `can_replace`
- DELETE: no policy.

Audit events:
- `project_finance_file_uploaded`
- `project_finance_file_metadata_updated`
- `project_finance_file_archived`
- `project_finance_file_replaced`

### C. `project_finance_file_versions`

Purpose:
- Preserves immutable file history.
- Prevents overwrite from destroying prior versions.

Fields:

| Column | Type | Null | Purpose |
| --- | --- | --- | --- |
| `id` | uuid primary key default uuid_generate_v4() | no | Stable version id. |
| `org_id` | uuid references `organizations(id)` | no | Org isolation. |
| `finance_file_id` | uuid references `project_finance_files(id)` | no | Parent finance file. |
| `storage_path` | text | no | Version object path in private finance bucket. |
| `filename` | text | no | Filename for this version. |
| `mime_type` | text | no | MIME for this version. |
| `file_size` | bigint | no | Size in bytes. |
| `version_number` | integer | no | 1, 2, 3, ... |
| `uploaded_by` | uuid references `profiles(id)` | no | Version uploader. |
| `note` | text | yes | Version note. |
| `created_at` | timestamptz default now() | no | Version timestamp. |

Constraints:
- unique `(finance_file_id, version_number)`.
- unique `(storage_path)`.
- `version_number >= 1`.
- `file_size > 0`.
- `org_id` must match parent file org.

Indexes:
- `(org_id, finance_file_id, version_number desc)`.
- `(uploaded_by, created_at desc)`.

RLS model:
- SELECT: same as parent file view.
- INSERT: owner/admin or active grant with `can_upload` for version 1 or `can_replace` for version > 1.
- UPDATE: no policy for P0 unless metadata correction is explicitly required.
- DELETE: no policy.

Audit events:
- initial version covered by `project_finance_file_uploaded`
- replacement version covered by `project_finance_file_replaced`

## Storage Model

Storage options:

| Option | Assessment |
| --- | --- |
| Reuse `media` bucket | Reject. Current media RLS intentionally supports project evidence, supervisor/manager visibility, project assignment visibility, receipts, and legacy message attachments. Finance folder needs narrower access. |
| New private bucket `project-finance-files` | Recommend. Clear boundary, private by default, finance-specific signed URLs, easier testing and future storage policies. |
| Existing project planning/documents logic | Reject as primary model. It stores document metadata in `projects.settings` and files in `media`; it is not per-project grant-enforced. |

Recommendation:
- Create a new private bucket later: `project-finance-files`.
- Do not use public URLs.
- Do not change storage policies in P0 documentation.
- Future SQL/storage work must go through DB-0 Gate and owner approval.

Path format:

```text
{org_id}/{project_id}/{category}/{finance_file_id}/v{version_number}/{timestamp}-{safe_filename}
```

Example:

```text
org-uuid/project-uuid/estimate/file-uuid/v1/1781240000000-kitchen-estimate.pdf
```

Version path format:

```text
{org_id}/{project_id}/{category}/{finance_file_id}/v2/{timestamp}-{safe_filename}
```

Signed URL TTL:
- Inline view URL: 900 seconds.
- Download URL: 300 seconds and uses download filename/content disposition.
- If future thumbnails are added, thumbnail URL max 300 seconds.

Allowed MIME types for P0:
- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/webp`
- `application/msword`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- `application/vnd.ms-excel`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `text/csv`
- `application/csv`
- `text/plain`
- `text/tab-separated-values`

Forbidden types:
- executables
- shell/batch scripts
- archives unless separately approved
- HTML/SVG as active document formats
- video by default unless owner separately approves

Max file size recommendation:
- PDF: 50 MB.
- Image: 20 MB.
- Office/CSV/TXT documents: 100 MB.
- Absolute per-file ceiling: 100 MB for P0.

Viewer behavior:
- PDF: iframe full-screen viewer.
- Image: image full-screen viewer.
- Word/Excel/CSV/TXT/unsupported safe document: download/open only; no in-app parser in P0.
- If preview fails, show download fallback.

Download behavior:
- API checks access.
- API creates a short-lived signed URL.
- Browser downloads from signed URL.
- Do not expose raw bucket paths as public links.

## API Contract

All routes are future design. They do not exist yet.

Shared server checks for every route:
- Authenticate user.
- Load profile.
- Require same `org_id`.
- Validate UUIDs with `readRequiredUuid`.
- Confirm project exists, same org, not deleted.
- Apply finance folder access helper:
  - owner/admin bypass
  - active per-project grant with required permission
  - deny worker/supervisor/driver/subcontractor/client
- Never trust UI-hidden state.

### List files

- Method/path: `GET /api/manager/projects/[id]/finance-folder/files`
- Query: `category?`, `status?=active|archived`, pagination cursor later.
- Input validation: category/status allowlists.
- Output DTO:
  - `files: FinanceFileListItem[]`
  - includes id, category, filename, mime_type, file_size, current_version, status, note, uploaded_by display name, created_at, updated_at.
- Access check: `can_view`.
- Mutation: read-only.
- Audit: none in P0.
- Tests: owner/admin sees; granted viewer sees; ungranted manager denied; denied roles denied; cross-org denied.

### Upload file

- Method/path: `POST /api/manager/projects/[id]/finance-folder/files`
- Body: multipart/form-data with file, category, note.
- Output DTO: created file row and version row.
- Validation: UUID, category, MIME, size, safe filename, no public URL, storage path prefix.
- Access check: `can_upload`.
- Mutation: storage upload, insert file, insert version.
- Audit: `project_finance_file_uploaded`.
- Tests: upload permission matrix; rejects unsupported MIME; rejects oversized file; creates version 1; no overwrite.

### Get signed view URL

- Method/path: `POST /api/manager/projects/[id]/finance-folder/files/[fileId]/view-url`
- Body: optional `versionNumber`; default current.
- Output DTO: `{ url, expiresIn, filename, mimeType, disposition: "inline" }`.
- Validation: file/project/org match; active file unless owner/admin requests archived view later.
- Access check: `can_view`.
- Mutation: read-only signed URL creation.
- Audit: optional later `project_finance_file_viewed`, not P0.
- Tests: signed URL denied after revoke; archived behavior; malformed path rejected.

### Download file

- Method/path: `POST /api/manager/projects/[id]/finance-folder/files/[fileId]/download-url`
- Body: optional `versionNumber`; default current.
- Output DTO: `{ url, expiresIn, filename, mimeType, disposition: "attachment" }`.
- Access check: `can_download`.
- Mutation: read-only signed URL creation.
- Audit: optional later `project_finance_file_downloaded`, not P0.
- Tests: download permission separate from view; revoked grant denied; no public URL.

### Replace / new version

- Method/path: `POST /api/manager/projects/[id]/finance-folder/files/[fileId]/versions`
- Body: multipart/form-data with file, note.
- Output DTO: updated file row and inserted version row.
- Validation: same project/org, MIME, size, safe filename, next version number.
- Access check: `can_replace`.
- Mutation: storage upload, insert version, update parent `storage_path`, `filename`, `mime_type`, `file_size`, `current_version`, `updated_at`.
- Audit: `project_finance_file_replaced`.
- Tests: preserves old version; increments current_version; no storage overwrite; denied roles denied.

### Update metadata

- Method/path: `PATCH /api/manager/projects/[id]/finance-folder/files/[fileId]`
- Body: `category?`, `filename?`, `note?`.
- Output DTO: updated file row.
- Validation: category allowlist, filename length/safe display, note length.
- Access check: owner/admin or active grant with `can_upload`/`can_replace` depending future decision; P0 should require `can_replace` for category/filename changes.
- Mutation: DB update only.
- Audit: `project_finance_file_metadata_updated`.
- Tests: before/after audit, category validation, cross-project denied.

### Archive file

- Method/path: `PATCH /api/manager/projects/[id]/finance-folder/files/[fileId]/archive`
- Body: optional note/reason.
- Output DTO: archived file row.
- Validation: active file only.
- Access check: `can_archive`.
- Mutation: update `status = archived`, `archived_by`, `archived_at`, `updated_at`.
- Audit: `project_finance_file_archived`.
- Tests: no DELETE route; archived not listed by default; archived signed URL denied to non-owner unless explicitly allowed.

### List access grants

- Method/path: `GET /api/manager/projects/[id]/finance-folder/grants`
- Output DTO: active and revoked grants with profile name/role and permissions.
- Access check: owner/admin in P0; future `can_manage_access`.
- Mutation: read-only.
- Audit: none.
- Tests: owner/admin only; granted viewer cannot list all grants unless future decision changes.

### Grant access

- Method/path: `POST /api/manager/projects/[id]/finance-folder/grants`
- Body: profileId, accessLevel, permission booleans, note.
- Output DTO: grant row.
- Validation: target profile same org, active, role in manager/sales, not worker/supervisor/driver/subcontractor/client, one active grant per project/profile.
- Access check: owner/admin in P0.
- Mutation: insert grant or reactivate through explicit revoke/new grant decision.
- Audit: `project_finance_access_granted`.
- Tests: cannot grant denied roles; cannot self-escalate; duplicate active grant rejected.

### Revoke access

- Method/path: `PATCH /api/manager/projects/[id]/finance-folder/grants/[grantId]/revoke`
- Body: optional reason.
- Output DTO: revoked grant row.
- Validation: grant/project/org match and active status.
- Access check: owner/admin in P0.
- Mutation: update `status = revoked`, `revoked_by`, `revoked_at`, `updated_at`.
- Audit: `project_finance_access_revoked`.
- Tests: revoked grant immediately denied by API and RLS; no DELETE route.

## RLS Design Pseudocode

This is not executable SQL.

Helper concept:

```text
current_profile:
  select id, org_id, role from profiles where id = auth.uid()

is_owner_admin_for_org(target_org_id):
  current_profile.org_id = target_org_id
  and current_profile.role in ('owner', 'admin')

has_active_project_finance_grant(target_org_id, target_project_id, permission):
  current_profile.org_id = target_org_id
  and current_profile.role in ('manager', 'sales')
  and exists active grant
    where grant.org_id = target_org_id
      and grant.project_id = target_project_id
      and grant.profile_id = auth.uid()
      and grant.status = 'active'
      and grant.permission boolean is true

denied_roles:
  role in ('worker', 'supervisor', 'driver', 'subcontractor')
  or future external client identity
```

`project_finance_access_grants`:

```text
SELECT:
  same org
  and (
    owner/admin
    or profile_id = auth.uid() and status = 'active'
    or future active grant with can_manage_access
  )

INSERT:
  same org
  and owner/admin
  and target profile same org
  and target role in ('manager', 'sales')

UPDATE:
  same org
  and owner/admin
  and update stays same org/project/profile
  and status transition is active -> revoked or permission update by owner/admin

DELETE:
  no policy
```

`project_finance_files`:

```text
SELECT:
  same org
  and (
    owner/admin
    or active grant for project_id with can_view
  )
  and denied roles excluded

INSERT:
  same org
  and project exists in same org
  and (
    owner/admin
    or active grant for project_id with can_upload
  )
  and denied roles excluded

UPDATE:
  same org
  and project_id cannot change
  and (
    owner/admin
    or active grant for project_id with required permission:
       can_replace for replacement/current pointer
       can_archive for archive
       can_replace for metadata in P0
  )
  and denied roles excluded

DELETE:
  no policy
```

`project_finance_file_versions`:

```text
SELECT:
  same org
  and parent file is visible through owner/admin or active grant with can_view

INSERT:
  same org
  and parent file belongs to same org/project
  and (
    owner/admin
    or active grant for parent project with can_upload for version 1
    or active grant for parent project with can_replace for version > 1
  )

UPDATE:
  no policy in P0

DELETE:
  no policy
```

## UI Contract

Placement:
- Project Detail only.
- Section/tab label: `Финансовая папка`.
- Do not put this on Owner Overview.
- Do not expose it in Client Portal.

Visibility:
- Visible to owner/admin.
- Visible to granted manager/sales only if active grant exists.
- Hidden entirely for roles without access.
- Hidden UI is not security; API and RLS remain required.

Categories:
- Estimates
- Invoices
- Change Orders
- Extras
- PDFs / Other

Empty state:
- Owner/admin: "No finance files yet" plus upload and manage access actions.
- Granted user with upload: empty list plus upload action.
- Granted view-only user: empty list only.
- No-access user: no section rendered.

File card:
- filename
- category badge
- current version
- status
- file size
- uploaded by
- updated at
- note preview
- actions based on permissions: view, download, replace, edit metadata, archive

Upload:
- Category selector required.
- File input restricted to allowed MIME/extensions.
- Note optional.
- Server validates all fields again.

Full-screen viewer:
- Reuse modal ergonomics from `MediaViewerModal`.
- PDF/image inline if browser supports it.
- Unsupported safe documents use download/open fallback.

Download:
- Calls server endpoint for short-lived signed download URL.
- No direct bucket path exposed as public URL.

Replace version:
- Uploads new storage object.
- Inserts new version row.
- Updates parent current pointer.
- Keeps old version.

Metadata/notes:
- Edit filename display, category, and note only.
- Does not mutate storage object.

Archive:
- Soft archive only.
- No hard delete.
- Archived files hidden by default and available only behind explicit archived filter for authorized users.

Access grant UI:
- Owner/admin only in P0.
- Project-scoped grant management inside the finance folder section.
- Candidate list includes active same-org manager/sales profiles only.
- Workers/supervisors/drivers/subcontractors/clients never appear.

## Audit Model

Required audit events:

| Event | Target | Before data | After data |
| --- | --- | --- | --- |
| `project_finance_access_granted` | profile or project | null or prior revoked grant | project_id, profile_id, permissions, granted_by |
| `project_finance_access_revoked` | profile or project | active grant permissions | revoked status, revoked_by, revoked_at |
| `project_finance_file_uploaded` | finance_file | null | file metadata, version 1 |
| `project_finance_file_replaced` | finance_file | prior current version/path | new current version/path |
| `project_finance_file_metadata_updated` | finance_file | previous category/name/note | new category/name/note |
| `project_finance_file_archived` | finance_file | active status | archived status, archived_by, archived_at |

Optional later:
- `project_finance_file_viewed`
- `project_finance_file_downloaded`

Audit principles:
- Write from server routes with `logAuditServer`.
- Include `org_id`, actor id/name/role, project id/name when available, target id, before/after data.
- Audit failure should not expose secrets, but sensitive mutations should still be observable through route logs and tests.

## Threat Model

| Threat | Severity | Prevention | Test |
| --- | --- | --- | --- |
| Ungranted manager sees files | High | RLS active grant check plus server helper; no broad manager policy. | Role matrix API/RLS source tests for manager without grant. |
| Worker sees finance tab | High | UI hidden and `requireManagerContext` redirects worker; RLS denies worker. | Source test for denied roles and route smoke. |
| Client sees internal file | Critical | Separate future client identity and no client RLS policy; no public URLs. | Source test ensures no client/portal route imports finance folder APIs. |
| Signed URL leaked | Medium | Short TTL, private bucket, signed URL only after access check. | Unit/source test TTL and no public URL usage. |
| Revoked grant still works | High | Every API checks current active grant; RLS checks status active; signed URLs expire quickly. | Grant revoke test then list/view/download returns 403. |
| Archived file still downloadable | Medium | Default file queries filter active; signed URL endpoint checks status. | Archive then download denied unless explicit archived access is approved. |
| Wrong project file shown | High | Route project id must match file project_id; storage path includes org/project/file ids. | Cross-project fileId in URL returns 404/403. |
| Cross-org leak | Critical | `org_id` on every table, same-org checks, path prefix, RLS. | Cross-org fixtures/source guards. |
| Public storage leak | Critical | New private bucket only; no `getPublicUrl`; signed URLs through server only. | Source test forbids `getPublicUrl` and public bucket use in finance folder code. |
| File overwrite destroys history | High | `upsert: false`, versioned storage path, immutable versions table. | Replace test verifies old version remains and storage path differs. |
| Missing audit | Medium | Required audit events in every mutating API. | Source tests assert audit event strings and `logAuditServer` usage. |
| Broad `finance_access` grants too much | High | Do not use as folder gate; per-project grants only. | Source test forbids `hasFinanceAccess` as primary finance-folder helper. |
| Hardcoded person access | High | Grant by profile id from DB only; no name checks. | Source test forbids specific-name checks in finance access helper. |

## Implementation Batches

### Batch F1: DB schema + RLS + tests only

Likely files:
- `supabase/migrations/00034_project_finance_folder.sql` or owner-approved manual SQL pack
- `tests/lib/project-finance-folder-rls-source.test.ts`
- `docs/Карта проекта.md`

Migration needed: yes, after DB-0 Gate.

Risk: high.

Tests:
- migration source assertions for tables, constraints, indexes, RLS, no DELETE policies
- denied role tokens
- no `finance_access` broad gate
- no client/worker/supervisor/driver/subcontractor access

Manual QA:
- Owner applies exact SQL manually only after approval.
- Run verification SQL for tables, policies, indexes, FKs, row counts.

Rollback notes:
- Prefer additive idempotent SQL.
- If not yet used, table drop rollback can be planned.
- If used, disable UI/API rather than deleting data.

STOP conditions:
- Supabase project ref uncertain.
- Migration history repair attempted or required.
- SQL not approved.
- Production baseline mismatch.

### Batch F2: server helpers + APIs

Likely files:
- `src/lib/project-finance-access.ts`
- `src/lib/project-finance-files.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/[fileId]/view-url/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/[fileId]/download-url/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/[fileId]/versions/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/[fileId]/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/files/[fileId]/archive/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/grants/route.ts`
- `src/app/api/manager/projects/[id]/finance-folder/grants/[grantId]/revoke/route.ts`
- tests under `tests/lib/`

Migration needed: no new migration if F1 complete.

Risk: high.

Tests:
- access helper unit tests
- API source tests for server checks, audit events, no DELETE, no public URLs
- route guard scanner

Manual QA:
- Non-destructive list/403 checks first.

Rollback notes:
- Revert API/helper commit; DB remains unused.

STOP conditions:
- APIs require storage policy changes not approved.
- Helpers cannot enforce RLS/server access.

### Batch F3: Project UI folder shell + list

Likely files:
- `src/app/(manager)/projects/[id]/page.tsx`
- `src/components/manager/ProjectDetailPage.tsx`
- new component such as `src/components/manager/ProjectFinanceFolderSection.tsx`
- `src/lib/i18n/translations.ts`
- tests for source/UI guards

Migration needed: no.

Risk: medium.

Tests:
- section hidden for no access
- visible for owner/admin/granted
- categories render
- no Owner Overview placement

Manual QA:
- Owner/admin project detail shows empty folder shell.
- Ungranted manager does not see folder.

Rollback notes:
- Revert UI commit; APIs/DB remain.

STOP conditions:
- UI requires broad `hasFinanceAccess` gate.
- UI leaks folder label to denied roles in a way owner rejects.

### Batch F4: upload/download/viewer

Likely files:
- finance folder component
- finance upload helper
- signed URL API routes
- upload validation helper
- tests

Migration needed: no.

Risk: high.

Tests:
- MIME/size validation
- upload inserts file/version
- signed URL denied for revoked/denied users
- no `getPublicUrl`
- no overwrite

Manual QA:
- Owner uploads a harmless test PDF only with explicit owner approval.
- View/download works for owner.
- Ungranted user denied.

Rollback notes:
- Disable upload button/API routes; existing files remain private.

STOP conditions:
- Would require public storage.
- Would require modifying existing media/storage policies unexpectedly.

### Batch F5: access grant UI

Likely files:
- project finance section/component
- grant picker component
- grants API routes
- i18n
- tests

Migration needed: no.

Risk: high.

Tests:
- only owner/admin can grant/revoke
- only manager/sales appear as candidates
- denied roles never appear
- audit events

Manual QA:
- Owner grants one safe manager/sales test account after approval.
- Revoke immediately denies access.

Rollback notes:
- Hide UI; API can remain if safe.

STOP conditions:
- Candidate picker includes worker/supervisor/driver/subcontractor/client.
- Grant UI allows self-escalation by non-owner/admin.

### Batch F6: replace/version/archive

Likely files:
- version API route
- archive API route
- component actions
- tests

Migration needed: no.

Risk: medium-high.

Tests:
- version increments
- old version remains
- archive hides by default
- no delete route
- audit events

Manual QA:
- Replace a non-production-like test file only after owner approval.
- Archive test file only after owner approval.

Rollback notes:
- Disable replace/archive actions.

STOP conditions:
- Any implementation overwrites storage path.
- Any implementation uses `.delete()` for files.

### Batch F7: client-visible publish layer later

Likely files:
- not started in L2.
- future docs and tables for client-visible publishing.

Migration needed: yes later.

Risk: critical.

Tests:
- approved-only visibility
- no internal finance folder exposure
- no payroll/GPS/margin/internal notes

Manual QA:
- Separate client portal QA.

Rollback notes:
- Separate publish table can be disabled without touching internal folder.

STOP conditions:
- Any client portal work starts before its layer.
- Any internal finance file becomes client-visible without explicit publish layer.

## Next Implementation Candidate

After owner approval, the next safe implementation candidate is Batch F1:

DB schema + RLS + tests only.

Before F1:
- Run DB-0 Gate.
- Verify production deploy/commit.
- Verify correct Supabase project ref `vlrajjwbaxikbwvqdpft`.
- Prepare exact SQL.
- Prepare verification SQL.
- Do not run `supabase db push`.
- Do not run SQL until explicitly approved.
