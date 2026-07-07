# Worker Media section — mobile header collision fix

**Branch:** `fix/media-header-mobile` (from `4e0570a`)
**Date:** 2026-07-06
**Symptom:** Owner's screenshot (Samsung S26 Ultra, narrow viewport): in
`WorkerProjectView` the "Медиа: N файлов" title and the three `UploadSourceButtons`
(Gallery/Camera/Files) overlap.

## Root cause (investigated before changing anything)
The header row lives in the SHARED `src/components/shared/CollapsibleSection.tsx`:
```
<div className="flex flex-wrap items-start justify-between gap-3">
  <button ... className="... min-w-0 flex-1 ...">   {/* summary/title + toggle */}
  <div className="... shrink-0 ...">{actionsNode}</div>  {/* headerAction */}
```
- summary is `flex-1 min-w-0` → it can shrink to **zero** width.
- actions is `shrink-0` → it holds its natural width.

With a single small action button this is fine. But the Media section's
`headerAction` is `UploadSourceButtons`, whose default layout is `grid grid-cols-3`
(~16–18rem wide). Because the summary is allowed to collapse to 0, the outer row never
wraps: the three-button group stays on the same line and squeezes the title to nothing,
so they overlap. It is NOT a double mount — the row layout is the whole story.

## Fix (least-invasive, opt-in, breakpoint-free)
Added an optional `wideHeaderAction?: boolean` prop to `CollapsibleSection`. When set,
the summary button uses a **min-width floor** (`min-w-[12rem]`) instead of `min-w-0`:

```
className={`-m-1 flex ${wideHeaderAction ? "min-w-[12rem]" : "min-w-0"} flex-1 ...`}
```

Only the Media section passes the prop (`WorkerProjectView.tsx`, the `id="media"`
`CollapsibleSection`).

### Why it works, and on Samsung specifically
With a 12rem floor the summary can no longer collapse to 0. So the intrinsic flexbox
line-break kicks in: when the card is too narrow to fit a readable ≥12rem title **and**
the wide button group side-by-side, the action group wraps onto its own line beneath the
title. This is driven by the actual **card width** via flex, not a `md:`/viewport media
query — so it is immune to the project's known issue that width breakpoints mis-fire on
large Samsung phones. It is also self-consistent: either there is ≥12rem for the title
inline (readable, no overlap) or it wraps — there is no width at which they collide.

### Why not the alternatives
- **Changing the shared summary default** (`min-w-0` → floor for everyone): would alter
  the wrap behavior of Materials/Receipts/Tasks/etc. — violates "must not change other
  sections." The opt-in prop leaves them byte-identical (they keep `min-w-0`).
- **A viewport breakpoint** (stack under `max-md`): unreliable on the S26 Ultra per the
  project rule; the phone can report a desktop-width viewport and never stack.
- **`w-full` buttons / growing the actions wrapper**: would visibly widen the buttons on
  desktop, breaking "on desktop nothing changes."

### Behavior after the fix
- **Desktop (wide card):** 12rem title + buttons fit inline exactly as before — unchanged.
- **Mobile (narrow card):** title on its own line; the three buttons wrap to the line
  below (their natural compact size, left-aligned), no overlap. The goal explicitly
  accepts "full-width (or wrapped)".
- Collapse/expand toggle unchanged (the summary is still the toggle button).
- Other sections: no prop → identical to before.

## Files changed
- `src/components/shared/CollapsibleSection.tsx` — new optional `wideHeaderAction` prop
  + one conditional class on the summary button.
- `src/components/worker/WorkerProjectView.tsx` — pass `wideHeaderAction` on the Media
  `CollapsibleSection`.

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 pre-existing warnings, none in changed files) |
| `npm test` | 999 passed / 999 (141 files) |
| `npm run smoke:core` | 0 failures, 0 warnings |

Stopped here — no merge, no push.

## Notes for the owner
- Branch base: task named `4e0570a`; current mainline is actually `4863d53` (the
  bell-dedup merge landed after this task was written). Branched from `4e0570a` as
  instructed — the Media files are untouched by the bell fix, so it merges cleanly onto
  `4863d53`.
- Eyeball on the S26 Ultra: open a project → Media section header should show the title
  on one line and the three upload buttons wrapped below it, no overlap; on desktop the
  header should look exactly as before (title left, buttons inline on the right).
