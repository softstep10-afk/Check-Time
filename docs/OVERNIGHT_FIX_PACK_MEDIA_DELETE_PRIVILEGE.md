# Alpha-7 Media Delete Privilege Hotfix

## Scope

This hotfix restricts saved photo/media deletion to Andrey and Sergey only.

It does not change upload, open, download, file validation, Storage policies, RLS, schema, migrations, archive/trash behavior, payroll, GPS, shifts, messages, tasks, or project business logic.

## Identity Boundary

The local codebase exposes profile `id`, `name`, `role`, and `org_id`; profile email is not part of the app profile type. The helper therefore supports stable server-configured profile IDs through `MEDIA_DELETE_PROFILE_IDS` and also keeps a narrow owner/admin + canonical Andrey/Sergey name fallback for the current production identity model.

The permission helper returns false for broad manager, supervisor, worker, and unrelated admin profiles.

## What Changed

- Added a shared media delete permission helper.
- Added a guarded `DELETE /api/media/[id]` route.
- Receipt deletion now goes through the guarded route instead of directly updating `media.deleted_at` from the client.
- Project planning saves now reject removal of saved media attachment IDs unless the actor has the media delete privilege.
- Delete UI for saved receipt media and planning media attachments is hidden unless the actor has the media delete privilege.

## What Did Not Change

- Existing soft-delete semantics are preserved: media rows are marked with `deleted_at`.
- No permanent storage object deletion was added.
- Upload/open/download behavior is unchanged.
- Signed URL and private bucket behavior is unchanged.
- Supported file types are unchanged.
- Existing same-org media checks are preserved on the server route.

## Manual QA

- Log in as Andrey and confirm saved photo/media delete action is visible and works.
- Log in as Sergey and confirm saved photo/media delete action is visible and works.
- Log in as a manager who is not Andrey or Sergey and confirm saved media delete action is hidden/blocked.
- Log in as supervisor and confirm saved media delete action is hidden/blocked.
- Log in as worker and confirm saved media delete action is hidden/blocked.
- If manually testable, direct API delete attempt by a non-privileged user should return 403.
- Confirm PDF/Word/Excel/CSV/photo/video upload, open, and download still work where the app already allowed them.
- Confirm task and message attachments still open/download normally.
