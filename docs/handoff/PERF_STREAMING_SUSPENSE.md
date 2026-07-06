# Perf: React Suspense streaming for manager Team / Projects / Command Center

**Branch:** `perf/manager-streaming-suspense` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `37bb6b6`)
**Files touched:** the three page files only. No data-layer, dependency, or worker changes.

## What was blocking
`(manager)/layout.tsx` is a **client** component — the sidebar/nav/header already paint instantly
(profile loads in a `useEffect`), so the chrome was never the blocker. The blocker was the page
server components awaiting the Supabase workspace batch before rendering anything.

- **Command Center** had **no `loading.tsx`** and was one big `async` page: it `await`ed
  `getProjectsPageData()` and ran all its computation before the first byte of the page — including
  its own static header. This is the page that genuinely showed nothing for ~1–2s.
- **Team** and **Projects** already had `loading.tsx`, so Next already wrapped them in Suspense and
  streamed a skeleton. This change makes that boundary explicit in-page and consistent with Command
  Center (see the note at the bottom).

## The change — sync shell + `<Suspense>` around an async data component
The canonical Next App Router streaming split. No new dependencies (built into Next 16).

### `team/page.tsx` / `projects/page.tsx`
The default export becomes **synchronous** and returns:
```tsx
<Suspense fallback={<TeamLoading />}>   // reuses the existing ./loading skeleton
  <TeamRouteContent />                  // the original async body, moved verbatim
</Suspense>
```
`TeamRouteContent` / `ProjectsRouteContent` hold the exact original code (`getTeamPageData()` /
`getProjectsPageData()` → `hasFinanceAccess` → build summaries → render the client page). The route
`loading.tsx` skeletons are **reused as the fallback** (imported from `./loading`), so there's one
skeleton, no duplication, and the existing route-transition skeleton keeps working — not fought.

### `command-center/page.tsx`
The default export stays `async` but now only `await`s the **fast** `getServerLocale()` (a cookie
read, no DB), then paints the **real static header immediately** and streams the rest:
```tsx
<div className="mx-auto max-w-[1500px] space-y-6 p-5">
  <section> …real eyebrow/title/description/hint + Overview/Timeline links… </section>
  <Suspense fallback={<CommandCenterBodySkeleton />}>
    <CommandCenterBody locale={locale} text={text} />
  </Suspense>
</div>
```
`CommandCenterBody` is `async` and contains the **unchanged** `getProjectsPageData()` fetch, the
`worker_live_locations` read, every derivation (sessions, tasks, dispatch, live workers, risk queue,
GPS freshness…), and all the data sections — moved verbatim, returning a fragment so the outer
`space-y-6` spacing is preserved (Suspense/Fragment add no DOM nodes). Added a lightweight
`CommandCenterBodySkeleton` matching the section layout. This page gains real streaming: header now,
data when the batch resolves.

## RED LINE compliance
- **Pure delivery change.** Same queries, same computation, same JSX, same props to every child
  component. Verified in the diff: the Command Center computation block is untouched — only the
  function boundary and the header's position moved.
- No worker-side / offline files touched; no PWA files touched.
- `loading.tsx` skeletons reused, not replaced.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings (none new)
- `npm test` — 907 passed (127 files)
- `npm run smoke:core` — no failures, no warnings
- **Extra (not a gate):** `npm run build` succeeds; `/team`, `/projects`, `/command-center` compile
  as dynamic routes.

## Note / question
Team and Projects already streamed via their `loading.tsx` (so "user sees nothing" applied mainly to
Command Center). I still made the boundary explicit in all three per the ask — for Team/Projects it's
behavior-equivalent to what `loading.tsx` already did (belt-and-suspenders, consistent pattern). If
you'd rather I leave Team/Projects on their existing `loading.tsx` and only ship the Command Center
fix, that's a trivial trim — say the word.

This is a streaming/timing change best confirmed on a real navigation (Performance panel: shell TTFB
vs. data section fade-in). Gates + build pass, but a live-nav eyeball is the true check.

Not merged/pushed at time of writing.
