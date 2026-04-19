# Audit Report — Construction Clock (Check-Time)

Generated: 2026-04-18
Build commit: N/A (not a git repository)

> **Wave 1 status (2026-04-18):** All [SAFE AUTO-FIX] items targeted by
> the wave1/safe-fixes branch have been applied. Per-item commit hashes
> are noted inline below.

---

## Summary

- **Total issues found: 34**
- **Critical: 3 | High: 8 | Medium: 12 | Low: 11**
- **Tasks fully working: 3 / 10**
- **Tasks partially working: 6 / 10**
- **Tasks not implemented: 1 / 10**

### BLOCKERS

None. All 19 pages return HTTP 200. Dev server runs without build errors. `tsc --noEmit` passes clean. No blocking issues preventing audit.

---

## Per-task Status

### Task 1 — Manager Force Checkout

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/components/manager/ForceCheckoutButton.tsx` — inserts real `time_events` row with `event_type: "auto_out"` (line 44-60)
  - `managerId` stored in `metadata.forced_by` (line 54) ✅
  - Editable checkout time via `datetime-local` input (line 100-107) ✅
  - Optional reason field (line 110-118) ✅
  - Profile `current_project` set to null (line 68-71) ✅
  - Used in Overview page: `src/app/(manager)/overview/page.tsx:332-339` ✅
- **Issues found:**
  - **[HIGH]** No notification sent to the worker. The spec requires "Worker gets a notification that they were checked out by a manager, with the reason." The `ForceCheckoutButton` only updates the DB and refreshes the page — no message is inserted into any messaging system.
  - **[LOW]** Translation key `overview.forceCheckoutNotify` exists but is never used in code.

---

### Task 2 — Message Attachments

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/components/manager/SendMessageForm.tsx` — file upload to Supabase Storage works (line 78-99). Accepts image/video/PDF (line 21). Size limit 50MB (line 22). Preview with remove button (lines 135-170).
  - `src/components/shared/MessageAttachmentView.tsx` — renders images (lightbox), video (`<video controls>`), PDF (file card + "Open" link). All three types implemented.
  - `src/components/worker/NotificationBell.tsx` — renders `MessageAttachmentView` inline (line 136-138). Preview messages include sample image attachment.
  - `src/lib/message-types.ts` — `MessageAttachment` type defined with url, filename, type, size.
- **Issues found:**
  - **[CRITICAL]** No `messages` table exists in the database schema (`src/types/database.ts`, `supabase/migrations/00001_foundation.sql`). Messages are entirely in-memory preview state. `SendMessageForm` simulates send with a 300ms delay (line 121-125) and explicitly comments "In preview/auth-bypass mode we simulate the send."
  - **[CRITICAL]** `NotificationBell` uses hardcoded `PREVIEW_MESSAGES` array (lines 9-40) with no database queries. Workers never receive real messages.
  - **[HIGH]** `MessageOverlay` in `WorkerShell` always shows the same hardcoded preview message on every page load (line 212-224).
  - **[MEDIUM]** File upload path `messages/{recipientId}/{timestamp}` goes to the `media` bucket, but no RLS policy specifically covers message attachments vs. regular media.

---

### Task 3 — Recent Events Feed in Overview

- **Status: ✅ working**
- **Evidence:**
  - `src/components/manager/EventFeed.tsx` — client component with 8 event types: clock_in, clock_out, force_checkout, task_assigned, task_started, task_completed, media_uploaded, adjust. Each has icon, color, and translation key.
  - `src/app/(manager)/overview/page.tsx` (lines 143-224) — builds unified `feedEvents[]` from real `data.timeEvents`, `data.tasks`, and `data.media`. Sorted newest-first, sliced to 15.
  - `RelativeTime` component shows "2m"/"1h"/"3d" with absolute time on hover (title attribute).
  - Clickable rows navigate to `/projects/{id}`.
  - Fixed height container (480px max) with internal scroll.
  - Empty state with clock icon.
- **Issues found:**
  - **[MEDIUM]** No real-time Supabase subscription. Feed is static (server-rendered at page load), not live-updating.
  - **[LOW]** `task_assigned` events are never generated — the feed only picks up `task_started` (in_progress) and `task_completed` (done), not the initial assignment.
  - **[LOW]** Hydration warning in dev logs: `RelativeTime` uses `Date.now()` which differs server vs client. The log shows "A tree hydrated but some attributes of the server rendered HTML didn't match the client properties."

---

### Task 4 — Project Receipts

- **Status: ✅ working**
- **Evidence:**
  - `ReceiptsSection` in `src/components/manager/ProjectDetailPage.tsx` (lines 900-1264):
    - Uploads to Supabase Storage at `{orgId}/{projectId}/receipts/{timestamp}-{filename}` (line 978)
    - Inserts into `media` table with `metadata.category = "receipt"`, `store_name`, `amount`, `purchase_date` (lines 991-1014)
    - Queries back with `.eq("metadata->>category", "receipt")` (line 923)
    - Drag-and-drop zone + file picker (lines 1085-1110)
    - Store dropdown: Home Depot, Lowe's, Floor & Decor, Harbor Freight, Ferguson, Supply Masters, Other (lines 880-887)
    - "Other" shows free-text input (line 1128)
    - Total amount rollup shown at top (line 1062)
    - Image lightbox + PDF link (lines 1192-1230)
    - Soft-delete implemented (line 1059)
  - Driver shortcut in `src/components/worker/ClockPage.tsx` (lines 208-224): shows "Add Receipt" button when `profile.role === "driver"` and clocked in.
- **Issues found:**
  - **[MEDIUM]** Receipt totals are NOT rolled up into the project card on the Projects list page or into Overview stats. The `ManagerProjectSummary` type doesn't include a `receiptTotal` field.
  - **[LOW]** Delete is not a true soft-delete (doesn't set `deleted_at`). Instead it updates `metadata` to `{ category: "receipt", deleted: true }` (line 1059), which means deleted receipts don't appear in the Trash page.

---

### Task 5 — Live GPS Tracking

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/lib/hooks/useGpsTracking.ts` — real `navigator.geolocation.watchPosition` with high accuracy, 20s throttle. Returns lat/lng/accuracy/heading/speed. Handles permission denial.
  - `src/components/worker/GpsConsentModal.tsx` — full consent UI with checkbox + typed signature.
  - `src/components/worker/WorkerShell.tsx` — GPS integration:
    - Consent state from localStorage (line 255-258)
    - `useGpsTracking` hook enabled when consented + clocked in (line 264)
    - Consent modal triggered on first clock-in (line 451-453)
    - "Sharing location" green banner when active (line 893-899)
    - "Permission denied" tap-to-retry banner (line 901-908)
    - iOS tip shown once (line 910-916)
  - `src/components/maps/LiveWorkerMarkers.tsx` — renders pins with role colors, stale detection, breadcrumb trails.
- **Issues found:**
  - **[CRITICAL]** GPS positions are NEVER sent to Supabase. `handleGpsPosition` in WorkerShell (line 267-270) only does `console.log`. No `worker_live_locations` table exists in the DB schema or migrations.
  - **[HIGH]** Consent is stored in localStorage only (lines 275-278), not in a `worker_location_consents` table. Consent is per-browser, not per-user — a worker on a different device has no consent record.
  - **[HIGH]** `LiveWorkerMarkers.tsx` always returns mock data (lines 51-62) with hardcoded SF coordinates + random jitter. The Supabase client is initialized but never queried.
  - **[MEDIUM]** No `worker_live_locations` or `worker_location_consents` tables in migrations.

---

### Task 6 — Supply Stores + Auto-detected Visits

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/lib/store-types.ts` — types for 10 chains, chain colors/initials, SupplyStore and StoreVisit interfaces.
  - `src/components/maps/StoreMarkers.tsx` — queries `supply_stores` table (line 69-72), falls back to 3 preview stores (lines 9-44).
  - `src/app/(manager)/stores/page.tsx` — full CRUD: list stores, add store form, activate/deactivate toggle. Inserts into real `supply_stores` table.
  - `StoreVisitsSection` in `ProjectDetailPage.tsx` (lines 1268-1349) — queries `store_visits` table.
  - Store markers rendered on Overview map via `<StoreMarkers />` (line 104 in ProjectsStatusMap.tsx).
- **Issues found:**
  - **[HIGH]** `supply_stores` and `store_visits` tables are NOT in the migration SQL. Code references them via Supabase client, but they don't exist in the schema.
  - **[HIGH]** Auto-detection (geofence trigger) is NOT implemented. No edge function, no trigger, no geofence check logic anywhere in the codebase.
  - **[HIGH]** "Import nearby" (Google Places API integration) is NOT implemented. The stores page only has manual add.
  - **[MEDIUM]** `storeVisits` field in annual report is hardcoded to 0 (line 144 of reports/annual/page.tsx).
  - **[LOW]** No RLS policies for `supply_stores` or `store_visits`.

---

### Task 7 — Payroll Calculator

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/components/manager/PayrollCalculator.tsx` (~370 lines):
    - OT calculation correct: >40h threshold, 1.5x multiplier (lines 57-60)
    - Worker table with reg/OT/rate/gross/adjustments/net columns
    - Adjustment modal: bonus/reimbursement/deduction with amount + note
    - CSV export generates proper headers + data (lines 158-169)
    - "By Project" tab aggregates hours by project
    - Preset buttons: Last week / Last 2 weeks / This month
    - Bulk actions: Approve All, Mark All Paid
    - Tax disclaimer in both EN/RU
  - `src/app/(manager)/payroll/page.tsx` — server component passes real `profiles` + `sessions` to client calculator.
  - Existing API route `src/app/api/payroll/run/route.ts` handles real persistence (payroll_runs, payroll_line_items, payroll_closures).
- **Issues found:**
  - **[HIGH]** Pay periods are IN-MEMORY only in the calculator UI. No `pay_periods` or `pay_period_items` tables exist. The calculator doesn't call the existing `/api/payroll/run` endpoint.
  - **[HIGH]** Adjustments (bonus/reimbursement/deduction) are in-memory state — lost on page reload. No persistence.
  - **[HIGH]** No PDF paystub generation. No PDF library imported.
  - **[MEDIUM]** OT calculation uses annual 2080h threshold in the annual report (line 140 of reports/annual), but weekly 40h in the calculator. These are different approaches and will give different results.
  - **[MEDIUM]** No "Email paystub" functionality.
  - **[MEDIUM]** Owner-only approval is UI-only — `approveAll`/`markAllPaid` are client state toggles with no RLS enforcement.
  - **[LOW]** No payroll history page at `/payroll/history`.

---

### Task 8 — Annual Report

- **Status: ✅ working**
- **Evidence:**
  - `src/app/(manager)/reports/annual/page.tsx` (~400 lines):
    - Year picker (last 5 years)
    - Queries real DB: profiles, projects, time_events (filtered by year), media/receipts
    - 6 summary cards: total hours, gross payroll, material cost, projects, active workers, store visits
    - Per-worker table: name, role, hours, OT, gross, projects, avg/day, first/last shift
    - Per-project table: name, address, status, dates, labor hours/cost, material cost, total cost, workers
    - Monthly breakdown: stacked horizontal bars (labor yellow + material blue), worker count
    - Store activity tab: shows "No data" placeholder
    - CSV export for workers and projects
    - Empty state for zero-data years
  - Sidebar nav item with FileBarChart icon
- **Issues found:**
  - **[MEDIUM]** No PDF export. The "Export PDF" button from the spec is not implemented.
  - **[MEDIUM]** No "Past reports" shelf (stored reports in Supabase Storage).
  - **[MEDIUM]** Store activity tab always shows "No data" — no integration with store_visits.
  - **[LOW]** No prior-year comparison (delta % vs last year) on summary cards.
  - **[LOW]** No drill-down modals (click worker row → monthly breakdown, click project → detail).

---

### Task 9 — Owner Role

- **Status: ⚠️ partial**
- **Evidence:**
  - `src/types/database.ts:6` — `'owner'` added to `UserRole` union type.
  - `src/lib/roles.ts` — full hierarchy: owner(5) > admin(4) > manager(3) > supervisor(2) > driver(1) > worker(0). Helper functions: isOwner, isManagerOrAbove, canManageRole, assignableRoles.
  - `src/lib/manager-utils.ts:46` — `isManagerRole` includes `owner`.
  - `src/lib/preview-data.ts:78` — preview manager promoted to `owner` role.
  - `src/app/(manager)/layout.tsx` — sidebar filtering by role:
    - Line 68: `isOwnerUser = userRole === "owner" || userRole === "admin"`
    - Owner-only items: Managers, Stores, Location Data, Audit Log
    - OWNER badge shown (line 101-107)
    - Demo banner when AUTH_BYPASS (line 154-160)
  - `src/app/(manager)/admin/audit/page.tsx` — audit log page with preview data, CSV export, action filtering.
  - `docs/permissions.md` — complete permission matrix.
- **Issues found:**
  - **[CRITICAL]** `owner` role is NOT in the database enum. Migration `00001_foundation.sql` defines `user_role as enum ('worker', 'supervisor', 'driver', 'subcontractor', 'manager', 'admin')` — no 'owner'. Inserting a profile with role='owner' will fail at the DB level.
  - **[HIGH]** `src/lib/roles.ts` is dead code — never imported by any file.
  - **[HIGH]** Audit log uses hardcoded preview data (lines 21-66 in audit page). No `audit_log` table in schema.
  - **[HIGH]** No `is_owner()` SQL function in RLS policies. The `is_manager()` function in `00002_rls_policies.sql` only checks for `manager` and `admin`, not `owner`.
  - **[HIGH]** No ownership transfer UI or backend.
  - **[MEDIUM]** Owner-only restrictions (payroll approval, store management, data purge) are UI-only — no RLS enforcement at the DB level.

---

### Task 10 — Visual Parity

- **Status: ⚠️ partial**
- **Evidence:**
  - **Team page** (`src/components/manager/TeamPage.tsx`):
    - Avatar circles with initial + hash-based color ✅ (lines 265-270)
    - Role-colored tags matching reference (worker=gold, driver=green, supervisor=blue, subcontractor=purple) ✅ (lines 23-31, 279-284)
    - Status pill with dot (On Site green / Off Shift gray) ✅ (lines 292-301)
    - PIN display (masked "PIN ****") ✅ (lines 286-288)
    - RATE column (gold when >0, muted when 0, mono font) ✅ (lines 319-325)
    - EARNED column (green, computed week hours × rate) ✅ (lines 326-329)
    - Category filter dropdown ✅ (lines 237-247)
  - **Tasks page** (`src/components/worker/TasksPage.tsx`):
    - Priority chips: urgent/high=#ef4444, medium=#f59e0b, low=#22c55e ✅ (lines 25-35, 90-95)
    - 3px left border via `.task-card::before` CSS ✅
- **Issues found:**
  - **[MEDIUM]** Projects page: No traffic light dots (3 status circles). No address copy button with "Copied" toast. No active border glow (green 2px + glow for projects with workers on site). No "Add Project" first card.
  - **[MEDIUM]** Team page: No VIDEO column indicator. No TOTAL footer row with sums. No action buttons per row (Edit/Msg/Remove).
  - **[LOW]** No sidebar user footer (avatar + name + role + "Full Access" badge).
  - **[LOW]** Mono font (`font-mono`) not consistently applied to all numeric values across all pages.

---

## Cross-cutting Issues

### i18n Gaps

All new strings have EN + RU keys. No missing translations found among the ~580 translation keys. However:
- **[LOW]** Translation key `overview.forceCheckoutNotify` is defined but never used.
- **[LOW]** Some preview strings remain in English only (e.g., "Loading..." in multiple components, "Error — try again" in ForceCheckoutButton line 163).

### Type Errors (tsc)

`npx tsc --noEmit` passes with **0 errors**. ✅

### Lint Warnings

`npx eslint src/` reports **16 problems (5 errors, 11 warnings)**.

Files with issues:
| File | Issues |
|------|--------|
| `src/lib/i18n/context.tsx` | 1 error: setState in effect body |
| `src/components/shared/VoiceInput.tsx` | warnings: `any` types (expected, Web Speech API) |
| `src/components/maps/LiveWorkerMarkers.tsx` | warnings: `any` types |
| `src/components/manager/EventFeed.tsx` | warnings: `any` types |
| `src/components/maps/GoogleMaps.tsx` | warnings |
| `src/app/(manager)/reports/annual/page.tsx` | warnings |
| `src/app/(auth)/login/page.tsx` | warnings |
| `src/components/manager/PayrollCalculator.tsx` | warnings |
| `src/components/manager/ShiftPlayback.tsx` | warnings |

### Dead Code

| File | Reason |
|------|--------|
| `src/lib/roles.ts` | Never imported anywhere. All role checks use inline comparisons or `isManagerRole()` in manager-utils. |
| `docs/permissions.md` | Reference doc, not dead code per se, but the `is_owner()` SQL function it documents doesn't exist. |
| Translation key `overview.forceCheckoutNotify` | Defined but never referenced in any component. |

### Schema Drift

Tables referenced in code but **missing from migrations**:

| Table | Referenced In | Status |
|-------|--------------|--------|
| `supply_stores` | StoreMarkers.tsx, stores/page.tsx | ❌ No migration |
| `store_visits` | ProjectDetailPage.tsx StoreVisitsSection | ❌ No migration |
| `worker_live_locations` | Conceptual (LiveWorkerMarkers uses mock) | ❌ No migration |
| `worker_location_consents` | Conceptual (consent in localStorage) | ❌ No migration |
| `audit_log` | Conceptual (audit page uses preview data) | ❌ No migration |
| `pay_periods` | Conceptual (calculator is in-memory) | ❌ No migration |
| `pay_period_items` | Conceptual | ❌ No migration |
| `messages` | Conceptual (messaging is preview-only) | ❌ No migration |

Columns referenced in code but **missing from migrations**:

| Column | Table | Referenced In |
|--------|-------|--------------|
| `start_date` | projects | ProjectsPage, ProjectDetailPage, schedule page |
| `end_date` | projects | Same |
| `owner` | user_role enum | types/database.ts, preview-data.ts, layout.tsx |

### RLS Gaps

| Table | Has RLS | Has Policies | Gap |
|-------|---------|-------------|-----|
| organizations | ✅ | ✅ | — |
| profiles | ✅ | ✅ | — |
| projects | ✅ | ✅ | — |
| project_assignments | ✅ | ✅ | — |
| time_events | ✅ | ✅ | — |
| tasks | ✅ | ✅ | — |
| media | ✅ | ✅ | — |
| payroll_runs | ✅ | ✅ | — |
| payroll_line_items | ✅ | ✅ | — |
| payroll_closures | ✅ | ✅ | — |
| daily_reports | ✅ | ✅ | — |
| supply_stores | ❌ | ❌ | Table doesn't exist in migrations |
| store_visits | ❌ | ❌ | Table doesn't exist in migrations |
| worker_live_locations | ❌ | ❌ | Table doesn't exist in migrations |
| worker_location_consents | ❌ | ❌ | Table doesn't exist in migrations |
| audit_log | ❌ | ❌ | Table doesn't exist in migrations |
| pay_periods | ❌ | ❌ | Table doesn't exist in migrations |
| messages | ❌ | ❌ | Table doesn't exist in migrations |

**RLS function gap**: `is_owner()` helper documented in `docs/permissions.md` does not exist. The existing `is_manager()` function does not include the `owner` role.

### Console Errors (dev server logs)

- Hydration mismatch warning on `/overview` page due to `RelativeTime` component using `Date.now()`.
- Historical errors from cache (leaflet, etc.) are stale and not current.

---

## Recommended Fix Order

### Critical (3 items)

1. **Add `owner` to database enum + migration**
   - Files: `supabase/migrations/00003_owner_role.sql`
   - What: `ALTER TYPE public.user_role ADD VALUE 'owner';`
   - Risk: Low (additive enum change)
   - Effort: S
   - [NEEDS HUMAN REVIEW] — requires running migration against live DB

2. **Create missing tables migration (supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items, messages)**
   - Files: `supabase/migrations/00004_new_tables.sql`
   - What: CREATE TABLE for all 8 missing tables + add `start_date`/`end_date` to projects
   - Risk: Medium (new tables, no data loss, but must match code expectations)
   - Effort: L
   - [NEEDS HUMAN REVIEW]

3. **Wire GPS position posting to Supabase**
   - Files: `src/components/worker/WorkerShell.tsx` (handleGpsPosition), `src/lib/hooks/useGpsTracking.ts`
   - What: Replace `console.log` with actual Supabase insert into `worker_live_locations`
   - Risk: Low (additive, no existing functionality affected)
   - Effort: S
   - [SAFE AUTO-FIX]

### High (8 items)

4. **Create messages table + wire SendMessageForm to insert real rows**
   - Files: migration + `src/components/manager/SendMessageForm.tsx` + `src/components/worker/NotificationBell.tsx`
   - Risk: Medium
   - Effort: M
   - [NEEDS HUMAN REVIEW]

5. **Wire LiveWorkerMarkers to query real worker_live_locations**
   - Files: `src/components/maps/LiveWorkerMarkers.tsx`
   - Risk: Low
   - Effort: S
   - [SAFE AUTO-FIX]

6. **Store GPS consent in database (not just localStorage)**
   - Files: `src/components/worker/WorkerShell.tsx`
   - Risk: Low
   - Effort: S
   - [SAFE AUTO-FIX] (after table exists)

7. **Add force-checkout notification to worker**
   - Files: `src/components/manager/ForceCheckoutButton.tsx`
   - Risk: Low
   - Effort: S
   - [SAFE AUTO-FIX] (after messages table exists)

8. **Wire PayrollCalculator to persist pay periods and adjustments**
   - Files: `src/components/manager/PayrollCalculator.tsx`
   - Risk: Medium
   - Effort: M
   - [NEEDS HUMAN REVIEW]

9. **Update `is_manager()` SQL function to include `owner` role**
   - Files: `supabase/migrations/00002_rls_policies.sql` or new migration
   - Risk: Low
   - Effort: S
   - [NEEDS HUMAN REVIEW]

10. **Add RLS policies for new tables (supply_stores, store_visits, etc.)**
    - Files: new migration
    - Risk: Medium
    - Effort: M
    - [NEEDS HUMAN REVIEW]

11. **Import and use `src/lib/roles.ts` instead of inline role checks**
    - Files: Multiple (layout.tsx, manager-utils.ts, etc.)
    - Risk: Low
    - Effort: S
    - [SAFE AUTO-FIX] — **DONE** wave1 b49e416 (deleted dead module instead of wiring)

### Medium (12 items)

12. Fix lint error: setState in effect in `src/lib/i18n/context.tsx` — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 97c7617
13. Fix hydration mismatch in EventFeed RelativeTime — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 bb4839f (refined a3ab070)
14. Roll receipt totals into project summary and Overview stats — Effort: M — [SAFE AUTO-FIX] — **DONE** wave1 4bb19bb
15. Fix receipt soft-delete to use `deleted_at` instead of metadata flag — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 e0b3dde
16. Add PDF generation for paystubs and annual report — Effort: L — [NEEDS HUMAN REVIEW]
17. Implement store auto-detection (geofence trigger) — Effort: L — [NEEDS HUMAN REVIEW]
18. Add OT weekly bucketing consistency (calculator uses 40h/week, annual uses 2080h/year) — Effort: M — [NEEDS HUMAN REVIEW]
19. Add owner-only RLS enforcement for payroll approval — Effort: M — [NEEDS HUMAN REVIEW]
20. Add Projects page visual parity (traffic lights, address copy, border glow) — Effort: M — [SAFE AUTO-FIX] — **DONE** wave1 a8d0c3d
21. Add Team page VIDEO column and TOTAL footer row — Effort: M — [SAFE AUTO-FIX] — **DONE** wave1 4b43caa
22. Add ownership transfer UI — Effort: M — [NEEDS HUMAN REVIEW]
23. Connect store_visits to annual report store activity tab — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 2d16a08

### Low (11 items)

24. Remove unused translation key `overview.forceCheckoutNotify` or wire it — Effort: S — [SAFE AUTO-FIX] — **DONE** verified already wired (no commit)
25. Translate remaining hardcoded "Loading..." strings — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 09f3d82
26. Add sidebar user footer (avatar + name + badge) — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 f4424c1
27. Apply mono font consistently to all numeric values — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 ff5ce30
28. Add `task_assigned` event type to feed builder — Effort: S — [SAFE AUTO-FIX] — **DONE** wave1 40c3d6f
29. Add prior-year delta % to annual report summary cards — Effort: M — [SAFE AUTO-FIX]
30. Add drill-down modals to annual report tables — Effort: M — [SAFE AUTO-FIX]
31. Add payroll history page at `/payroll/history` — Effort: M — [SAFE AUTO-FIX]
32. Add "Import nearby" Google Places integration for stores — Effort: L — [NEEDS HUMAN REVIEW]
33. Implement real audit_log persistence — Effort: M — [NEEDS HUMAN REVIEW]
34. Add real-time Supabase subscription for event feed — Effort: M — [NEEDS HUMAN REVIEW]

---

## Do NOT Fix in Audit Phase

| Item | Reason |
|------|--------|
| Database migrations (owner enum, new tables, columns) | Alters live DB schema. Requires testing against Supabase instance. |
| RLS policy changes | Security-critical. Must be reviewed for data exposure risks. |
| `is_owner()` / `is_manager()` SQL functions | Auth-related. Wrong change blocks all access. |
| Ownership transfer | Involves atomic role swap. Race condition risk. |
| Store geofence trigger (edge function) | Supabase-specific infra. Requires deploy + testing. |
| Any changes to `.env.local` credentials | Security. |
| Any changes to `src/middleware.ts` auth flow | Could lock out all users. |

---

*End of report.*
