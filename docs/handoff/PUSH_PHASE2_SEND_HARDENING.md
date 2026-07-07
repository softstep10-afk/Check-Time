# Push Phase 2 — /api/messages/send hardening

**Branch:** `fix/messages-send-hardening` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `f4496c2`)
**Scope:** two point fixes in `src/app/api/messages/send/route.ts` (+ tests). Found by live smoke. Not
merged/pushed.

## Root cause (fix 1)
`messages` schema (`00003` + `00014`): `color text NOT NULL default '#3b82f6'`,
`priority message_priority NOT NULL default 'info'`, `metadata jsonb NOT NULL default '{}'`,
`text NOT NULL default ''`, `attachment jsonb` (nullable). The route mapped
`color: typeof row.color === "string" ? row.color : null` — so a row **missing** color got an
**explicit `null`**, which violates NOT NULL (a column default only applies when the column is
*omitted*, not when set to null) → Postgres 500 on live smoke.

## Fix 1 — explicit, defaulted, whitelisted insert row
The route now builds each insert row **explicitly** from a fixed whitelist and never passes unknown
keys or a null into a NOT NULL column:
- **`color`** → the client's color if a non-empty string, else **`PRIORITY_COLOR[priority]`** (the
  same priority→color map the components use: urgent `#ef4444`, info `#f59e0b`, good `#22c55e`, task
  `#3b82f6`). Never null.
- **`priority`** → clamped to the enum (`urgent|info|good|task`), else `info`. (A stray priority string
  would otherwise 500 the enum insert.)
- **`metadata`** → the client object, else `{}` (never null; arrays excluded).
- **`org_id` / `sender_id`** → stamped from the authed sender (unchanged; a forged `org_id`/`sender_id`
  or `id` in the client row is now provably ignored — the row is rebuilt, not spread).
- **`recipient_id` / `text`** → required; a row missing either can't be defaulted → **400** with a clear
  message (`"Each message needs a recipient."` / `"Each message needs text."`) instead of a 500.
- `attachment` → the client value or null (nullable column).

## Fix 2 — error hygiene (S-L1 class)
All three error responses now route through the repo's `safeClientErrorMessage(error, fallback)`
(same as the AI/other routes): the recipient-query error, the insert error, and the catch-all. In
production it returns the fallback (`"Could not send message."` / `"Internal server error"`), so raw
Postgres constraint/column text never reaches the client.

## RED LINE compliance
- **No behavior change for the full rows the components send today.** `ForceCheckoutButton`,
  `SendMessageForm`, and `BulkMessageComposer` all send `color` (= `PRIORITY_COLOR[priority]`) and a
  valid `priority`, so the route uses them verbatim — verified by a test that an explicit color is
  preserved.
- **Push dispatch untouched** (the fire-and-forget block is unchanged).
- **Point diff:** this file + tests only (`route.ts` +56/−16; one new test file).

## Tests (`tests/lib/messages-send-route.test.ts`, chainable supabase mock)
- Partial row (no `color`) → **200 not 500**, `color` defaulted from priority (urgent → `#ef4444`).
- No color + no priority → `info` color default (`#f59e0b`).
- **Unknown keys stripped**: `evilKey`/`id` dropped; forged `org_id`/`sender_id` overridden by the
  server profile.
- Invalid priority → clamped to `info`.
- Missing recipient → 400; missing text → 400.
- RED LINE: an explicit client color is preserved.
- **Error body never contains raw constraint text** (production mode → `"Could not send message."`,
  no `constraint`/`column`).

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 985 passed (+8 `messages-send-route`)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
