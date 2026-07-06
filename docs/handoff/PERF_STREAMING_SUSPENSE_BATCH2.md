# Perf: Suspense streaming — Batch 2 (Tasks, Archive, Settings, Overview, Payroll)

**Branch:** `perf/manager-streaming-suspense-batch2` (off `origin/claude/owner-dashboard-cleanup-rebased`)
**Extends:** `docs/handoff/PERF_STREAMING_SUSPENSE.md` (Batch 1 — Team/Projects/Command Center).
**Files touched:** five page files only. No data-layer, worker, or PWA files.

## Pattern (identical to Batch 1)
Each blocking `async` page becomes a **synchronous shell** that returns
`<Suspense fallback={…}><PageContent/></Suspense>`, with the original async body moved **verbatim**
into `PageContent`. The manager layout is a client component (chrome paints instantly); the Supabase
query batch now streams into the boundary instead of blocking the whole HTML response.

| Page | Before | Change | Fallback |
|---|---|---|---|
| **tasks** | async → client cmp, no header, no `loading.tsx` | sync shell + inner Suspense | inline `TasksSkeleton` |
| **archive** | async → client cmp, no header, no `loading.tsx` | sync shell + inner Suspense | inline `ArchiveSkeleton` |
| **settings** | async → client cmp, no header, no `loading.tsx` | sync shell + inner Suspense | inline `SettingsSkeleton` |
| **overview** | async, has `loading.tsx` | sync shell + inner Suspense, **reuse `./loading`** | `<OverviewLoading/>` |
| **payroll** | async, static header + `redirect()`, has `loading.tsx` | sync shell + inner Suspense, **reuse `./loading`** | `<PayrollLoading/>` |
| **schedule** | already sync + `"use client"` child | **no change** (see note) | — |

For Tasks/Archive/Settings (which had neither a boundary nor a skeleton) the fallback is a small
inline pulse skeleton — the same approach Batch 1 used for Command Center's body. For Overview/Payroll
the existing route `loading.tsx` is reused as the fallback, so there's one skeleton and the route
transition skeleton keeps working — the boundary is just made explicit in the page too.

## Wrap-whole (no header hoisting) — and why it's safe for Payroll's redirect
All five wrap the entire body (matching Team/Projects). Payroll `redirect("/overview")`s non-finance
users; that redirect is kept **inside** `PayrollPageData`, so it fires while the Suspense fallback
(the reused `PayrollLoading` skeleton) is shown — **byte-for-byte the same experience as today**, where
`payroll/loading.tsx` already flashes before the redirect. No user who gets redirected sees any page
content they didn't see before. (This is exactly why I did not hoist Payroll's header into the shell.)

## Schedule — no change needed (flagged)
`schedule/page.tsx` is already a synchronous shell that renders `<SchedulePageClient/>`, a
`"use client"` component that fetches its own data client-side. There is **no server-side `await`**
blocking the HTML — the build confirms `/schedule` prerenders as static (`○`). So it never had the
blocking-response problem the other pages did; adding a Suspense boundary would wrap nothing. Left
untouched. (Listed as an offender in the brief, but the code shows otherwise.)

## RED LINE compliance
- Pure delivery change: same queries, computation, JSX, and props to every child; only the async body
  moved into a child component behind a boundary.
- No `manager-data.ts` query logic, worker pages, or PWA files touched.
- Overview/Payroll `loading.tsx` reused, not replaced.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (none new)
- `npm test` — 920 passed (129 files)
- `npm run smoke:core` — no failures, no warnings
- **Extra (not a gate):** `npm run build` succeeds; `/tasks`, `/archive`, `/settings`, `/overview`,
  `/payroll` compile dynamic (`ƒ`); `/schedule` static (`○`, confirms it never blocked).

## Note / question
Tasks/Archive/Settings got in-page Suspense with an inline skeleton but **no `loading.tsx`** (matching
Command Center from Batch 1) — the sync shell + inner boundary is enough for the streaming outcome. If
you'd prefer they also get a route-level `loading.tsx` for the navigation-transition fallback (like
Overview/Payroll have), that's a quick add — say the word. As with Batch 1, this is a timing change
best confirmed on a real navigation (Performance panel); gates + build pass but a live-nav eyeball is
the true check.

Not merged/pushed at time of writing.
