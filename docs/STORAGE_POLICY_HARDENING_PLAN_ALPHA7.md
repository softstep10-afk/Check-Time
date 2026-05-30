# Storage Policy Hardening Plan Alpha-7

Date: 2026-05-29

Status update: Storage Phase 1 was owner-approved and applied after the
org-prefixed message attachment path change passed QA. The final applied policy
keeps legacy `messages/...` reads working through `public.messages`, but new
Storage uploads must use the authenticated user's org id as the first path
segment.

Original mode: planning only. The later Storage Phase 1 apply ran only the
policy DDL described below; no files or production table rows were deleted or
moved.

## Impact Map

Files and areas inspected:

- `src/components/worker/WorkerShell.tsx`
- `src/components/worker/WorkerProjectView.tsx`
- `src/components/manager/ProjectDetailPage.tsx`
- `src/components/manager/SendMessageForm.tsx`
- `src/lib/task-attachments.ts`
- `src/lib/project-planning-attachments.ts`
- `src/components/shared/TaskAttachmentList.tsx`
- `src/components/shared/MessageAttachmentView.tsx`
- `src/components/shared/MediaViewerModal.tsx`
- `src/components/shared/MediaGalleryDrawer.tsx`
- `src/app/api/media/[id]/route.ts`
- `src/lib/server/media-delete.ts`
- `src/app/api/worker/link-checkin-video/route.ts`
- `src/app/api/worker/link-checkout-video/route.ts`
- `src/lib/checkout-link-server.ts`
- `supabase/migrations/00011_media_project_privacy.sql`
- `supabase/migrations/00020_media_rls_all_active.sql`

Screens and flows affected if Storage policies change:

- Worker Journal upload/open/download.
- Worker active project media and checkout/check-in videos.
- Manager project media tabs and detail viewer.
- Task attachments from manager-created tasks/material requests.
- Project planning attachments.
- Delivery receipts.
- Direct/private message attachments.
- Checkout video linking routes.
- Media delete UI/API.

What must not change:

- Upload/open/download for PDF, Word, Excel, CSV, photos, videos, and iPhone MOV/QuickTime.
- Private media bucket remains private.
- No public delete policy.
- Existing app-level media delete rule remains Andrey/Sergey/configured helper only.
- Task/message/material lifecycle unchanged.
- Payroll, shifts, GPS, archive/trash unchanged.

Targeted regression checks before applying any Storage policy migration:

- Upload and open project photo/video/PDF/doc as owner/manager.
- Upload and open worker journal photo/video/PDF.
- Upload and open task attachment.
- Upload and open material receipt/spec attachment.
- Send/open message attachment.
- Checkout/check-in video upload and manager playback.
- Non-privileged user cannot delete media.
- Andrey/Sergey/configured helper can soft-delete media through app route.

## A. Current Storage Policy Risk

Supabase Step 0 found:

- Bucket: `media`.
- Bucket private: `public=false`.
- File size limit: `524288000`.
- MIME allow-list: `null`, so MIME enforcement is app-side.
- Storage policies on `storage.objects`:
  - authenticated users can read any object where `bucket_id = 'media'`;
  - authenticated users can upload any object where `bucket_id = 'media'`;
  - no Storage delete policy exists.

Risk:

- Authenticated users are constrained by app UI and `public.media` RLS for normal media lists, but direct Storage access is currently bucket-scoped, not org/path-scoped.
- If a user learns or guesses an object path, Storage policy may allow signed URL creation even when app metadata would not show that media row.
- Upload is also bucket-wide for authenticated users. Existing app upload paths are mostly structured, but Storage does not enforce that shape yet.

This is P1 defense-in-depth risk, not a confirmed P0 data-loss issue.

## B. Current Object Path Structure

Observed current upload path builders:

| Flow | Current path shape | Includes org_id | Includes project_id |
| --- | --- | --- | --- |
| Worker journal/check-in/checkout uploads | `<org_id>/<project_id>/<date>/<timestamp>-<safeName>` | yes | yes |
| Offline queued worker media | `<org_id>/<project_id>/<date>/<timestamp>-<safeName>` | yes | yes |
| Worker project media | `<org_id>/<project_id>/project-media/<uuid>-<safeName>` | yes | yes |
| Manager project media | `<org_id>/<project_id>/project-media/<uuid>-<safeName>` | yes | yes |
| Task attachments | `<org_id>/<project_id>/tasks/<timestamp>-<safeName>` | yes | yes |
| Project planning attachments | `<org_id>/<project_id>/planning/<timestamp>-<safeName>` | yes | yes |
| Receipts / material delivery proof | `<org_id>/<project_id>/receipts/<uuid>-<safeName>` | yes | yes |
| Direct/private message attachments | new: `<org_id>/messages/<recipient_id>/<timestamp>-<safeName>`; legacy: `messages/<recipient_id>/<timestamp>-<safeName>` | yes for new uploads | no |

Important compatibility note:

- Runtime readers call `normalizeStoragePath()`, which strips a leading slash and an accidental `media/` bucket prefix before calling `createSignedUrl()`.
- Existing historical rows may have non-clean `storage_path` values. Any Storage policy that joins `storage.objects.name` to `public.media.storage_path` must normalize the table value in the policy expression or a data-cleanup preflight must run first.

## C. Current Upload / Read / Delete Flows

Upload:

- Most uploads are client-side direct uploads to Supabase Storage, followed by inserting a `public.media` row.
- New message attachments are client-side direct uploads to Storage under `<org_id>/messages/<recipient_id>/...`, then stored as JSON in `messages.attachment`; they do not create a `public.media` row.
- Existing legacy message attachments under `messages/<recipient_id>/...` remain supported for read/open/download through the stored `messages.attachment.storagePath`.
- Checkout/check-in proof videos are uploaded as `public.media` rows and later linked to `time_events` by service-role API routes with strict predicates.

Read/open/download:

- Project/task/journal media generally reads `public.media` rows first, then calls `createSignedUrl()` on `storage_path`.
- Message attachments call `createSignedUrl()` from `messages.attachment.storagePath`.
- Viewers/downloaders normalize `storage_path` before signing.

Delete:

- There is no Storage object DELETE policy.
- App media delete route only soft-deletes the `public.media.deleted_at` field.
- App-level delete permission remains controlled by `canDeleteMediaEverywhere*` for Andrey/Sergey/configured helper identity.
- Storage objects are not deleted by current media delete behavior.

## D. Safe Target Policy Model

The safest long-term model:

1. All new object paths start with the actor's `org_id`.
2. Project-scoped files also include `project_id` as the second path segment.
3. Storage SELECT is allowed only when:
   - a non-deleted `public.media` row points to the normalized object path and the caller would be allowed to view that media under the current app access model; or
   - a `public.messages` row references the object path in `attachment.storagePath` and the caller is sender, recipient, or manager.
4. Storage INSERT is allowed only when:
   - `bucket_id = 'media'`;
   - first path segment equals `public.get_user_org_id()::text`;
   - new message attachment uploads should require the caller org prefix.
5. Storage DELETE remains absent.

New message path:

```text
<org_id>/messages/<recipient_id>/<timestamp>-<safeName>
```

Legacy message path that must remain readable:

```text
messages/<recipient_id>/<timestamp>-<safeName>
```

After the org-prefixed app path is deployed, full org-prefix enforcement can be considered for new Storage INSERTs while keeping legacy `messages/%` SELECT compatibility for existing attachments.

## E. Migration Draft

Draft file:

- `supabase/migrations/00029_storage_policy_hardening_draft.sql`

Status:

- Created as a draft only.
- Do not apply yet.
- It is idempotent and does not delete data.
- It does not make the bucket public.
- It does not add a delete policy.
- It preserves legacy/current message attachment paths through a temporary `messages/` compatibility clause.
- After the org-prefixed message path change is deployed and production-QA'd, review the draft before applying Phase 1 and remove or narrow legacy upload compatibility if no longer needed for new writes.

Draft behavior:

- Replaces bucket-wide authenticated read with read-by-linked-media-row or read-by-linked-message-attachment.
- Replaces bucket-wide authenticated upload with org-prefixed upload plus temporary legacy/current `messages/` upload compatibility.

Pre-apply review required:

- Run SELECT-only preflight to count existing object names by first path segment.
- Verify all current message attachments can still be matched through `messages.attachment.storagePath`.
- Decide whether the temporary `messages/` upload compatibility is acceptable for Phase 1.

## F. App Code Changes Needed Or Not

For full hardening: the prerequisite app change is now identified and implemented in the local code path.

Required app behavior for full org-scope:

- New message attachment uploads use:

```ts
${orgId}/messages/${recipientId}/${Date.now()}-${safeName}
```

Backward compatibility:

- Existing `messages/<recipient_id>/...` attachment paths are not moved or rewritten.
- Open/download uses the stored path as source of truth and still signs legacy paths.
- Project media, task attachments, receipts, planning attachments, journal uploads, and checkout videos keep their current org/project path shapes.
- Next step after production QA: apply Storage Phase 1 policy hardening in a separate owner-approved task.

## G. Backward Compatibility For Existing Files

Compatibility risks:

- Existing media rows may have `storage_path` values with leading `/` or `media/` prefix. Draft read policy normalizes those table values before matching `storage.objects.name`.
- Existing message attachments use `messages/<recipient_id>/...`. Draft read policy checks `messages.attachment->>'storagePath'` and preserves sender/recipient/manager access.
- Existing legacy message read paths remain supported. New message upload paths should be org-prefixed before the Storage policy is tightened.

Remaining unknown:

- This task did not run SQL by request. Before applying the draft, run a SELECT-only storage object path inventory to confirm actual production object path distribution.

Suggested preflight:

```sql
select
  split_part(name, '/', 1) as first_segment,
  count(*) as object_count
from storage.objects
where bucket_id = 'media'
group by first_segment
order by object_count desc, first_segment;
```

## H. Rollback Plan

If the draft is applied later and media open/upload breaks:

1. Do not delete objects.
2. Restore current broad policies:

```sql
drop policy if exists "media objects read through linked app rows" on storage.objects;
drop policy if exists "media objects upload org scoped with legacy messages" on storage.objects;

create policy "authenticated can read media"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'media');

create policy "authenticated can upload to media"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'media');
```

3. Re-test project media, task attachments, message attachments, worker journal, checkout videos, and receipts.

## I. Manual QA Checklist

Before applying:

- Confirm production object first-segment inventory.
- Confirm existing message attachments have `attachment.storagePath`.
- Confirm owner/manager can upload project photo/video/PDF/doc.
- Confirm worker can upload journal photo/video/PDF.
- Confirm material receipt/spec upload works.
- Confirm task attachment upload works.
- Confirm direct/private message attachment upload works.
- Confirm checkout/check-in video upload and playback works.
- Confirm signed URL open/download works for old and new files.
- Confirm non-privileged users cannot delete media.
- Confirm Andrey/Sergey/configured helper soft-delete still works.

After applying in a controlled window:

- Repeat all checks above with two different roles.
- Include a worker assigned to an explicit project.
- Include a worker with `project_access_mode = all_active`.
- Include a manager/owner viewing all project media.

## J. Recommendation

Recommendation: applied for Phase 1.

Preflight before apply:

- Current broad policies were exactly `authenticated can read media` and
  `authenticated can upload to media`.
- `media` bucket was private: `public=false`.
- Existing Storage objects: 40 org-prefixed media objects, 1 legacy
  `messages/...` object.
- `public.media` rows: 40 total, 40 org-prefixed, 0 leading slash, 0
  `media/` bucket prefix.
- Message attachments: 1 legacy `messages/...` storage path, 0 org-prefixed
  production message attachments observed at apply time.

Applied behavior:

1. Removed bucket-wide authenticated Storage read/upload policies.
2. Added `media objects read through linked app rows`.
3. Added `media objects upload org scoped`.
4. Did not add a Storage DELETE policy.
5. Kept the bucket private.

After-check:

- Active Storage policies are now:
  - `media objects read through linked app rows` for SELECT.
  - `media objects upload org scoped` for INSERT.
- DELETE policies remain absent.
- `media` bucket remains private with the same size limit and MIME config.

Next recommendation:

1. Run production manual QA for project media, task attachments, new and legacy
   message attachments, checkout/check-in videos, journal media, and material
   files.
2. Keep legacy `messages/...` SELECT compatibility until old message
   attachments are migrated or intentionally retired.
