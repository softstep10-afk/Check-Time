# Hide reviewed shifts from the Overview closed-shift alerts block

**Branch:** `feature/hide-reviewed-alerts` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** one file — `src/app/(manager)/overview/page.tsx`, closed-shift alerts block only.

## Behavior change
Previously a reviewed (acknowledged) closed shift stayed in the Overview alerts block —
dimmed, sorted to the bottom, with a green "reviewed" badge. Per the owner's decision, once a
shift is marked reviewed it now **leaves the block entirely**. That history stays reachable from
the worker's own page and the Timeline, not the Overview risk band.

## Changes (minimal diff)
1. **Exclude reviewed** — the `closedShiftAlerts` filter now drops reviewed sessions:
   `.filter((s) => s.review.status !== "normal" && !s.reviewed)`. Reviewed shifts never enter the
   list, so they never render.
2. **Removed the now-dead reviewed-last sort tiebreak** (`left.reviewed !== right.reviewed …`) —
   every survivor is unreviewed, so it could never fire.
3. **Simplified the per-row reviewed-specific styling** (all keyed on `session.reviewed`, now always
   false): article `borderColor` → red constant; removed the `opacity: reviewed ? 0.72 : 1`; status
   text/dot color → `SHIFT_REVIEW_COLOR[status]`; the status pill → red constant + `notReviewed`
   label.
4. **Updated the stale comment** ("still listed for the record, but no longer alarming") to describe
   the new exclude-entirely behavior.

## Kept and verified (step 3)
- `session.reviewed` is still computed and used: the new exclusion filter, the `unreviewedClosedCount`
  filter, the `commandCandidates` risk-queue filter, and the `ShiftReviewAckButton reviewed={…}` prop
  (now always `false`, so each row's button offers "mark reviewed").
- `unreviewedClosedCount` / `hasUnreviewedClosed` and `commandCandidates` / `needsReviewCount` remain
  correct. With reviewed shifts excluded upstream, the downstream `!reviewed` filters are no-ops but
  still accurate (`unreviewedClosedCount === closedShiftAlerts.length`).
- **Note:** because the block now only renders when unreviewed alerts exist, `hasUnreviewedClosed` is
  always `true` inside it, so the section-level green "all-reviewed / calm" styling branch is now
  unreachable-by-design. The counter flag was retained (per step 3, "verify the counters remain
  correct") rather than stripped — leaving it avoids orphaning the variable and keeps the diff to the
  reviewed-specific per-row styling the task named. Collapsing that section ternary to the red state
  and dropping the flag is an optional future tidy-up.

## Step 4 — is a mistaken "reviewed" click recoverable?
**Yes, via the Timeline page.** `ShiftReviewAckButton` is rendered on two surfaces:
- **`/timeline`** (`timeline/page.tsx`, ~L366 and ~L491): shown for any flagged closed shift
  (`review.status !== "normal"`), **not** filtered by reviewed state — so a reviewed shift still
  appears there with the ack toggle (plus a "reviewed <date>" chip). The button is a bidirectional
  toggle (mark reviewed ↔ mark needs review), so an accidental "reviewed" on Overview can be undone
  on the Timeline.
- **Overview** — now only for unreviewed shifts (reviewed ones are excluded).
- **Team Member page** — does **not** render `ShiftReviewAckButton`; it only reads acknowledgements
  to filter its own payroll-review view. So recovery is not available there, but it is on the
  Timeline.

No new UI was built (verify-only, as instructed).

## RED LINE
Only the Overview alerts block logic/styling was touched. `deriveShiftReview`, the ack metadata
format, and every other surface (Timeline, Team Member, ShiftReviewAckButton component) are
unchanged.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 886 passed (124 files)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
