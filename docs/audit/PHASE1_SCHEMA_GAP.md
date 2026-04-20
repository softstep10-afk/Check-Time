# Phase 1 — Data Foundation / Schema-Gap Audit

**Date:** 2026-04-20
**Branch:** `waveAudit/live-data-fixes`
**Migration produced:** `supabase/migrations/00014_phase1_data_foundation.sql`
**Scope:** schema only — no UI, no app logic, no feature work.

---

## TL;DR

Eight migration files (`00004`, `00005`, `00006`, `00008`, `00009`, `00010`,
`00011`, `00012`) were checked into the repo with **all DDL commented out**
under a `RUN MANUALLY` header. Whether each piece was ever pasted into the
Supabase SQL Editor is unverifiable from the repo. To get the live DB into
the shape the application code already assumes, one consolidated, idempotent
migration (`00014`) is required. It also closes an RLS hole on the eight
tables that `00003` created without ever calling `enable row level security`.

---

## A. CURRENT STATE (what the repo's *active* SQL produces)

Active = uncommented DDL inside `supabase/migrations/`.

| File | Status | Effect |
|------|--------|--------|
| `00001_foundation.sql`            | ACTIVE      | Core tables, enums, triggers |
| `00002_rls_policies.sql`          | ACTIVE      | RLS for org/profiles/projects/assignments/time_events/tasks/media/payroll/daily_reports |
| `00003_schema_gap.sql`            | ACTIVE      | `owner` enum value, projects.start/end_date, **8 new tables but ZERO RLS calls** |
| `00004_geofence_grace.sql`        | COMMENTED   | (would add `store_visits.grace_started_at`) |
| `00005_app_settings.sql`          | COMMENTED   | (would add `app_settings`) |
| `00006_worker_require_video.sql`  | COMMENTED   | (already in 00001 — no-op anyway) |
| `00008_project_gps_radius.sql`    | COMMENTED   | (would add `projects.gps_radius_m`) |
| `00009_message_priority.sql`      | COMMENTED   | (would add `messages.priority`, `profiles.notif_mode`) |
| `00010_user_capabilities.sql`     | COMMENTED   | (would add `user_capabilities`, `has_capability()`) |
| `00011_media_project_privacy.sql` | COMMENTED   | (would split media SELECT by role) |
| `00012_media_flags.sql`           | COMMENTED   | (would add `media_flags`, `media_flags_public`) |
| `00013_is_manager_includes_owner.sql` | ACTIVE  | `is_manager()` accepts owner/admin/manager/supervisor |
| `00099_wash_and_reset.sql`        | ACTIVE      | Drops everything for re-bootstrap |

Net effect of the *active* set:
- `public` enums: `user_role` (incl. owner), `project_status`, `time_event_type`, `checkout_video_status`, `task_priority`, `task_status`, `media_type`, `payroll_status`, `pay_period_type`, `pay_period_status`, `pay_item_status`.
- `public` tables: organizations, profiles, projects, project_assignments, time_events, tasks, media, payroll_runs, payroll_line_items, payroll_closures, daily_reports, messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items.
- RLS enabled on: organizations, profiles, projects, project_assignments, time_events, tasks, media, payroll_runs, payroll_line_items, payroll_closures, daily_reports.
- **RLS NOT enabled on:** messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items.

---

## B. EXPECTED STATE FROM CODE

Mapped by grepping every Supabase reference (`.from(...)`, `.rpc(...)`, role
literals, defensive 42P01 fallbacks). Full table-by-table inventory in the
companion exploration report; condensed expectations:

**Tables the code touches** (all 19 active + 3 new):
- All 19 listed above, **plus** `app_settings`, `user_capabilities`, `media_flags` (+ view `media_flags_public`).

**Columns the code touches that the active SQL doesn't create:**
- `projects.gps_radius_m`           (read in `worker-data.ts`, `WorkerShell.tsx`, ProjectDetail forms)
- `messages.priority`               (defensive read with retry-on-missing in `SendMessageForm.tsx`)
- `profiles.notif_mode`             (defensive read; default 'sound' if absent)
- `store_visits.grace_started_at`   (`src/lib/store-visits.ts`, `supabase/functions/detect-store-visit/index.ts`)

**Enum the code uses that the active SQL doesn't define:**
- `public.message_priority` with values `urgent | info | good | task`

**Function the code calls that the active SQL doesn't define:**
- `public.has_capability(text) returns boolean`

**Roles the code checks that the active enum supports** (all already present after 00003):
- `owner`, `admin`, `manager`, `supervisor`, `worker`, `driver`, `subcontractor`. No new enum value needed.

**RLS expectations** (these tables are read/written from the browser with
the anon JWT, so they need policies even if it currently "works" — either
the prod DB had RLS turned off and is wide-open, or the requests succeed
only because of accidental Supabase grants):
- `messages` — sender/recipient see their own; managers see all in org.
- `supply_stores` — all authenticated users may read; managers may write.
- `store_visits` — own row + managers.
- `worker_live_locations` — own row + managers.
- `worker_location_consents` — own row + managers.
- `audit_log` — managers may read; any authenticated user may insert their own row.
- `pay_periods` / `pay_period_items` — managers; workers see their own line items.
- `app_settings` — anyone authenticated may read (worker consent UI shows the radius); owner/admin only may write.
- `user_capabilities` — same-org managers; user can read own.
- `media_flags` — column-grant pattern (workers see anonymized via the view; managers see authors).
- `media` — split SELECT by role (already in 00002 but only org-wide; 00011 narrows it for workers).

**Tables/columns NOT referenced by code** (i.e. dead future-reserved):
- `time_events` enum values `break_start`, `break_end` — declared, not yet inserted anywhere.
- Worker-tier roles `driver`, `subcontractor` — enum values exist, no role checks for them.

---

## C. GAP LIST

### C1. Missing tables (3)
| Table | Source | Used by |
|-------|--------|---------|
| `app_settings`         | 00005 (commented) | `src/lib/geofence.ts`, `src/components/manager/AdminSettingsPage.tsx` |
| `user_capabilities`    | 00010 (commented) | `src/lib/capabilities.ts`, `/admin/users/[id]/permissions` |
| `media_flags` (+ view `media_flags_public`) | 00012 (commented) | `src/lib/media-flags.ts`, `MediaFlagModal`, ProjectDetail |

### C2. Missing columns (4)
| Table | Column | Source | Used by |
|-------|--------|--------|---------|
| `projects`     | `gps_radius_m integer 25..300 default 75 not null` | 00008 | worker check-in math |
| `messages`     | `priority public.message_priority not null default 'info'` | 00009 | inbox sort + tint |
| `profiles`     | `notif_mode text check (in ('sound','silent')) not null default 'sound'` | 00009 | worker sfx toggle |
| `store_visits` | `grace_started_at timestamptz` | 00004 | edge fn dwell-grace |

### C3. Missing enum changes (1)
- Add `public.message_priority as enum ('urgent', 'info', 'good', 'task')`.
- `user_role` already includes `owner` (active in 00003) — no change.

### C4. Missing functions (1)
- `public.has_capability(cap text) returns boolean` (`security definer`, `stable`, `search_path = public`). Grant exec to anon + authenticated.

### C5. Missing indexes (4)
- `idx_store_visits_open_grace` — partial on `(worker_id, grace_started_at) where exited_at is null`.
- `idx_messages_priority_created` — `(recipient_id, priority, created_at desc)`.
- `idx_user_capabilities_capability` — partial on `(capability) where granted = true`.
- `idx_media_flags_open` and `idx_media_flags_media`.

### C6. Missing RLS — `enable row level security` on 11 tables
- 8 from `00003` (messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items) — **currently un-gated**.
- 3 new (app_settings, user_capabilities, media_flags).

### C7. Missing RLS policies
- New per-table policies for all 11 of the above (see migration § 7).
- Replace the `00002` org-wide media SELECT with the role-aware version from `00011` (workers can only see media for projects they're assigned to or that they uploaded themselves).

### C8. Missing triggers (3)
- `set_updated_at` on `pay_periods`, `pay_period_items`, `app_settings` (all have `updated_at` columns but no auto-bump trigger).

### C9. Missing FKs / constraints
- None new. Every table the code touches already has the FKs the code relies on.

### C10. NOT in scope (intentionally excluded)
- Real-time messaging Supabase channel subscriptions.
- Wave 4 pay-models (`fixed_per_project`, `fixed_amount`) — that's `00007` reserved.
- Volume/edge-function changes.
- Backfill / data migration of existing rows.

---

## D. PROPOSED SQL MIGRATION

See [`supabase/migrations/00014_phase1_data_foundation.sql`](../../supabase/migrations/00014_phase1_data_foundation.sql).

Single file, idempotent (uses `if not exists`, `do $$ exception when ... end $$`,
`drop policy if exists` before every `create policy`). Wrapped in a single
`begin … commit;` so partial failures roll back. ~330 lines, no app code
touched.

Section index inside the file:
1. ENUMS (`message_priority`)
2. COLUMN ADDITIONS (4 columns)
3. NEW TABLES (`app_settings` + singleton seed, `user_capabilities`, `media_flags`)
4. FUNCTIONS (`has_capability`)
5. updated_at TRIGGERS (3)
6. RLS — ENABLE on 11 tables
7. RLS — POLICIES per table
8. media SELECT policy split by role (replaces 00002's org-wide rule)
9. Verification queries (commented; copy-paste after the run)

---

## E. TEST PLAN

### Pre-flight (10 sec)
1. Open Supabase SQL Editor:
   `https://supabase.com/dashboard/project/vlrajjwbaxikbwvqdpft/sql/new`
2. Confirm the active `is_manager()` is the 00013 version:
   ```sql
   select pg_get_functiondef('public.is_manager()'::regprocedure);
   ```
   Expect `role in ('owner', 'admin', 'manager', 'supervisor')`.

### Apply the migration (one paste)
3. Copy the entire contents of `00014_phase1_data_foundation.sql` into the editor → `Ctrl+Enter`.
4. Expected result: `Success. No rows returned`.
5. If it errors mid-run, the `begin … commit;` wrapper rolls everything back; nothing partial lands. Read the error, share verbatim, do not re-paste blindly.

### Verification (run each block, expect the noted output)
Run the queries from the file's verification section (lines starting with
`-- (a)` through `-- (f)`). Expected:
- (a) Each `column_name` query returns 1 row.
- (b) Three tables + one view returned.
- (c) `relrowsecurity` is `true` for all 11 tables.
- (d) `has_capability('flag_media')` returns `false` (no rows yet).
- (e) Four enum values: `urgent, info, good, task`.
- (f) Singleton row with `id=1`, `settings -> geofence_radius_meters = 75`.

### Re-runnability check
6. Paste the same migration again into the SQL editor. Expected: `Success. No rows returned` again, no errors. (This proves idempotency. Skip if pressed for time.)

### Smoke test from the running app
7. Restart `npm run dev` (no code changed; this is just to clear any cached PostgREST schema).
8. As Andrew (owner, PIN 9999):
   - Open `/admin/settings` → geofence radius value loads (reads `app_settings`).
   - Open `/admin/audit` → audit list loads (reads `audit_log` with new RLS).
   - Send a worker a message → no `column "priority" does not exist` retry path triggers.
   - Open the photo gallery on any project → media still loads.
9. Watch the dev console: zero `42P01` (table missing) and zero `42703` (column missing) errors.

### Rollback (only if catastrophic)
The migration is purely additive — no drops, no data deletes. If you need
to undo the RLS hardening only (e.g. an unexpected policy locks out a real
flow), run:
```sql
alter table public.<table> disable row level security;
```
on the offending table while you debug. Do NOT drop the new tables/columns
unless absolutely necessary; the app reads them defensively but disabling
RLS is the lower-risk lever during debugging.

---

## What this migration explicitly does NOT touch

- No edits to `src/`. UI and app logic unchanged.
- No edits to `00001`, `00002`, `00003`, `00013` (the active migrations).
- No real-time messaging subscriptions.
- No mock-to-real conversions of `preview-data.ts`.
- No styling, no refactors, no feature work.
- No deletion of dead future-reserved enum values.

Anything past schema parity is its own future PR.
