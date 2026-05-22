# Overnight Fix Pack 1

Owner-approved fixes with preserved Construction Clock business behavior.

## Changed

- Team routes now protect owner/admin accounts from manager-tier service-role actions:
  - Managers and supervisors can keep creating/managing operational team members.
  - Only owner/admin can create admin team members.
  - Only owner/admin can remove owner/admin team members.
  - Only owner/admin can reset owner/admin PINs.
- Jarvis create-project confirmation now uses the same owner/admin confirmation boundary as Jarvis create-task.
- `detect-store-visit` now supports an optional shared-secret request check through `DETECT_STORE_VISIT_WEBHOOK_SECRET`.

## Not Changed

- Payroll calculations and payroll archive behavior.
- Archive/Trash business meaning.
- Worker clock-in/clock-out, shifts, GPS/geofence math, and Safety Brief.
- Supabase RLS, Storage policies, buckets, schema, and migrations.
- Project upload allowed types.
- Message/task separation.
- Production data.

## Remaining Operations Note

`detect-store-visit` stays backward-compatible until `DETECT_STORE_VISIT_WEBHOOK_SECRET`
is configured on the deployed function and the database webhook sends the matching
`x-check-time-webhook-secret` header. Without that env/header pair, the code path is
ready but production request authentication remains in compatibility mode.
