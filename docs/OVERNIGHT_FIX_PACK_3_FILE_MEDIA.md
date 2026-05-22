# Overnight Fix Pack 3 - File And Media Reliability

## Scope

This pack hardens existing file/media reliability only.

- Project files.
- Task attachments.
- Message attachments.
- Worker project media.
- Worker receipt/media upload paths already used by the app.
- Shared file validation, safe storage filenames, signed open/download fallback, and task attachment guardrails.

No Storage policy, RLS, bucket, schema, migration, payroll, GPS, shift, archive/trash, role, or business-access changes were made.

## What Was Fixed

- Validation now consistently accepts the existing supported business file types: PDF, Word, Excel, CSV, photos, and videos.
- `application/csv` is treated as CSV, matching the already-supported `.csv` and `text/csv` cases.
- Generic picker MIME `application/octet-stream` now falls back to the filename extension before choosing upload content type.
- Safe storage filenames are used for project media, task attachments, message attachments, project planning files, receipts, and worker project media.
- Nameless but valid files, including iPhone video captures, get a MIME-derived extension such as `.mov` or `.mp4`.
- Original display filename is preserved when available; generated safe filename is used only as a fallback.
- Task attachment upload returns success only after both Storage upload and media metadata insert succeed.
- Receipt batch signing normalizes private bucket paths before signed URL creation.
- Manager task creation validates supplied attachment media IDs with service-role access before storing them in task metadata:
  - media row must exist;
  - media row must belong to the actor organization;
  - media row must not be soft-deleted;
  - media row must match the target project when project is known.

## What Was Not Changed

- Storage policies.
- Bucket config.
- Supabase RLS.
- Database schema.
- Migrations.
- Allowed business file categories.
- Who can upload or view files in normal same-org workflows.
- Payroll and salary archive.
- GPS, shifts, clock-in, and clock-out.
- Archive/Trash business meaning.
- Message/task meaning.
- Production data.
- Deployment.

## Manual QA Checklist

Owner/manager:

- Upload a PDF to a project and open/download it.
- Upload a photo to a project and open it.
- Upload a video to a project and open/download it.
- Upload Word, Excel, and CSV project files and open/download each one.
- Create a task with an attachment if the current UI supports it.
- Send a message with an attachment if the current UI supports it.
- Confirm task/message attachments remain after read, taken, done, and notification-read actions.
- Confirm project receipt/photo/PDF flows still save metadata and open via signed URL.

Worker:

- Open a project file where the existing worker workflow allows access.
- Open/download a task attachment.
- Open/download a message attachment.
- Upload worker media/video where the existing workflow supports it.
- Upload an iPhone `.mov` video and confirm the flow does not break.

Archive/Trash:

- Confirm Archive and Trash do not unexpectedly remove file history.
- Do not change or retest payroll archive behavior as part of this pack.

## Deferred

- Storage policy hardening.
- Direct SQL RLS/Storage verification.
- Database schema or file metadata redesign.
- Broad file access redesign.
- Orphan cleanup jobs.
- Archive/Trash file retention redesign.
- App-wide media performance optimization or pagination if it changes visible behavior.

## Known Limitations

Authenticated production testing was not available in this pass. Direct SQL Supabase Step 0 remains blocked, so real production RLS and Storage policy bodies are still unverified.
