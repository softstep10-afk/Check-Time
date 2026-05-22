# Alpha-7 Performance Baseline

This file records performance observations only. It is not a product redesign plan.

## Messages / Tasks / Notifications Fix Pack

Low-risk refresh changes applied:

- Worker message history now debounces repeated message realtime INSERT/UPDATE events.
- Worker notification bell now debounces repeated message realtime INSERT/UPDATE events.
- Manager work alert bell now debounces repeated message/task realtime events.
- Existing fallback polling and full reload behavior remains in place where event payloads are not enough to rebuild the full UI state.

Visible behavior preserved:

- Realtime was not removed.
- Record visibility was not changed.
- Message/task counts still come from the existing message/task queries.
- Notifications still clear by marking signals read, not by deleting source records.

Deferred performance work:

- Message/task pagination.
- Replacing full history reloads with complete payload-based local reducers.
- App-wide realtime channel consolidation.
- Broad revalidation strategy changes.
- Large component splitting.

Known limitation:

- No authenticated production timing baseline was captured in this pass. Owner should manually compare Messages, Tasks, and Command Center after deployment.

## File / Media Reliability Fix Pack

Relevant performance observations:

- Project and task attachment upload flows still wait for Storage + metadata success before showing success.
- Private bucket open/download still uses signed URLs.
- Receipt batch signing now normalizes paths before signing, avoiding retry-like failures for bucket-prefixed legacy paths.

Deferred:

- Media pagination/lazy loading.
- Signed URL memoization beyond a single component render/effect.
- Orphan cleanup jobs.
- Storage policy or RLS performance work.

## Low-Risk Performance Fix Pack

Low-risk refresh/render changes applied:

- Worker notification bell skips 30-second fallback polling while the tab is hidden; visibility return still reloads.
- Manager work alert bell skips hidden-tab poll/realtime scheduling; visibility return still reloads.
- Worker task fallback polling skips hidden-tab intervals; realtime and visibility refreshes remain.
- Notification/work-alert state keeps existing list references when polling returns identical records.
- Command Center route refresh remains live but has a less aggressive burst debounce.
- Project media and task attachment upload debug logs were removed.

Visible behavior preserved:

- Realtime updates were not removed.
- Fallback polling still runs while pages are visible.
- Visibility return still performs a catch-up load.
- No filters, query scopes, route permissions, or visible record sets changed.

Deferred performance work:

- Pagination or virtualized large lists.
- Replacing full route refreshes with complete local reducers.
- App-wide realtime channel consolidation.
- Query scope changes.
- Database indexes or query-plan tuning.

Known limitation:

- No authenticated production performance profile was captured. Owner should manually compare Projects, Project Detail, Messages, Tasks, notification bells, Command Center, Jarvis, and file open/download after deployment.

## Mobile UX / Realtime Task Status Fix Pack

Low-risk refresh/render changes applied:

- Manager `/tasks` and `/projects/:id` no longer depend on the manager layout's broad task-triggered `router.refresh()` for task status visibility.
- Manager task board and project detail task section now merge realtime task payloads locally.
- Worker shell now merges task realtime INSERT/UPDATE payloads locally and keeps a slower fallback refresh for attachment/hydration catch-up.
- Manager work alert bell moved away from the mobile top bar to avoid covering sign out.
- Coordinate inputs use text + decimal keyboard hints so high-precision coordinates avoid browser number-step validation flicker/popups.

Visible behavior preserved:

- Realtime task updates remain enabled.
- Existing fallback refresh remains where needed for correctness.
- No task filters or visibility rules changed.
- No GPS/geofence/project lifecycle behavior changed.

Deferred performance work:

- App-wide realtime consolidation.
- Pagination or virtualization.
- Query-scope changes.
- Authenticated production runtime profiling.
