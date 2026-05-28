# Alpha-7 Production Risk Audit

Date: 2026-05-28

Mode: read-only audit. No deploy, SQL, migrations, schema changes, RLS changes, Storage policy changes, or production data mutation were performed.

Local HEAD at audit time: `7d82fedcc63983dfc60e5a373bf7ef8111b4587d`

## Scope

Inspected risk areas:

- Worker flows.
- Manager flows.
- Owner flows.
- Driver/material flows.
- Offline flows.
- Upload/media flows.
- Notifications.
- Realtime.
- Audit/signatures.
- Payroll/archive.
- Service-role routes.
- Shared components.
- Project navigation.
- Project notes.
- Checkout flow.
- Message history.

Primary local evidence:

- `docs/ALPHA7_FINAL_RELEASE_FREEZE.md`
- `docs/ALPHA7_FINAL_QA_CHECKLIST.md`
- `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`
- `docs/DANGEROUS_ZONES_ALPHA7.md`
- `docs/ALPHA7_DEFERRED_LOGIC_TASKS.md`
- `reports/alpha7-invariant-gate.md`
- `reports/alpha7-route-mutation-map.md`
- `reports/alpha7-coverage-map.md`
- `npm run inventory:service-role`
- Current test and build suite.

## Confirmed Risks

### R1. Production database policy state is not directly verified

- Severity: P1
- Affected files: `supabase/migrations/**`, `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`
- Affected screens: login, projects, tasks, media, messages, clock/shift, payroll/archive, audit/signatures
- Affected workflow: every workflow relying on Supabase RLS, Storage policies, grants, or applied migrations
- Why it is a risk: local code can be correct while production RLS, Storage policies, grants, or applied migrations drift. This can cause access regressions, blocked writes, overly broad reads, upload failures, or payroll/archive exposure.
- Likelihood: Medium
- Recommended fix: owner-approved Supabase Direct SQL Step 0 using `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`; record applied migrations, RLS state, Storage policies, grants, schema mismatch, and service-role risk areas.
- Requires: SQL read-only audit; possibly RLS/Storage/schema follow-up if findings appear

### R2. Production diagnostics commit could not be verified by Codex

- Severity: P1
- Affected files: `src/app/(manager)/admin/diagnostics/page.tsx`, `scripts/alpha7-release-audit.mjs`
- Affected screens: `/admin/diagnostics`
- Affected workflow: release verification and rollback decision-making
- Why it is a risk: local `alpha7:release-audit` could not read the production deployment commit, and the browser redirected `/admin/diagnostics` to login because no owner/admin session was available. Without owner/admin verification, production may be behind local HEAD or on an unexpected commit.
- Likelihood: Medium
- Recommended fix: owner/admin opens `/admin/diagnostics` and compares displayed commit SHA to intended deploy commit before any release decision.
- Requires: process only

### R3. Final hardening/process pack is local unless explicitly deployed

- Severity: P2
- Affected files: `docs/REGRESSION_IMPACT_RULES_ALPHA7.md`, `docs/CRITICAL_PATH_SMOKE_ALPHA7.md`, `docs/DANGEROUS_ZONES_ALPHA7.md`, `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`, `docs/ALPHA7_FINAL_RELEASE_FREEZE.md`, `docs/ALPHA7_FINAL_QA_CHECKLIST.md`, `package.json`
- Affected screens: no runtime screens unless owner wants diagnostics to show this commit
- Affected workflow: future change process, manual QA discipline, production readiness process
- Why it is a risk: guardrail docs/scripts protect future work only if the team actually uses the latest local repo state. Production runtime is not affected by these docs-only commits, but release discipline can regress if the pack is ignored.
- Likelihood: Medium
- Recommended fix: adopt these docs as required process; deploy only if owner wants production diagnostics to point to this exact process commit.
- Requires: process only; optional deploy by owner approval

### R4. Known destructive local SQL file remains present

- Severity: P1
- Affected files: `supabase/migrations/00099_wash_and_reset.sql`
- Affected screens: all production data if executed
- Affected workflow: database safety, rollback, deploy discipline
- Why it is a risk: `check:dangerous` correctly reports this as known-local-danger because it contains destructive reset/drop behavior. It is safe while unexecuted, but catastrophic if accidentally run against production.
- Likelihood: Low if process is followed; High impact
- Recommended fix: keep it blocked by dangerous scans; never execute, normalize away, or include in deployment/migration workflows without explicit owner approval and backup plan.
- Requires: process only; SQL/migration only if owner separately approves a controlled database operation

### R5. Authenticated production manual QA remains required

- Severity: P1
- Affected files: `docs/OWNER_MANUAL_QA_CHECKLIST.md`, `docs/ALPHA7_FINAL_QA_CHECKLIST.md`
- Affected screens: worker mobile, manager projects/tasks/media/messages, owner diagnostics/audit, driver/material flow, offline flow
- Affected workflow: real production operation
- Why it is a risk: local tests and unauthenticated smoke cannot prove every owner/manager/worker/driver flow works with real production accounts, production env vars, production RLS, device permissions, file pickers, realtime, and weak mobile networks.
- Likelihood: Medium
- Recommended fix: owner runs targeted manual QA from `docs/ALPHA7_FINAL_QA_CHECKLIST.md`; report one failed item at a time.
- Requires: process only

### R6. Material supervisor-driver eligibility depends on production env config

- Severity: P2
- Affected files: `src/lib/material-driver-permissions.ts`, `src/lib/server/material-driver-config.ts`, `src/lib/worker-data.ts`, `src/components/manager/ProjectDetailPage.tsx`
- Affected screens: material request modal, worker task/material queue, driver/supervisor-driver task view
- Affected workflow: Sanya/supervisor-driver material assignment and open material task visibility
- Why it is a risk: configured supervisor-driver users require stable profile ids in `MATERIAL_DRIVER_PROFILE_IDS`. If production env is missing or stale, a supervisor-driver may remain supervisor but not appear as material-capable.
- Likelihood: Medium
- Recommended fix: owner verifies config through approved deployment/env review and manual QA; do not hardcode display names.
- Requires: process/env config; no SQL unless owner chooses separate data verification

### R7. Offline mode is local-device only and not a full PWA rewrite

- Severity: P2
- Affected files: `src/lib/offline-field-actions.ts`, `src/lib/offline-field-cache.ts`, `src/lib/offline-uploads.ts`, `src/components/worker/WorkerShell.tsx`
- Affected screens: worker tasks, material queue, messages, project pages, offline banner
- Affected workflow: weak-network worker/driver field operation
- Why it is a risk: offline queue/cache improves weak-network behavior but does not guarantee full app shell availability, large file persistence, cross-device pending visibility, or background sync for pages never loaded online.
- Likelihood: Medium
- Recommended fix: document limitation in QA; future owner-approved task can add service-worker/background sync or IndexedDB file queue.
- Requires: code if expanded; possibly process only for current release

## Possible Risks

These are not confirmed vulnerabilities. They are static-audit/manual-review items from route maps and deferred logs.

### PR1. Static route map flags several mutation helpers as manual review or unknown

- Severity: P2
- Affected files:
  - `src/app/api/ai/assistant/route.ts`
  - `src/app/api/ai/daily-report/route.ts`
  - `src/app/api/ai/memory/route.ts`
  - `src/app/api/ai/settings/route.ts`
  - `src/app/api/ai/voice/route.ts`
  - `src/lib/audit-server.ts`
  - `src/lib/audit.ts`
  - `src/lib/capabilities.ts`
  - `src/lib/media-flags.ts`
  - `src/lib/mux-webhook.ts`
  - `src/lib/pin-login-rate-limit.ts`
  - `src/lib/project-planning-attachments.ts`
  - `src/lib/project-save.ts`
  - `src/lib/safety-acknowledgements.ts`
  - `src/lib/store-visits.ts`
  - `src/lib/task-attachments.ts`
  - `src/lib/worker-data.ts`
- Affected screens: Jarvis, audit, admin/team/auth, media, planning, safety, store visits, worker data
- Affected workflow: elevated or write-adjacent server/client mutations
- Why it is a risk: the static scanner sees `.insert`, `.update`, `.upsert`, `.delete`, or service-role-adjacent evidence without enough context to classify every path as confirmed guarded.
- Likelihood: Medium for false positives; Low-to-Medium for real guard gaps
- Recommended fix: separate owner-approved route security audit. For each path, confirm authenticated actor, server-side profile load, org/resource guard, role permission, and no client-provided org/user trust.
- Requires: code if a real guard gap is found; process first

### PR2. Service-role routes remain high-impact even when guarded

- Severity: P2
- Affected files: routes listed by `npm run inventory:service-role`, especially team/auth, project, task, media, schedule, worker clock/video, Jarvis action routes, and `src/lib/supabase/admin.ts`
- Affected screens: team, projects, tasks, media, schedule, worker clock/checkout, Jarvis
- Affected workflow: any mutation performed through an admin client
- Why it is a risk: service-role bypasses RLS by design. A future refactor that moves `createAdminClient()` before actor/org checks or trusts client IDs could become a cross-org or privilege escalation issue.
- Likelihood: Low currently because many routes are guarded; Medium over future changes
- Recommended fix: keep `inventory:service-role` and `route-mutation-map` mandatory; add route-level tests before touching these files.
- Requires: process now; code tests for future route changes

### PR3. Realtime and notification behavior depends on subscriptions and fallback timing

- Severity: P2
- Affected files: `src/lib/task-realtime.ts`, `src/lib/message-state.ts`, `src/components/worker/WorkerShell.tsx`, `src/components/worker/WorkerMessagesPage.tsx`, `src/components/manager/ManagerTasksPage.tsx`, `src/components/manager/BulkMessageComposer.tsx`, notification bell components
- Affected screens: worker tasks/messages, manager tasks/project detail/messages, notification bells
- Affected workflow: task status, material claim/done, message read status, notification clearing
- Why it is a risk: tests cover merge/dedupe helpers, but production realtime can still be affected by browser sleep, network drops, RLS policy drift, or Supabase channel hiccups.
- Likelihood: Medium
- Recommended fix: manual QA for live status and notification-as-signal; future dedicated production telemetry only with owner approval.
- Requires: process now; code only if a reproduced bug appears

### PR4. Media upload/open/download depends on both app validation and Storage policy state

- Severity: P2
- Affected files: `src/lib/upload-limits.ts`, `src/components/shared/TaskAttachmentList.tsx`, `src/components/shared/ProjectMediaLibrary.tsx`, media upload surfaces, Storage policies
- Affected screens: project media, journal, task attachments, message attachments, material specs
- Affected workflow: PDF/Word/Excel/CSV/photo/video upload/open/download/delete
- Why it is a risk: local validation and tests are green, but actual production Storage bucket policy/config must be confirmed through Supabase Step 0 and manual file picker QA on iOS/Android.
- Likelihood: Medium
- Recommended fix: owner QA uploads and opens each file class; run Storage policy review in Step 0.
- Requires: process/manual QA; Storage only if policy mismatch is found

### PR5. Payroll/archive remains a dangerous zone despite current tests

- Severity: P1 if touched; P3 if untouched
- Affected files: `src/app/(manager)/payroll/**`, `src/lib/archive-utils.ts`, `src/lib/payroll-*`, payroll routes, archive/trash pages
- Affected screens: payroll, payroll history, archive, trash
- Affected workflow: paid history, finance visibility, closed hours, archive/trash separation
- Why it is a risk: payroll/archive tests are broad, but any future change to this area has high business impact.
- Likelihood: Low if untouched
- Recommended fix: do not touch payroll/archive without explicit owner approval, Impact Map, and focused tests.
- Requires: process; code only for separate approved payroll/archive tasks

### PR6. Shared components can regress unrelated screens

- Severity: P2
- Affected files: `WorkerShell`, `WorkerProjectView`, `TasksPage`, `NotificationBell`, `ManagerWorkAlertBell`, `ProjectNavigationActions`, upload/file components, checkout modal, project cards
- Affected screens: worker mobile, manager project/task/media, navigation, messages, checkout, offline
- Affected workflow: broad cross-screen interaction
- Why it is a risk: recent hotfixes showed small shared UI changes can affect mobile navigation, project tapping, checkout visibility, file pickers, and message/task state.
- Likelihood: Medium
- Recommended fix: enforce `docs/REGRESSION_IMPACT_RULES_ALPHA7.md` for every future task and run affected-flow tests.
- Requires: process now; tests/code for future tasks

### PR7. Consent/legal signature completeness depends on existing schema limits

- Severity: P2
- Affected files: `src/lib/gps-consent.ts`, `src/lib/safety-acknowledgements.ts`, `src/app/(manager)/admin/audit/page.tsx`
- Affected screens: GPS consent modal, Safety Brief, Audit -> Signatures
- Affected workflow: legal/audit record review
- Why it is a risk: GPS consent stores richer signature state; current docs note Safety Brief may not include every legal-style field such as signed name, user agent, or IP unless schema is expanded.
- Likelihood: Medium if legal requirements expand
- Recommended fix: owner decides whether current Safety Brief fields are sufficient. Extra fields require separate schema/migration task.
- Requires: SQL/schema if expanded; process/legal decision now

## Closed Risks

These risks are currently covered by local source checks, tests, or docs. They are closed for this audit unless new production QA contradicts them.

### C1. Material task Sanya hardcode risk

- Status: Closed locally
- Evidence: invariant gate passes `src business logic does not hardcode Sanya/Саня`; material driver behavior uses role/helper/config.
- Remaining release risk: production env config must still be verified for supervisor-driver users.

### C2. Material dropdown full-team fallback risk

- Status: Closed locally
- Evidence: invariant gate passes; material UI/source tests cover eligible field users and open queue.
- Remaining release risk: manual QA should verify real production profiles.

### C3. Message read/dismiss hiding source message

- Status: Closed locally
- Evidence: message-state tests, live-status source tests, invariant gate.
- Remaining release risk: production realtime/manual QA.

### C4. Task read/taken/done disappearance and duplicate realtime rows

- Status: Closed locally
- Evidence: task realtime tests and invariant gate.
- Remaining release risk: production realtime/manual QA.

### C5. Project card first tap and navigation/copy behavior

- Status: Closed locally
- Evidence: mobile project interaction source tests and navigation tests.
- Remaining release risk: device-specific mobile QA.

### C6. Upload file type support

- Status: Closed locally
- Evidence: upload-limits tests; file picker source guards; media library tests.
- Remaining release risk: actual iOS/Android picker behavior and production Storage policy.

### C7. Owner/admin diagnostics does not expose secrets

- Status: Closed locally
- Evidence: release diagnostics source tests.
- Remaining release risk: owner/admin must open production diagnostics to verify actual deployed commit.

### C8. Archive/trash separation and finance-gated payroll archive

- Status: Closed locally
- Evidence: archive-utils tests and finance visibility tests.
- Remaining release risk: production RLS/Step 0 verification.

### C9. Offline visible banner and readable cache

- Status: Closed locally
- Evidence: offline action/cache/visibility tests and source guards.
- Remaining release risk: real device weak-network manual QA.

## Dangerous Zones

Any future task touching these areas is dangerous and must stop for explicit owner-approved scope:

- Supabase migrations, schema, RLS policies, Storage policies, Storage bucket config.
- Payroll calculation, salary archive, paid periods, payroll archive.
- Shift, time events, clock-in, clock-out, GPS, geofence, live locations, no-GPS warning logic.
- Archive/trash lifecycle.
- Auth/session/PIN login.
- Service-role routes and admin clients.
- Team/role hierarchy.
- Material queue core rules.
- Task/message lifecycle.
- Media delete permission semantics.
- Jarvis mutation/action permissions.

## Release Blockers

For declaring Alpha-7 stable for daily company use:

1. P1: Supabase Direct SQL Step 0 remains unrun.
2. P1: Production diagnostics commit is not verified by owner/admin in production.
3. P1: Authenticated owner/manager/worker/driver manual QA remains required.
4. P1: Known destructive `00099_wash_and_reset.sql` must remain blocked and unexecuted.

For deploying the local docs/process-only hardening pack:

- No runtime release blocker was found in this audit.
- Owner decision is still required because production commit could not be verified by Codex.

## Not Release Blockers

These are not blockers for a docs/process-only deploy, but they remain operational follow-ups:

- Static route map manual-review findings that are not confirmed vulnerabilities.
- Offline mode limitations that are explicitly documented.
- Device-specific file picker behavior requiring manual QA.
- Realtime reliability edge cases without a current reproduction.
- Future Safety Brief legal-field expansion if owner wants richer e-signature metadata.

## Recommended Order

1. Owner/admin verifies `/admin/diagnostics` and records the current production commit.
2. Owner runs `docs/ALPHA7_FINAL_QA_CHECKLIST.md` on production.
3. Run owner-approved Supabase Step 0 read-only audit from `docs/SUPABASE_STEP0_AUDIT_PACK_ALPHA7.md`.
4. If Step 0 finds RLS/Storage/schema/grant drift, create one separate owner-approved task per finding.
5. If manual QA finds runtime bugs, create one hotfix task per failed item with an Impact Map.
6. If no blockers remain, freeze Alpha-7 and resume feature work under `docs/REGRESSION_IMPACT_RULES_ALPHA7.md`.

