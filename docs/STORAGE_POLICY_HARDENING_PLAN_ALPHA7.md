# Storage Policy Hardening Plan Alpha-7

Date: 2026-05-29

Mode: planning only. No SQL was run for this task, no policies were changed, and no production data was touched.

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
| Direct/private message attachments | `messages/<recipient_id>/<timestamp>-<safeName>` | no | no |

Important compatibility note:

- Runtime readers call `normalizeStoragePath()`, which strips a leading slash and an accidental `media/` bucket prefix before calling `createSignedUrl()`.
- Existing historical rows may have non-clean `storage_path` values. Any Storage policy that joins `storage.objects.name` to `public.media.storage_path` must normalize the table value in the policy expression or a data-cleanup preflight must run first.

## C. Current Upload / Read / Delete Flows

Upload:

- Most uploads are client-side direct uploads to Supabase Storage, followed by inserting a `public.media` row.
- Message attachments are client-side direct uploads to Storage, then stored as JSON in `messages.attachment`; they do not create a `public.media` row.
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
   - temporary compatibility may allow `messages/...` until message attachments are moved under an org-prefixed path.
5. Storage DELETE remains absent.

Long-term desired message path:

```text
<org_id>/messages/<recipient_id>/<timestamp>-<safeName>
```

Current message path:

```text
messages/<recipient_id>/<timestamp>-<safeName>
```

Because of the current message path, full org-prefix enforcement cannot be applied without either:

- a small app change to `SendMessageForm` upload paths; or
- a temporary compatibility clause for `messages/%`.

## E. Migration Draft

Draft file:

- `supabase/migrations/00029_storage_policy_hardening_draft.sql`

Status:

- Created as a draft only.
- Do not apply yet.
- It is idempotent and does not delete data.
- It does not make the bucket public.
- It does not add a delete policy.
- It preserves current message attachment uploads through a temporary `messages/` compatibility clause.

Draft behavior:

- Replaces bucket-wide authenticated read with read-by-linked-media-row or read-by-linked-message-attachment.
- Replaces bucket-wide authenticated upload with org-prefixed upload plus temporary legacy/current `messages/` upload compatibility.

Pre-apply review required:

- Run SELECT-only preflight to count existing object names by first path segment.
- Verify all current message attachments can still be matched through `messages.attachment.storagePath`.
- Decide whether the temporary `messages/` upload compatibility is acceptable for Phase 1.

## F. App Code Changes Needed Or Not

For full hardening: yes, app changes are needed.

Required app change for full org-scope:

- Change message attachment upload path from:

```ts
messages/${recipientId}/${Date.now()}-${safeName}
```

to:

```ts
${orgId}/messages/${recipientId}/${Date.now()}-${safeName}
```

Phase 1 migration can be compatible without app changes, but it cannot fully close the upload path issue because message attachment uploads still lack org prefix.

No app changes should be made in this planning task.

## G. Backward Compatibility For Existing Files

Compatibility risks:

- Existing media rows may have `storage_path` values with leading `/` or `media/` prefix. Draft read policy normalizes those table values before matching `storage.objects.name`.
- Existing message attachments use `messages/<recipient_id>/...`. Draft read policy checks `messages.attachment->>'storagePath'` and preserves sender/recipient/manager access.
- Existing message upload path remains allowed by a temporary insert compatibility clause.

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

Recommendation: not yet for production apply.

Reason:

- Full org-scoped hardening needs a message attachment path change first.
- The draft Phase 1 policy can be made backward-compatible, but it still leaves a temporary `messages/` upload allowance.
- Applying Storage policies is high-impact and should be done in a separate owner-approved hardening window with preflight object-path inventory and targeted manual QA.

Recommended sequence:

1. Change message attachment paths to org-prefixed paths in app code.
2. Keep read compatibility for legacy `messages/%` paths.
3. Apply Storage hardening draft in a controlled deployment.
4. After legacy message files age out or are normalized, remove the `messages/%` upload compatibility clause.
