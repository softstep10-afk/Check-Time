# Hygiene pair — org-timezone constant consolidation + dead styling branch

**Branch:** `hygiene/tz-const-dedup` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** pure hygiene. No timezone VALUE changed; no display behavior changed anywhere.

---

## A) Consolidate the duplicate org-timezone constants

Three modules each hardcoded the same literal `"America/Los_Angeles"`:

| Module | Constant | Before | After |
|---|---|---|---|
| `src/lib/worker-utils.ts:502` | `ORG_TIMEZONE` (canonical, exported) | `"America/Los_Angeles"` | **unchanged** — single source of truth |
| `src/lib/ai/service.ts:54` | `ORG_TIME_ZONE` (exported) | `"America/Los_Angeles"` | `= ORG_TIMEZONE` |
| `src/lib/manager-utils.ts:274` | `DEFAULT_PAYROLL_TIME_ZONE` (module-private) | `"America/Los_Angeles"` | `= ORG_TIMEZONE` |

The duplicate string literal is now gone from both consumers — both derive from the one canonical
`worker-utils.ORG_TIMEZONE`. The two local names (`ORG_TIME_ZONE`, `DEFAULT_PAYROLL_TIME_ZONE`) are
kept as aliases so the public export surface and semantic naming are byte-for-byte preserved; only
their right-hand side changed. Value is identical, so every formatter/day-key computation produces
the same output.

### Import-boundary check (the careful part)
The task flagged a server/client bundle risk. Verified it does **not** apply here, so **no
`lib/org-timezone.ts` extraction was needed**:

- `worker-utils.ts` is **client-safe** — no `"use client"`, no `import "server-only"`, and its only
  imports are `import type` (erased at compile). So any module, server or client, can import from it.
- `manager-utils.ts` **already** imports from `worker-utils` (`parseGeoPoint`, line 15) — added
  `ORG_TIMEZONE` to that existing import. No new coupling.
- `ai/service.ts` already pulls `worker-utils` transitively (via `manager-utils`). Added a direct
  `import { ORG_TIMEZONE }`. `ai/service.ts` is server-side; importing a client-safe leaf is fine.
- **No circular import:** `worker-utils` imports neither `manager-utils` nor `ai/service`
  (grep-verified), so it stays a leaf.

The earlier `SERVER_TZ_FIX.md` note (constant "cannot import the existing `ORG_TIME_ZONE` from
`ai/service.ts` because that file is server-only") describes the *opposite* direction — a client-safe
file importing a server-only one. We consolidate the other way (server/shared code → the client-safe
canonical), which has no boundary problem.

## B) Remove the dead "all-reviewed" green styling branch

**File:** `src/app/(manager)/overview/page.tsx`, closed-shift alerts section only.

### Proof of unreachability (verified before deleting)
- `flaggedClosedShifts` filter (line 279) is
  `.filter((s) => s.review.status !== "normal" && !s.reviewed)` — reviewed shifts are dropped
  upstream (commit `5985463`).
- `closedShiftAlerts = flaggedClosedShifts.slice(0, 8)` → every element has `reviewed === false`.
- The section only renders inside `closedShiftAlerts.length > 0`.
- Therefore `unreviewedClosedCount === closedShiftAlerts.length > 0`, so
  `hasUnreviewedClosed` was **always `true`** inside the block → the `? red : green` **`false`
  (green) branches could never execute.** This is exactly the "unreachable-by-design" tidy-up noted
  in `HIDE_REVIEWED_ALERTS.md` (step-3 note).

### Change
- Collapsed the three `hasUnreviewedClosed ? <red> : <green>` ternaries (section `background`,
  `borderColor`, and the `<h2>` `color`) to their red constants — **identical to the value the live
  `true` branch already produced.** Rendered output is unchanged.
- Removed the now-orphaned `unreviewedClosedCount` and `hasUnreviewedClosed` locals (they only fed
  the dead branch; leaving them would trip `no-unused-vars`). Updated the adjacent comment.
- **Left untouched:** the `commandCandidates` risk-queue filter (`closedShiftAlerts.filter((s) =>
  !s.reviewed)`, line 340) and the `reviewed={session.reviewed}` ack-button prop — both are outside
  the dead branch and still correct.

### Test update
`tests/lib/owner-dashboard-cleanup.test.ts` had a source-snapshot case that pinned the exact removed
lines (`const unreviewedClosedCount…`, `const hasUnreviewedClosed…`, the green `rgba(15,168,120,.22)`).
Rewrote that case to assert the new invariant instead: upstream exclusion filter present, section
renders the red constants, the green styling + flag are gone, ack-button `reviewed` prop still wired.

## RED LINE compliance
- No timezone value changed anywhere.
- No display behavior changed: Part A is value-identical; Part B's collapsed ternaries emit the same
  colors the reachable branch already emitted.
- No unrelated functionality removed. Diff is 4 files, +27/−28.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (unchanged; none in touched files)
- `npm test` — 886 passed (124 files)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
