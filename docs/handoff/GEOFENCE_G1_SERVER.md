# Geofencing G1 — server-side geo evaluation of open shifts

**Branch:** `feature/geofence-g1-server` (off `claude/owner-dashboard-cleanup-rebased`, HEAD `159b5de`)
**Date:** 2026-07-06
**Scope:** Server evaluation + storage only. No pushes/alerts (G3), no UI (G2).
Read-only over live tracking.

---

## Which fence fields clock-in actually uses (reused verbatim)
`src/app/api/worker/clock-in/route.ts` + `src/lib/geofence.ts`:
- **Center:** `projects.site_point`, parsed with `parseGeoPoint()` (WKB/WKT-aware).
- **Radius:** `resolveProjectRadiusM(project, appRadius)` =
  per-project `projects.gps_radius_m` → `app_settings.geofence_radius_meters`
  (via `getAppGeofenceRadiusM`, 25–500 m, 60 s cache) → legacy `projects.radius_m` → **75 m** fallback.
- **Accuracy buffer:** enforcement allows `radius + max(accuracy, 25)`.

G1 reuses **all of this**: `parseGeoPoint(site_point)` for the center,
`resolveProjectRadiusM(...)` for the radius, and the same `max(accuracy, 25)`
buffer in the evaluator — so monitoring and clock-in agree. It uses
`site_point` + `gps_radius_m`, **not** a separate fence definition.

---

## Deliverables

### 1. Table — `supabase/migrations/00047_shift_geo_events.sql` (MIRROR ONLY)
`shift_geo_events(id, org_id, shift_id, worker_id, project_id, status,
minutes_since_signal int null, distance_m double null, created_at)`.
- `status` text with `check (status in ('in_zone','out_of_zone','no_signal'))`.
- `shift_id` = the open `clock_in` `time_events.id` (matches `worker_live_locations.shift_id`);
  intentionally **not** FK-constrained (time_events is high-churn; an event insert must never lose a race).
- Indexes: `(shift_id, created_at desc)` for the status-change dedup + `(org_id, created_at desc)` for manager reads.
- **RLS (verified against repo, not invented):**
  - Writes: **service-role only** — `revoke all from anon, authenticated;
    grant select, insert to service_role;` (same shape as `push_subscriptions` 00046 / `paid_api_usage` 00045).
  - Reads: **managers** — `grant select to authenticated` + policy
    `org_id = get_user_org_id() and is_manager()` (mirrors the manager-read half of
    `wll_select_self_or_manager` in 00014 and the `audit_log` manager-read policy).
    No insert policy → no client/worker writes.
- **Graceful no-op:** owner applies by hand AFTER deploy+smoke. Until then the cron
  detects `42P01` / "does not exist" and returns `{ ok, skipped: "table_absent" }` — never throws.
- **Migration SQL path:** `supabase/migrations/00047_shift_geo_events.sql`

### 2. Evaluator — `src/lib/geofence/evaluate.ts` (pure, testable)
`evaluateShiftGeofence({ point, fence, nowMs, thresholds })` → total function, never throws.
Decision order (deliberate):
1. no live point → `skip('no_point')` (cron pre-filters these; kept for totality)
2. no fence configured → `skip('no_fence')` — G1 only produces events for geofenced projects; `no_fence` wins over staleness
3. latest point stale (`age >= noSignalAfterMs`, inclusive) → `no_signal` (distance null — stale point untrustworthy)
4. otherwise → `in_zone` if `haversine <= radius + max(accuracy, buffer)` else `out_of_zone`

Distance is straight-line `haversineMeters` (reused from `worker-utils`), sufficient at 50–500 m.
Also exports `shouldAppendGeoEvent(latestStatus, nextStatus)` = `latestStatus !== nextStatus`
(the status-change-only gate).

### 3. Config — `src/lib/geofence/config.ts`  ← **CONFIG LOCATION DECISION**
**Chose: constants module, flagged for later owner-config UI.**
Reason: the fence *radius* already flows from the org-level pattern
(`app_settings.settings` via `resolveProjectRadiusM`) and is reused as-is. The genuinely
new knobs — `GEOFENCE_NO_SIGNAL_AFTER_MS = 15 min`, `GEOFENCE_ACCURACY_BUFFER_M = 25 m`,
`GEOFENCE_SCAN_CADENCE_MS = 5 min` (informational; real cadence is vercel.json) — have
**no existing `app_settings` keys and no config UI yet**. Rather than widen the settings
schema for values nobody can set, they live in a constants module with a clear header
pointing to `app_settings.settings` as the future home when the G-config/G2 UI lands.

### 4. Cron route — `src/app/api/cron/geofence-scan/route.ts`
- `GET`, `runtime = "nodejs"`, service-role admin client.
- **Auth:** `CRON_SECRET` bearer gate (Vercel's documented cron-protection pattern).
  No protected-HTTP-cron precedent existed in the repo (`/api/keepalive` is an open
  `204`; close-overlong is a pg_cron SQL job), so this follows the platform standard.
  **→ Owner action: set `CRON_SECRET` in Vercel env so unauthorized callers are rejected.**
  When unset (local/preview) the route runs open, matching keepalive.
- **Open-shift detection:** latest `clock_in` per profile in the last 25 h with no later
  `clock_out`/`auto_out` (mirrors the close-overlong definition; 24 h cap means older shifts are auto-closed).
- **Skips shifts with zero live points entirely** (G1: web tracking may just be off — not an event).
- Batches project fences, computes status via the evaluator, and **appends a
  `shift_geo_events` row only when the status differs** from the shift's latest recorded event.
- Returns per-run stats `{ openShifts, evaluated, appended, skippedNoPoint, skippedNoFence }`.

### 5. `vercel.json`
Added `{ "path": "/api/cron/geofence-scan", "schedule": "*/5 * * * *" }` alongside keepalive.

### 6. Unit tests — `tests/lib/geofence-evaluate.test.ts` (12 tests)
inside / boundary(inclusive) / outside / accuracy-widened / stale→no_signal(null distance) /
no_signal-threshold-inclusive / missing-fence→skip / missing-fence-beats-staleness /
no-point→skip, and `shouldAppendGeoEvent` first-event/unchanged/every-transition.

---

## RED-LINE compliance (untouched)
Live-point capture/write (`worker_live_locations` insert in WorkerShell, `useGpsTracking`),
consent, clock-in/out, offline queues, `sw.ts`, payroll — all unchanged. No UI, no alerts.
Point diffs only: 1 migration, 3 new lib/route files, 1 test, 2-line `vercel.json` add.

---

## Gates (all green)
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean (the `geofence.ts` file + new `geofence/` dir coexist fine) |
| `npm run lint` | 0 errors (only pre-existing warnings; none in new files) |
| `npm test` | 997 passed / 997 (141 files; +12 new) |
| `npm run smoke:core` | 0 failures, 0 warnings |
| `npm run build` | success; route registered as `ƒ /api/cron/geofence-scan` |

Stopped here — **not** merged, pushed, or deployed.

---

## Needs owner / live verification
1. **Apply `supabase/migrations/00047_shift_geo_events.sql` by hand** after deploy + smoke
   (mirror-only; code no-ops until then). Then confirm Supabase logs show zero new errors.
2. **Set `CRON_SECRET`** in Vercel project env so the cron route rejects unauthorized callers.
3. Live check: with a worker clocked in and web GPS on, after the table exists, confirm a
   `shift_geo_events` row appears on the first status and only on subsequent *changes*
   (no per-5-min spam), and that a manager can read the rows while a worker/anon cannot.
