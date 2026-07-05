# Polling Dedup Batch C-M4/M5

Date: 2026-07-05
Branch: `hygiene/polling-dedup-batch1`
Base: `origin/claude/owner-dashboard-cleanup-rebased` at `863b323799896dd7934dbcd3ce2d62690e9ad060`

## Scope

Changed:

- `src/components/maps/LiveWorkerMarkers.tsx`
- `src/components/manager/ManagerWorkAlertBell.tsx`

Not changed:

- Worker flow, `/clock`, `WorkerShell`, worker offline queues.
- Payroll routes.
- Overview closed-shift alert logic.
- `BulkMessageComposer` polling. It is not an identical alert query: it reads sent-message history by `sender_id`, with a different projection and `historyLimit`, and the component also owns manager offline send queue behavior.

## C-M4 Live Map Waterfall

File: `src/components/maps/LiveWorkerMarkers.tsx`

Before:

- `profiles` read for currently clocked-in workers.
- Then serialized reads:
  - `worker_live_locations`, up to `2 * clockedIn.length` rows.
  - `worker_location_consents`, rows for current worker ids.
  - `projects`, rows for distinct current project ids.

After:

- `profiles` remains first because it supplies worker/project ids.
- The independent `worker_live_locations`, `worker_location_consents`, and `projects` reads now run in one `Promise.all`.

Measurement:

- Network request count and row payload are intentionally unchanged for visible UI parity.
- Serialized chain removed: `worker_live_locations -> worker_location_consents -> projects`.
- Post-profile critical path is reduced from `locations latency + consents latency + projects latency` to `max(locations, consents, projects)`.
- For `W` clocked-in workers and `P` active current projects, row payload remains up to `2W` location rows, consent rows for those workers, and `P` project rows.

Commit:

- `9ac800c3ba27ea47e5f704a9dd83153cc768a576` - `perf(map): parallelize live worker marker reads`

## C-M5 Manager Alert Poll Dedup

File: `src/components/manager/ManagerWorkAlertBell.tsx`

Exact duplicate poll pair:

- `messages.select("*").eq("recipient_id", profile.id).order("created_at", desc).limit(25)`
- `tasks.select("id, title, project_id, status, due_date, created_at, updated_at, metadata").eq("org_id", profile.org_id).eq("assigned_to", profile.id).is("deleted_at", null).in("status", ["pending", "in_progress"]).order("created_at", desc).limit(25)`

Before:

- Every visible manager surface with the manager layout owned its own alert realtime channel and 30-second fallback poll.
- With `N` visible manager surfaces for the same profile: `N` message selects plus `N` task selects every 30 seconds.
- Row ceiling every 30 seconds: up to `25N` message rows plus `25N` task rows.

After:

- One visible manager surface is elected as the alert poll owner per manager profile.
- The owner keeps the same realtime subscriptions and the same effective 30-second fallback poll.
- Other visible surfaces subscribe through `BroadcastChannel` and apply the owner snapshot.
- Visibility refreshes are still requested when a subscriber becomes visible.
- If `BroadcastChannel` or localStorage ownership is unavailable, the code falls back to the previous per-tab polling behavior rather than leaving alerts stale.

Measurement:

- Eliminated duplicate requests per 30 seconds: `(N - 1)` message selects and `(N - 1)` task selects.
- Two visible manager surfaces: 4 selects -> 2 selects, up to 100 rows -> up to 50 rows, 50% request/row-payload reduction.
- Three visible manager surfaces: 6 selects -> 2 selects, up to 150 rows -> up to 50 rows, 67% request/row-payload reduction.
- Data freshness remains the same for the owner poll: one 30-second fallback interval plus realtime-triggered reloads.

Commit:

- `9c83541316a2049da372ace67c2038d51e93b261` - `perf(manager): dedupe work alert polling`

## Gates

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 7 existing warnings, 0 errors.
- `npm test`: passed, 124 files and 886 tests.
- `npm run smoke:core`: passed at `2026-07-05T22:59:46.850Z`, `failures: []`, `warnings: []`.

## Stop Point

No merge, push, or deploy performed.
