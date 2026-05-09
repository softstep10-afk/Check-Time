# Construction Clock — Context for Claude Code

**READ THESE FILES FIRST, in order, before doing anything:**

1. `ABOUT_ANDREW.md` — who the user is, communication style, non-negotiables
2. `HANDOFF.md` — high-level project orientation
3. `PROGRESS_LOG.md` — current state, open bugs, wave history
4. `docs/audit/AUDIT_REPORT.md` — full audit findings and recommended work order

---

## Working rules (non-negotiable)

- **Andrew is non-technical.** Never dump raw stack traces or PowerShell errors on him. Translate everything into plain language. When a command fails, diagnose and retry yourself — don't ask him to debug.

- **Andrew dictates bugs → the chat-side assistant writes short prompts → Andrew pastes them here.** You (Claude Code) do the actual code work. The chat-side Claude does NOT edit files directly. If you find uncommitted changes on disk that you didn't make, ask before touching them — they are hotfixes from chat-side awaiting commit.

- **Work on a feature branch, never on main.** Current audit branch: `waveAudit/live-data-fixes`.

- **Every logical change = its own commit.** Commit messages follow `waveXxx(area): what changed`.

- **Never merge to main.** Andrew reviews and merges himself.

- **Before finishing any prompt:** `tsc` clean, lint baseline unchanged (15/5/10), `npm test` 42/42 pass.

- **If something looks risky or unclear — stop and ask in chat** rather than guessing.

---

## Tech stack quick facts

- Next.js 16.2.3 (App Router, Turbopack dev), React 19
- Supabase `vlrajjwbaxikbwvqdpft.supabase.co` with PostGIS
- Auth: PIN-only login via `/api/auth/pin-login` (argon2)
- `AUTH_BYPASS_ENABLED = false` — real auth is live. Don't flip this back on.
- Seed owner: Andrew, PIN **9999** (already set via `scripts/set-owner-pin.mjs`)
- Dev server usually runs as: `npx next dev --turbo -H 0.0.0.0` (LAN-exposed on `http://10.0.0.55:3000` for mobile testing)

---

## Key locations

- **Migrations:** `supabase/migrations/` (00001 foundation → 00013 is_manager includes owner)
- **Seed:** `supabase/seed_dev.sql`
- **Wash & reset:** `supabase/migrations/00099_wash_and_reset.sql`
- **RBAC matrix:** `docs/permissions.md`
- **Worker GPS consent:** `GPS_CONSENT_FORM.md` (EN + RU)
- **Audit report:** `docs/audit/AUDIT_REPORT.md`
- **Live audit branch:** `waveAudit/live-data-fixes`
- **Auth code:** `src/app/api/auth/pin-login/route.ts`, `src/app/(auth)/login/page.tsx`
- **Proxy/auth gate:** `src/proxy.ts`
- **Preview-data guard:** `src/lib/auth-bypass.ts`
- **Map components:** `src/components/maps/*`
- **Key utility:** `src/lib/worker-utils.ts` has `parseGeoPoint` (WKB-aware)
- **Role check:** `src/lib/manager-utils.ts` `isManagerRole()` (owner + admin + manager + supervisor)

---

## Temporary scripts (delete before production)

- `scripts/set-owner-pin.mjs` — one-off, already executed
- `scripts/diagnose-profiles.mjs` — debug only
- `scripts/check-sites.mjs` — debug only
- `scripts/check-live-locations.mjs` — debug only
- **Keep:** `scripts/show-db-state.mjs` — useful utility

---

## Wave history (context for naming future waves)

Closed in main: waves 1, 1.5, 2, 2.5, 3, 3.5, 5, 6, 7, 8, X1, X2, X3, WR, Fix/owner-role-gate.

Active branch: `waveAudit/live-data-fixes` (not yet merged).

Reserved for future: `wave4/pay-models` (migration 00007 reserved), `waveLiveOps/full-map-and-quick-task`, `waveTeam/create-worker-with-pin`, `waveX4/client-role`, `waveX5/worker-map-stores`, `wave9/real-device-testing`.

---

## Communication pattern

When Andrew pastes a prompt, it will be:
- Focused on ONE bug or ONE small task
- In imperative voice ("Fix X in file Y")
- With a specific branch and commit-message convention

You should:
1. Read the prompt carefully — it contains all the diagnosis needed
2. Do the work on the specified branch
3. Commit with the specified message
4. Run `tsc && npm run lint && npm test` silently
5. Report back concisely what was done (one line per commit)
6. Do NOT start a new branch, do NOT merge, do NOT modify anything outside scope
