# Phase 3 — Consent + Owner Role + Safe RLS Foundation

**Date:** 2026-04-20
**Branch:** `waveAudit/live-data-fixes`
**Migrations produced:** `supabase/migrations/00015_owner_role_helpers.sql`
**Code added:** `src/lib/gps-consent.ts`
**Code edited:** `src/components/worker/WorkerShell.tsx`

---

## Part 1 — Consent (read/write path)

### Module: `src/lib/gps-consent.ts`

```ts
type ConsentState = "granted" | "denied" | "unknown";

readLatestConsent(supabase, workerId): Promise<ConsentState>
writeConsent(supabase, { orgId, workerId, signedName, granted, userAgent? })
  : Promise<{ ok: true } | { ok: false; error: string }>
```

- **Read** does an explicit `select consented … order by signed_at desc limit 1` against `public.worker_location_consents`. RLS error, network error, or zero rows all collapse to `"unknown"` so callers can't crash on a missing row.
- **Write** is an INSERT (never UPDATE), so the table doubles as an audit trail of every consent flip. The function returns `{ ok, error }` instead of throwing — the caller decides whether to surface or log.

### Integration in WorkerShell

`WorkerShell.tsx` previously inlined both calls. Now it imports the two helpers and:

- On mount: `readLatestConsent()` → if `"granted"`/`"denied"` it sets the existing boolean state and the localStorage cache; if `"unknown"` it leaves both alone. **No UI block** — the consent modal opens lazily on the first GPS-requiring action, exactly as before.
- `handleGpsConsent` / `handleGpsDecline`: both call `writeConsent()` with `granted: true|false`. Errors are swallowed into a console warning so a transient network/RLS hiccup never crashes the worker UI.

### Safe fallback behavior

- Read failure → treat as `"unknown"`; UI does not block.
- Write failure → console.warn, localStorage still set, UI proceeds. The next mount will reconcile from DB; if the write truly failed and never lands, the user will be re-prompted.
- No row in DB → `"unknown"`; the existing modal-on-first-clock-in flow handles capture.

---

## Part 2 — Owner role (foundation)

The `'owner'` enum value already exists (added in 00003). The zero-arg `is_manager()` already includes owner (00013). The remaining gap was that every helper resolves implicitly against `auth.uid()` — there was no clean way to ask *"is this OTHER user an owner / manager?"*, which future RLS policies (e.g. owner-only capability grants) will need.

### Migration: `00015_owner_role_helpers.sql`

Adds three new functions, all `security definer`, `stable`, `search_path = public`, callable from RLS bodies:

| Function | Returns | Notes |
|----------|---------|-------|
| `is_owner()`            | `boolean` | current user is owner |
| `is_owner(uuid)`        | `boolean` | given user is owner |
| `is_manager(uuid)`      | `boolean` | given user is owner/admin/manager/supervisor (matches the body of the existing zero-arg `is_manager()`) |

Postgres allows function overloading by argument list, so `is_manager()` and `is_manager(uuid)` coexist. **The existing zero-arg `is_manager()` is not touched**, so no policy bodies that reference it change behavior.

`grant execute … to anon, authenticated` on all three.

### Owner integration

This phase doesn't restrict anything. The new helpers are foundation only — no existing UI route, RLS policy, or server action is wired to them yet. They're ready for the next phase that wants to write owner-only logic without re-deriving the role lookup inline.

---

## Part 3 — Safe RLS (non-breaking)

### What 00014 already established (now in main schema)

| Table | Policies (from 00014) |
|-------|----------------------|
| `messages` | `messages_select_participant` (sender/recipient/manager), `messages_insert_self` (sender_id = auth.uid()), `messages_update_recipient` (recipient or manager) |
| `worker_live_locations` | `wll_select_self_or_manager`, `wll_insert_self_or_manager` |
| `worker_location_consents` | `wlc_select_self_or_manager`, `wlc_insert_self` |

These are **additive** (no DROP-then-CREATE on prior policies that existed; the tables had RLS off before 00014) and **permissive enough** to keep every existing flow working:

- A worker reads their own consent → covered by the `worker_id = auth.uid()` branch.
- A worker writes a new consent → covered by `wlc_insert_self`.
- A worker pings live position → covered by `wll_insert_self_or_manager` (worker_id = auth.uid()).
- A manager browses any worker's positions / consent state → covered by the `is_manager()` branch.
- LiveWorkerMarkers (manager-side map) reads many workers → covered by manager branch.
- Sending and receiving messages → covered.

### Phase 3 RLS additions

**None.** Re-reading the requirements ("prefer additive policies, avoid replacing existing working ones, do NOT introduce 'denied access' errors"), the safest move is to leave the 00014 surface alone. Adding more policies on these tables would either be redundant (the existing ones already permit the access) or risk shadowing them in unexpected ways.

The only Phase 3 SQL is the function migration above, which **does not touch any policy**.

### Service-role passthrough

Edge functions and server-side admin actions that use `SUPABASE_SERVICE_ROLE_KEY` continue to bypass RLS by definition — service role is exempt at the Postgres role level, not at the policy level. No changes needed for that path.

---

## What was intentionally NOT changed

- **Existing policies on messages / worker_live_locations / worker_location_consents** — the 00014 set is sufficient.
- **The zero-arg `is_manager()`** — already correct after 00013.
- **UI** — no component renders, props, styles, or routes changed except the WorkerShell internal swap to the new lib (no visible behavior delta).
- **Auth flow** — login, PIN entry, proxy gate untouched.
- **Worker check-in/out logic, messaging UI, GPS throttle, mobile binding** — all untouched.
- **Edge function `detect-store-visit`** — untouched.
- **Tristate consent in UI** — `WorkerShell` continues to derive a boolean from the tristate (`"granted"` → enable, others → don't enable). Surfacing `"unknown"` distinctly in the UI would be a UX change and is out of scope.

---

## Step-by-step test plan

### Pre-flight
1. Confirm 00014 was applied earlier this branch.
2. Apply 00015: paste `supabase/migrations/00015_owner_role_helpers.sql` into the Supabase SQL Editor → expect `Success. No rows returned`.
3. Verify the three new functions exist:
   ```sql
   select proname, pg_get_function_arguments(oid) as args
   from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('is_owner','is_manager')
   order by proname, args;
   ```
   Expect 4 rows (`is_manager()`, `is_manager(target_id uuid)`, `is_owner()`, `is_owner(target_id uuid)`).

### Smoke tests in the running app
4. Restart `npm run dev` (clears any cached PostgREST schema).
5. **Login**: PIN 9999 → reach owner dashboard. Should work as before.
6. **Worker flow**: switch to a worker session (other PIN), Clock In on a project. Consent modal appears (if first time) → Accept → row lands in `worker_location_consents`. Position pings start landing in `worker_live_locations` (verify with `select recorded_at from worker_live_locations order by recorded_at desc limit 5`).
7. **Manager flow**: open `/team/<workerId>` → Send Message form opens → message sends → row appears in `messages`. Manager map (LiveWorkerMarkers) shows real positions, no "Preview Worker" anymore.
8. **Messaging**: NotificationBell loads real inbox; mark-as-read flips `read=true` in DB.
9. **GPS refresh persistence**: clear localStorage in DevTools → reload → consent state pulled from DB; modal does not re-open if consent was previously granted.
10. **Mobile**: open `http://10.0.0.55:3000` from phone → loads → login works.
11. **Hydration**: open DevTools console on every screen visited above → no `Hydration failed` errors. (Phase 2 already pinned the locale.)

### Validation gates (already green)
- `npx tsc --noEmit` — clean
- `npm run lint` — 15 problems / 5 errors / 10 warnings (baseline unchanged)
- `npm test` — 42 / 42

---

## Confirmation

Verifiable in this environment:
- ✅ tsc clean
- ✅ lint baseline unchanged
- ✅ 42/42 tests pass
- ✅ No DB calls or RLS bodies modified beyond the three new functions in 00015

Not verifiable here (Andrew tests in a real browser):
- Worker / manager / messaging / GPS / mobile in the actual app — call out failures and I'll diagnose.
