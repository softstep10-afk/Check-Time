# Check-Time

Construction workforce management. Workers clock in/out from job sites on
their phones; managers track hours, assign tasks, and process payroll.
Built to eventually become multi-tenant SaaS.

The app replaces a working single-HTML-file prototype with the same feature
set and dark Binance-style UI, rebuilt on a proper architecture.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) — see `AGENTS.md` for rebrand notes (Middleware → Proxy) |
| Database | Supabase (Postgres + PostGIS) |
| Auth | Supabase Auth — workers login by PIN, managers by email/password |
| Storage | Supabase Storage (photos, videos, PDFs) |
| Hosting | Vercel |
| Styling | Tailwind CSS + CSS custom properties (tokens in `globals.css`, full system in `DESIGN.md`) |
| AI | Google Gemini 1.5 Flash via Next API routes + Google Cloud Text-to-Speech |
| Tests | Vitest |

`CLAUDE.md` lists the stack choices we deliberately exclude (React Native,
separate backends, GraphQL, offline-first sync engines, etc.).

## Setup

```sh
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                         # http://localhost:3000
```

### Required environment variables

`.env.local` (never commit):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-jwt>
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>     # server-only; bypasses RLS
GOOGLE_GENERATIVE_AI_API_KEY=<key>               # Gemini brain for Jarvis chat/vision/PDF prompts
GEMINI_MODEL=gemini-1.5-flash                    # optional override for Jarvis model
GOOGLE_CLOUD_CREDENTIALS=<service-account-json>  # or base64 JSON for Google Cloud Text-to-Speech
GOOGLE_TTS_VOICE=en-GB-Neural2-B                 # optional British male voice override
GOOGLE_TTS_SPEAKING_RATE=0.9                     # optional slower Jarvis cadence
GOOGLE_TTS_PITCH=-3                              # optional deeper Jarvis tone
```

### Demo / preview mode

`src/lib/auth-bypass.ts` reads `NEXT_PUBLIC_AUTH_BYPASS=true` only in local
development. Production always forces bypass off, even if the env var is
present. With local preview mode on, the app loads preview data from
`src/lib/preview-data.ts` so you can browse every page without a real Supabase
session.

### Supabase migrations

SQL lives in `supabase/migrations/`. The first three are applied on existing
environments. Migrations 00004–00008 are committed but **commented**, with a
"RUN MANUALLY via Supabase SQL editor" header — open each file, review, and
run it from the Supabase dashboard before the corresponding feature lights up.

| File | Adds |
|------|------|
| `00001_foundation.sql` | core schema |
| `00002_rls_policies.sql` | per-org RLS |
| `00003_schema_gap.sql` | messages, supply_stores, store_visits, worker_live_locations, audit_log, pay_periods, etc. |
| `00004_geofence_grace.sql` | `store_visits.grace_started_at` |
| `00005_app_settings.sql` | singleton `app_settings` (geofence radius slider) |
| `00006_worker_require_video.sql` | confirms `profiles.require_video` |
| `00008_project_gps_radius.sql` | `projects.gps_radius_m` per-project check-in fence |

The Supabase edge function `supabase/functions/detect-store-visit/` (Wave 2)
needs a one-time webhook setup — see `supabase/README.md` for the runbook.

## Scripts

```sh
npm run dev            # Next.js dev server
npm run build          # production build
npm run lint           # ESLint
npm test               # Vitest one-shot
npm run test:watch     # Vitest watch mode
npx tsc --noEmit       # strict type-check
```

CI (`.github/workflows/ci.yml`) runs `tsc --noEmit`, `npm run lint`, and
`npm test` on every push to `main` and every PR.

## Project layout

```
src/
  app/
    (auth)/login/        — PIN entry
    (worker)/            — Mobile shell with bottom nav
      clock/             — Clock in/out + project selector
      journal/           — Photo / video / caption uploads
      my-tasks/          — Worker's tasks
      hours/             — Personal time history (+ visible adjustments)
    (manager)/           — Sidebar + bottom nav layout
      overview/          — Stats, on-site, recent events
      projects/          — CRUD + GPS radius slider + Copy project
      team/              — Roster table, per-worker drill-down
      tasks/             — Manager Assign + All Tasks
      timeline/          — Org-wide event log
      payroll/           — Calculator (per-row checkboxes, Process selected)
      reports/annual/    — Year report
      stores/            — Supply stores CRUD (owner)
      admin/audit/       — Audit log (owner)
      admin/settings/    — Geofence radius slider (owner)
    api/                 — Pin login, payroll run, AI endpoints
  components/
    worker/              — Mobile-optimized
    manager/             — Sidebar dashboard
    shared/              — Cross-role
    maps/                — Google Maps wrappers
  lib/
    supabase/{client,server,admin}.ts
    manager-utils.ts     — payroll/session math (see tests/lib/)
    geofence.ts          — radius resolver (see tests/lib/)
    store-visits.ts, audit.ts, store-types.ts, etc.
    i18n/translations.ts — single source of truth, EN+RU
  proxy.ts               — Next 16 Proxy (was Middleware): SSR session
                           refresh + route gate. Respects AUTH_BYPASS_ENABLED.

supabase/
  functions/detect-store-visit/  — Deno edge function for geofence math
  migrations/                    — see table above

tests/
  lib/manager-utils.test.ts  — 19 cases (payroll OT, multi-project, closures)
  lib/geofence.test.ts       — 15 cases (haversine, fence resolver)
```

## Operator runbooks

- `HANDOFF.md` — accumulated session-to-session lessons; read first when
  picking up the project after a break.
- `IMPLEMENTATION_PLAN.md` — feature backlog from `OLD_APP_FINDINGS.md`
  with current status per item.
- `AUDIT_REPORT.md` — wave-by-wave audit + per-commit hashes.
- `DESIGN.md` — Binance design tokens; read before writing any UI.
- `supabase/README.md` — Supabase repo layout, edge-function deploy
  + database webhook setup, migration "RUN MANUALLY" status.
- `docs/permissions.md` — owner / admin / manager / worker role matrix.

## Auth flow

1. Manager creates worker accounts (`api/team/create`) — inserts into
   Supabase Auth + `profiles` table.
2. Each worker gets a 4–6 digit PIN; `profiles.pin_hash` is Argon2.
3. Login: `/api/auth/pin-login` looks up the hash via service-role,
   verifies, and writes the session cookie.
4. `src/proxy.ts` refreshes the session cookie per request and gates all
   non-public routes; in `AUTH_BYPASS_ENABLED` mode the gate is skipped
   but the refresh still runs.

## Deploy on Vercel

Push to `main`. CI must be green. The Vercel project should have the same
environment variables set (Production scope) as your local `.env.local`.
The Supabase edge function deploys separately — see `supabase/README.md`.
