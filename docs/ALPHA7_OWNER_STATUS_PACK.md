# Alpha-7 Owner Status Pack

Production URL: `https://check-time-five.vercel.app`

Current branch: `fix/postdeploy-qa-audit-patches`

Current deploy status: not deployed by this pack.

## Commits Included In This Review Pack

- `fbcb879` - `fix(alpha7): harden jarvis action confirmation`
- `5af5512` - `docs(alpha7): audit payroll archive behavior`
- `d2fec22` - `docs(alpha7): audit archive and trash behavior`
- `df20735` - `fix(alpha7): redact sensitive logs and errors`
- `19c5279` - `fix(alpha7): add org guards to elevated project routes`
- `24f1b01` - `fix(alpha7): restore mobile navigation and realtime task updates`
- `9bc31b0` - `fix(forms): allow high precision coordinate inputs`
- `ef1bc58` - `fix(projects): allow high precision coordinates`
- `7573ca0` - `fix(alpha7): reduce redundant refresh and subscriptions`
- `0ca85ea` - `fix(alpha7): harden file and media reliability`
- `c235d9f` - `fix(alpha7): harden message task notification flows`
- `fb383ca` - `fix(alpha7): harden owner-level write paths`
- `802d58d` - `chore(alpha7): add non-logic stabilization guardrails`
- `d9367c7` - `fix(projects): restore coordinate paste handling`

## What Was Fixed

- Coordinate paste and high-precision coordinate input behavior.
- Message, task, and notification reliability without changing their business meaning.
- Project/task/message/file media validation and attachment reliability.
- Low-risk refresh/realtime performance issues.
- Mobile quick navigation, project navigation actions, named greetings, and realtime task status updates.
- Owner/admin confirmation boundary for Jarvis write actions.
- Service-role guardrails for malformed IDs and same-org elevated mutations where safe.
- Sensitive log/error redaction.
- Archive/Trash and payroll/salary archive were audited read-only.
- Materials/Driver workflow uses normal tasks with material metadata.
- Production QA hotfix tightened material assignment to driver-role users only.
- Production QA hotfix added clearer action pending states, preserved private/direct message history, and added mobile "Поехать" navigation preference.

## What Was Not Changed

- No payroll calculation changes.
- No salary archive or paid-period history changes.
- No archive/trash business meaning changes.
- No GPS, geofence, shift, clock-in, or clock-out changes.
- No Supabase RLS changes.
- No Storage policy or bucket changes.
- No database schema or migration changes.
- No file allowed business-access redesign.
- No production data mutation.
- No deployment.

## Known Blocked Items

- Direct SQL Supabase Step 0 remains blocked because no direct SQL/dashboard/DB URL access is available.
- Real production RLS/Storage policy verification remains blocked.
- Database-level performance/query-plan audit remains blocked without SQL access.
- Authenticated production QA was not performed by the agent.
- `detect-store-visit` shared-secret enforcement requires `DETECT_STORE_VISIT_WEBHOOK_SECRET` to be configured in the Supabase Edge Function and matching webhook header/bearer value. Until configured, the function remains backward-compatible.

## Owner Manual QA Required

Use `docs/OWNER_MANUAL_QA_CHECKLIST.md` before approving production deployment and again after deployment.

Minimum owner decision checks:

- Top quick nav row on phone.
- Project navigation: Apple Maps, Google Maps, Tesla/share copy, copy address.
- Mobile flicker no longer obvious.
- Task status updates realtime without browser refresh.
- Messages remain in history and read status still works.
- Notifications clear signals without hiding source message/task.
- Project files, task attachments, message attachments, and iPhone video.
- Archive/Trash separation.
- Payroll archive visible and salary calculation unchanged.
- Worker flow, manager flow, owner/admin Jarvis diagnostics.
- Materials: "Добавить материал" must list only drivers; Sanya appears only if his profile role is `driver`.
- Action feedback: material save, media delete, task take, and task done show pending/error states.
- Private messages remain visible for sender and recipient after read/notification clear.
- Mobile project "Поехать" asks for Apple Maps / Google Maps / Tesla-share preference once and then reuses it.

## Deploy Readiness

Code is ready for owner review after local checks pass. Deployment still requires an explicit owner deploy instruction.

Before deploy:

- `git status --short` must be clean.
- Full Alpha-7 predeploy checks must pass.
- Owner must understand blocked Direct SQL Step 0 and post-deploy manual QA requirements.

## Rollback

Use `docs/ROLLBACK_CHECKLIST.md`. Roll back app deployment separately from database state. Do not run reset/wash migrations and do not roll back production database without explicit owner approval.
