# Perf: remove duplicate supabase.auth.getUser() on manager page loads

**Branch:** `perf/auth-getuser-dedup` (off `claude/owner-dashboard-cleanup-rebased`)
**File touched:** `src/lib/manager-data.ts` only (point diff, +41/−7).

## The bug
`supabase.auth.getUser()` is a real round-trip to the Supabase **Auth server**, not a cookie read.
Every manager page-data fetch called it **twice** back-to-back: once in the page-data function, then
again immediately inside `requireManagerContext()`, which the function calls next. That second call
added Auth-server latency to every navigation between manager pages (Team, Projects, …).

## The fix
`requireManagerContext(supabase, preresolvedAuth?)` now takes an **optional** second argument — the
`{ user, error }` a caller already fetched. When present it's used directly; when omitted it resolves
the user itself (new `resolveManagerAuth` helper) exactly as before. The three in-file page-data
functions now pass the user they already have, so each manager page load makes **one** `getUser()`
call instead of two. Nothing else changes: same `redirect("/login")` on missing/errored user, same
`redirect("/clock")` on non-manager role, same AUTH_BYPASS branches, same return shapes.

Call sites updated (all in `manager-data.ts`):
- `resolveContextOrPreview` — passes `{ user, error: authError }` it fetched.
- `resolveDeferredContextOrPreview` — passes it at both `requireManagerContext` calls.
- `getManagerWorkspaceData` — passes it at both `requireManagerContext` calls.

## Two decisions worth flagging
1. **The new param is OPTIONAL, not required.** `requireManagerContext` is exported and called from
   ~20 places **outside** this file — payroll/team/manager API routes, the `payroll/history` and
   `admin/diagnostics` pages, and `src/lib/ai/api-auth.ts` — each with a single `requireManagerContext(supabase)`
   call (they don't double-fetch, so there's no duplicate to remove there). Making the param required
   would have broken all of them (RED-LINE violation — files outside `manager-data.ts`) and two
   source-snapshot tests that assert the literal `requireManagerContext(supabase)`. Optional keeps
   every external caller byte-for-byte unchanged (`undefined` → same internal `getUser`, same behavior)
   while removing the duplicate where it actually occurs. `Parameters<typeof requireManagerContext>[0]`
   in `api-auth.ts` still resolves to the supabase client (first param unchanged).
2. **Fixed three in-file call sites, not two.** The task named `resolveContextOrPreview` and
   `resolveDeferredContextOrPreview`, but `getManagerWorkspaceData` (the main manager workspace load)
   has the **identical** double-`getUser` pattern (its own `getUser` at the top, then
   `requireManagerContext`). Since the goal is "every manager page load," and it's the same mechanical
   change in the same file, it was included. If you'd prefer to leave that one, it's a one-line revert.

## Behavior preservation (verified against the diff)
- The values passed as `preresolvedAuth` are exactly what `getUser()` returned in each function, so
  the `authError || !user` redirect and every downstream query/redirect fire identically.
- `??` short-circuits: when `preresolvedAuth` is provided, the fallback `getUser()` is never evaluated.
- No query shapes, error handling, AUTH_BYPASS logic, or return shapes changed.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (none new)
- `npm test` — 920 passed (129 files)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
