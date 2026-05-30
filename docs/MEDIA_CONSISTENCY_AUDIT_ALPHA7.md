# Media Consistency Audit Alpha-7

Date: 2026-05-29

Mode: read-first audit with low-risk fixes only. No deploy, SQL, migrations, schema changes, RLS/Storage policy changes, or production data mutation were performed.

Audit scope requested:

- Project media
- Task attachments
- Message attachments
- Material attachments
- Checkout video
- Check-in video
- Journal media
- Project notes attachments
- Manager upload flows
- Worker upload flows

## Impact Map

Files inspected:

- `src/lib/upload-limits.ts`
- `src/lib/task-attachments.ts`
- `src/lib/message-attachments.ts`
- `src/lib/media-gallery.ts`
- `src/lib/project-media-library.ts`
- `src/components/shared/MediaViewerModal.tsx`
- `src/components/shared/TaskAttachmentList.tsx`
- `src/components/shared/TaskAttachmentUploader.tsx`
- `src/components/shared/MessageAttachmentView.tsx`
- `src/components/shared/ProjectMediaLibrary.tsx`
- `src/components/manager/ProjectDetailPage.tsx`
- `src/components/manager/ManagerTasksPage.tsx`
- `src/components/manager/SendMessageForm.tsx`
- `src/components/manager/BulkMessageComposer.tsx`
- `src/components/manager/DayDetailModal.tsx`
- `src/components/manager/TeamMemberPage.tsx`
- `src/components/worker/WorkerShell.tsx`
- `src/components/worker/WorkerProjectView.tsx`
- `src/components/worker/WorkerTaskDetailModal.tsx`
- `src/components/worker/WorkerMessagesPage.tsx`
- `src/components/worker/JournalPage.tsx`
- `src/components/worker/CheckoutModal.tsx`
- `src/app/api/tasks/[id]/attachments/route.ts`
- `src/app/api/media/[id]/route.ts`
- `src/app/api/manager/tasks/route.ts`
- `src/app/api/worker/link-checkin-video/route.ts`
- `src/app/api/worker/link-checkout-video/route.ts`

Screens and flows potentially affected:

- Manager project detail media tabs and project file upload.
- Worker project detail media upload and project media library.
- Manager task creation and task attachment lists.
- Worker task detail attachment upload and completion evidence upload.
- Direct/private message attachment send and open/download.
- Worker Journal upload/open/download.
- Check-in video and checkout video upload/linking.
- Manager day detail and team member media review.
- Material request attachments and material delivery receipt attachment.
- Project public notes display.

What must not change:

- No payroll, shift, GPS, archive/trash, task lifecycle, message lifecycle, material queue, media delete permission, schema, RLS, or Storage policy behavior.
- Existing project/task/message/journal media open/download flows remain signed-URL based.
- Existing media delete remains app-route soft delete and helper-gated.
- Existing legacy message attachment paths remain supported.
- Check-in/checkout video remains video-only by design.

Targeted regression tests for this change:

- Upload/open/download PDF, photo, video, Word, Excel, CSV on project media where allowed.
- Attach/open/download PDF, photo, video, Word, Excel, CSV on task attachments.
- Send/open/download PDF/photo/video direct message attachments.
- Upload/open/download worker journal files.
- Upload check-in and checkout video; manager can open/download from shift/day views.
- Confirm non-privileged users still cannot delete media.

## Summary Matrix

| Area | Upload/attach | See/view | Open | Download | Delete | File types | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Project media - manager | Yes | Yes | Yes | Yes | Yes if configured media delete helper allows | PDF, photo, video, Word, Excel, CSV | Uses `ACCEPT_ALL_UPLOADS`, project media metadata kind, media tabs, signed viewer. |
| Project media - worker | Yes | Yes | Yes | Yes | No general delete UI | PDF, photo, video, Word, Excel, CSV | Uses `ACCEPT_ALL_UPLOADS`, `ProjectMediaLibrary`, signed viewer. |
| Task attachments - worker existing task | Yes | Yes | Yes | Yes | No general delete UI | PDF, photo, video, Word, Excel, CSV | Uses `TaskAttachmentUploader`, `/api/tasks/[id]/attachments`, task metadata refs. |
| Task attachments - manager existing task | Yes | Yes | Yes | Yes | No general delete UI | PDF, photo, video, Word, Excel, CSV | Same shared task uploader/list. |
| Task creation attachments | Yes | Yes after create | Yes | Yes | No general delete UI | PDF, photo, video, Word, Excel, CSV | Manager task form uploads first, then passes `attachmentMediaIds` to task route. |
| Message attachments - direct/private | Yes | Sender/recipient history | Yes | Yes via viewer | No delete UI | PDF, photo, video, Word, Excel, CSV | New paths are org-prefixed; legacy `messages/...` paths still use stored path. |
| Bulk team messages | No attachment picker | Message history only | N/A | N/A | N/A | Text only | Not changed. Adding bulk attachments is a separate feature, not a low-risk consistency fix. |
| Material request attachments | Yes | Visible through material task/task detail | Yes | Yes | No general delete UI | PDF, photo, video, Word, Excel, CSV | Uses task attachment metadata on created material tasks plus optional material link. |
| Material delivery receipt | Yes | Visible on material delivery receipt | Yes | Yes | No general delete UI | Photo, PDF | Receipt proof is intentionally restricted to image/PDF, not full business docs. |
| Checkout video | Yes | Worker/manager shift surfaces | Yes | Yes | Configured delete helper only where surfaced | Video | Video-only by business rule. |
| Check-in video | Yes | Worker/manager shift surfaces | Yes | Yes | Configured delete helper only where surfaced | Video | Video-only by business rule. |
| Journal media | Yes | Worker Journal, manager/team media views | Yes | Yes | Configured delete helper only in manager surfaces | PDF, photo, video, Word, Excel, CSV | Uses `ACCEPT_ALL_UPLOADS`; low-risk MIME/name consistency fix applied in `WorkerShell`. |
| Project notes attachments | No | Text notes visible | N/A | N/A | N/A | None | Project notes are text-only today. Attachment support would be a separate approved feature. |

## Findings

### Confirmed Low-Risk Bug Fixed

Worker shell upload paths for Journal, check-in video, checkout video, and offline upload drain used safe Storage paths but still stored raw `file.name` and `file.type` in the `media` row and passed raw `file.type` as Storage `contentType`.

Risk:

- iOS or cloud file pickers can return empty/generic MIME values.
- The object path can be safe and playable while the metadata shown in UI is blank or generic.
- Download/open labels and document/video classification can be less reliable than project/task/message upload flows.

Fix:

- `WorkerShell` now uses `inferUploadContentType(file)` for Storage `contentType` and `media.mime_type`.
- `WorkerShell` now stores `file.name || safeName` as `media.filename`.
- This aligns worker journal/check-in/checkout uploads with project/task/message upload behavior.

### Confirmed Working Coverage

- Shared `ACCEPT_ALL_UPLOADS` includes photo, video, PDF, Word, Excel, CSV, text, TSV, HEIC/HEIF, MOV/QuickTime.
- `TaskAttachmentUploader` validates with `validateUploadFile`, uploads through `uploadTaskAttachment`, then links through `/api/tasks/[id]/attachments`.
- Task attachment route authenticates the actor, loads profile, reads the task through user-scoped visibility, validates media org/project with admin client, then updates metadata.
- Project media is separated from task attachments by `metadata.kind === "project_media"`.
- `TaskAttachmentList`, `ProjectMediaLibrary`, `MessageAttachmentView`, Journal, Day Detail, and Team Member media surfaces use signed URL open/download behavior.
- Message attachment storage path is org-prefixed for new attachments, and the viewer still uses the stored path for legacy attachments.
- Media delete remains helper-gated through `/api/media/[id]` and soft-deletes only after actor/org checks.

## Possible Risks / Follow-Up

P2 - Bulk team message attachments are not supported.

- Affected area: `src/components/manager/BulkMessageComposer.tsx`
- Why not fixed: adding multi-recipient attachment handling is a feature, not a confirmed low-risk bug.
- Recommended next step: owner-approved feature task if team-wide attachments are needed.

P2 - Project notes do not support attachments.

- Affected area: project public notes in `WorkerProjectView` / `ProjectDetailPage`
- Why not fixed: current notes are text-only and intentionally separate from tasks/messages. Attachment support would require a product decision about visibility and storage metadata.
- Recommended next step: owner-approved project notes attachment feature if needed.

P3 - Receipt proof upload is image/PDF only.

- Affected area: material delivery receipt and project receipts.
- Why not fixed: receipt proof is intentionally constrained; broad document support belongs to project/task/material spec attachments, which already support business docs.

## Manual QA Checklist

- Project media: upload photo, video, PDF, Word, Excel, CSV; open and download each.
- Task attachment: attach photo, video, PDF, Word, Excel, CSV; owner/manager and worker both see/open/download.
- Message attachment: send PDF, image, and video; sender and recipient can open/download.
- Material request: attach PDF/photo/video/doc and add a link; material task shows attachments/link.
- Journal: upload photo, video, PDF/doc; open/download from Journal and manager media views.
- Check-in video: upload from worker prompt; manager can open/download.
- Checkout video: upload from checkout prompt; manager can open/download.
- Media delete: non-privileged user cannot delete; configured Andrey/Sergey/helper user can soft-delete where UI exposes delete.

## What Was Not Changed

- No deploy.
- No SQL.
- No migrations.
- No schema changes.
- No RLS or Storage policy changes.
- No production data mutation.
- No payroll/GPS/archive/shift changes.
- No task/message/material lifecycle redesign.
- No media delete permission semantic change.
