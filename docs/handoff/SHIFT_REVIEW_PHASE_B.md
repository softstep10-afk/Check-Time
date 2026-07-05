# Owner Shift Editing — Phase B (dashboard review queue → edit dialog)

**Branch:** `feature/shift-review-phase-b` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** display + wiring only. Reuses the existing `ShiftEditDialog` and `/api/team/edit-shift`
(from Phase A). No new API writes, no schema, no new data source.

## Data source (reused, not reinvented)
The owner dashboard (`src/app/(manager)/overview/page.tsx`, a server component) already builds the
review queue:
- `sessions = buildManagerSessions(data)` → full `ManagerSession`s.
- **`closedShiftAlerts`** (≈L258): closed sessions → `deriveShiftReview(...)` → kept when
  `status !== "normal"` → tagged `reviewed` from `buildShiftReviewAckEventIds(...)` → sorted
  (unreviewed first) → top 8.

`deriveShiftReview` (`src/lib/shift-review.ts`) already produces the three requested categories:
- **Capped by the 24h ceiling** (`durationMinutes >= EXTREME_SHIFT_MINUTES` = 1440 — the
  `max_shift_cap` `auto_out` from the cron) → escalated to `needs_review`.
- **No-GPS manual entries** (`hadGpsAtClockIn === false`, not GPS-suppressed) → `no_gps`; the
  `reviewed` flag reflects whether the closing event is acknowledged, so unacknowledged ones show
  red.
- **Existing "требует проверки" queue** → `needs_review` / `long_shift` / `video_missing` etc.

So Phase B wires the existing band, it does not add a parallel query.

## Changes
1. **New `src/components/manager/ShiftReviewEditButton.tsx`** (client) — a finance-only
   "Редактировать" button that hosts the shared `ShiftEditDialog` in edit mode for the flagged
   shift, and calls `router.refresh()` on save. (The overview is a server component, so the dialog
   needs this client boundary.) Same owner/finance gating as the TeamMemberPage affordance.
2. **`overview/page.tsx`** — in each `closedShiftAlerts` row:
   - Added the shift **date** to the summary line via `formatEventDate` (existing shared,
     locale-aware, date-only formatter), so the row shows worker · project · **date** · times ·
     reason (it previously showed time only).
   - Rendered `<ShiftReviewEditButton session={session} projects={editProjectOptions} />` in the
     row's action group, **only when `managerHasFinanceAccess`** — one click from the flagged item
     into the edit dialog, no hunting through Команда.
   - `editProjectOptions` computed once from `activeProjects` (the dialog only uses it in create
     mode; harmless in edit).

## After an edit
`onSaved` → `router.refresh()` re-runs the server component → `closedShiftAlerts` recomputes. If the
edit brings the shift below the review thresholds (e.g. a capped 24h shift edited to real times), it
drops out of the queue; otherwise it stays for the owner to acknowledge via the existing
`ShiftReviewAckButton`.

## Scope notes / decisions
- **Queue scope inherited from the existing source:** active-project sessions, top 8, within the
  loaded time-events window. Not widened (that would be inventing a parallel source).
- **Only closed shifts are editable** (matches `ShiftEditDialog`/route, which reject open shifts);
  the closed-shift alert band is exactly closed shifts, so this fits. Capped shifts close via
  `auto_out`, which the edit route accepts as the shift's closer.
- **Optional DayDetailModal tail: skipped.** Adding the affordance there would require threading
  finance access + project options through the modal and hosting a dialog instance — it grows the
  diff beyond "display + wiring". Deferred per the task's "skip if it grows the diff."

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 878 passed (121 files)
- `npm run smoke:core` — no failures, no warnings
- `npm run alpha7:predeploy` — passed

Not merged/pushed at time of writing.
