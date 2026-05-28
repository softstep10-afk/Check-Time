# Alpha-7 Worker Mobile Critical Path Audit

Date: 2026-05-28

Mode: read-first, fix only confirmed low-risk bugs.

## Impact Map

Files inspected:

- `src/components/worker/WorkerShell.tsx`
- `src/components/worker/ClockPage.tsx`
- `src/components/worker/WorkerProjectsList.tsx`
- `src/components/worker/WorkerProjectView.tsx`
- `src/components/worker/TasksPage.tsx`
- `src/components/worker/WorkerTaskDetailModal.tsx`
- `src/components/worker/WorkerMessagesPage.tsx`
- `src/components/worker/NotificationBell.tsx`
- `src/components/worker/JournalPage.tsx`
- `src/components/worker/GpsConsentModal.tsx`
- `src/components/worker/SafetyBriefModal.tsx`
- `src/components/worker/CheckoutModal.tsx`
- Shared media/navigation/upload/offline helpers.

Screens affected by this audit:

- Worker login/session shell.
- Clock/check-in.
- GPS consent.
- Safety Brief.
- Projects tab.
- Worker project detail.
- Active project checkout.
- Tasks.
- Messages.
- Journal/media.
- Offline/reconnect banners.

Dangerous zones touched: none.

## Findings

No confirmed low-risk runtime bug was found during source audit.

Existing guardrails confirmed:

- Worker mobile top nav renders before main scroll content.
- Worker project cards use a native full-card `Link` and keep navigation actions separate.
- Project detail includes top `ProjectNavigationActions`.
- Active shift project badge is present in project cards and project detail.
- Active project flow includes a visible checkout entry point and `CheckoutModal`.
- Checkout notes are optional unless video rules require upload.
- GPS consent confirm uses checkbox plus non-empty signed name.
- Safety Brief blocks until acknowledged and uses a fullscreen mobile-safe portal.
- Tasks page keeps open/read/take/done and material task paths visible.
- Material task claim uses `/api/worker/claim-task` and offline queue fallback.
- Worker messages keep sender-or-recipient history and read updates.
- Journal and attachment viewers use `MediaViewerModal` Back handling.
- Worker upload inputs use `ACCEPT_ALL_UPLOADS` for photo/video/PDF/Word/Excel/CSV where documents are expected.
- Offline banner, pending action, upload, and shift sync states are visible from `WorkerShell`.

## Tests / Guards

Existing relevant tests:

- `tests/lib/worker-mobile-navigation.test.ts`
- `tests/lib/mobile-project-task-interactions.test.ts`
- `tests/lib/worker-checkout-action-source.test.ts`
- `tests/lib/gps-consent-ui.test.ts`
- `tests/lib/safety-acknowledgements.test.ts`
- `tests/lib/offline-field-mode-source.test.ts`
- `tests/lib/offline-readable-cache-source.test.ts`
- `tests/lib/journal-active-project-notes-source.test.ts`
- `tests/lib/upload-limits.test.ts`
- `tests/lib/worker-task-completion-modal-flow.test.ts`
- `tests/lib/message-state.test.ts`

Added source guard:

- `tests/lib/worker-critical-path-audit-source.test.ts`

## Manual QA Scope

Use the worker sections of `docs/CRITICAL_PATH_SMOKE_ALPHA7.md`:

- Login.
- GPS consent.
- Safety Brief.
- Projects tab.
- First-tap project open.
- Active project badge.
- Check-in.
- Active project view.
- Checkout.
- Task take/done.
- Material task take.
- Messages send/read.
- Journal media Back.
- Upload photo/video/PDF.
- Offline banner.
- Reconnect sync.

## Not Changed

- No payroll, archive/trash, GPS/geofence, shift calculation, RLS, Storage, schema, migrations, production data, material queue business rules, or task/message lifecycle changes.
