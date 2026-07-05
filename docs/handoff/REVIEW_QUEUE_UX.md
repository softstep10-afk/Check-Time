# Review-queue UX — two small fixes

Branch: `claude/review-queue-ux` (off `claude/owner-dashboard-cleanup-rebased`).
Two surgical UX fixes in the closed-shift review flow. No behavior changed
beyond the two asks; `deriveShiftReview` and the edit dialog were not touched.

## A) Overflow footer on the closed-shift alerts block

**Problem.** The Overview closed-shift alerts block silently caps at 8 rows.
With a ~100-deep queue, clearing 6 shifts just surfaced 8 "new" ones and
nothing said more were waiting.

**Fix.** `src/app/(manager)/overview/page.tsx`
- Split the existing pipeline: the full filtered + sorted result is now kept in
  `flaggedClosedShifts`; `closedShiftAlerts` is `flaggedClosedShifts.slice(0, 8)`
  — identical semantics to before, so every downstream use (command-center
  candidates, the rendered rows) is unchanged.
- `closedShiftOverflowCount = flaggedClosedShifts.length - closedShiftAlerts.length`
  counts *before* the slice. No new query — reuses the already-computed
  collection.
- A quiet footer `<Link href="/timeline">` renders under the rows only when
  overflow > 0: **"+N ещё требуют проверки"**.

**i18n.** `src/lib/i18n/translations.ts` — new key `shiftReview.moreAwaitingReview`
following the existing `shiftReview.*` pattern:
- ru: `+{count} ещё требуют проверки`
- en: `+{count} more awaiting review`

## B) Double-click on "Проверено" fired two inserts

**Problem.** `ShiftReviewAckButton.tsx` guarded on the `busy` **state**, which
only flips a render after the click. A fast double-click slipped through the
gap and wrote two `adjust` ack events (seen in prod ~2s apart).

**Fix.** `src/components/manager/ShiftReviewAckButton.tsx`
- Added a synchronous `useRef(false)` guard. `handleClick` returns immediately
  if `busyRef.current` is set, otherwise sets it in the same tick before any
  await. Reset on every exit path (read error, insert error, success).
- One logical click = one insert. No UI change — the existing `busy` state
  still drives the disabled/saving visuals.

## Gates — all green

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 7 warnings (all pre-existing, untouched files) |
| `npm test` | 124 files / 886 tests passed |
| `npm run smoke:core` | exit 0, `failures: []`, `warnings: []` |

No DB-affecting change, so no Supabase log check required.

## Commits
- `1187d29` feat(overview): show overflow count under closed-shift alerts
- `aae27a4` fix(shift-review): make ack button re-entrancy-safe against double-click

STOP — not merged, not pushed. Awaiting Andrew's review.
