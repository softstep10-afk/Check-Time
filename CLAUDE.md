@AGENTS.md

# Check-Time — Construction Workforce Tracker

## What This Is
A construction workforce management app: workers clock in/out from job sites on their phones, managers track hours, assign tasks, process payroll. Built to eventually become multi-tenant SaaS.

The app replaces a working single-HTML-file prototype. We're keeping the same feature set and dark Binance-style UI, rebuilding with proper architecture.

## Stack — Do Not Deviate
| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15+ (App Router) | One codebase, one deploy. SSR where helpful, client components where needed |
| Database | Supabase (Postgres + PostGIS) | Already in use. Auth, Storage, Realtime, Edge Functions included |
| Auth | Supabase Auth | Workers get PIN-mapped accounts, managers get email/password |
| Storage | Supabase Storage | Photos, videos, PDFs. Never store blobs in the DB |
| Hosting | Vercel | Zero-config Next.js deploys |
| Styling | Tailwind CSS + CSS custom properties | Design tokens in `globals.css`, full reference in `DESIGN.md` |
| AI | Anthropic Claude API (via Next.js API routes) | Daily reports, photo analysis, voice commands, manager assistant |

Do NOT suggest: React Native, Expo, separate backend servers (Fastify/Express), separate SPA (Vite), GraphQL, tRPC, Socket.IO, Redis, PowerSync, WatermelonDB, or any offline-first sync engine. These are deliberate exclusions. If offline becomes a real need, we add it later.

## Design System
Read `DESIGN.md` before writing any UI. It contains the Binance-inspired design tokens.

Key rules for this app (dark-first adaptation):
- Background: `--bg-primary: #0f1117`, surfaces: `--bg-surface: #181c27`, cards: `--bg-card: #1e2333`
- Brand accent: `--brand-yellow: #F0B90B` — the ONLY accent color
- Semantic: `--green: #0ECB81` (success/clocked-in), `--red: #F6465D` (error/clocked-out), `--blue: #3b82f6` (info/links)
- Font: DM Sans (loaded via Google Fonts in root layout), DM Mono for timestamps/clocks
- Border radius: 6px buttons, 8px inputs, 12px cards, 50px pills
- Shadows: barely visible — 5% opacity max
- Mobile-first. Worker pages max 500px centered. Manager dashboard has sidebar on desktop, bottom nav on mobile
- Use CSS variables via `style={{}}` for colors, Tailwind for layout/spacing

## Project Structure
```
src/
  app/
    (auth)/login/        — PIN entry, worker/manager toggle
    (worker)/            — Mobile layout with bottom nav
      clock/             — Clock in/out, GPS, project selection
      journal/           — Photo/video capture with comments
      tasks/             — View and complete assigned tasks
      hours/             — Personal hours history
    (manager)/           — Sidebar + mobile nav layout
      overview/          — Dashboard stats, who's on site, recent activity
      projects/          — Project list and CRUD
      projects/[id]/     — Project detail: workers, tasks, media, drill-down
      team/              — Team list with role filters
      team/[id]/         — Worker detail: hours by day, events
      timeline/          — All clock events across the org
      payroll/           — Payroll runs with closure markers
      settings/          — Org settings, manager accounts
    api/
      auth/pin-login/    — PIN → Supabase Auth session
      ai/                — AI endpoints (daily-report, photo-analysis, assistant)
      webhooks/          — Supabase realtime hooks
      cron/              — Scheduled jobs (auto-close sessions, generate reports)
  components/
    worker/              — Mobile-optimized components
    manager/             — Dashboard components (tables, cards, charts)
    shared/              — Buttons, modals, inputs, status badges
  lib/
    supabase/client.ts   — Browser client (createBrowserClient)
    supabase/server.ts   — Server client (createServerClient, uses cookies)
    hooks/               — useGPS, useClock, useVoice, useProfile
    utils/               — Time formatting, GPS distance calc, etc.
    ai/                  — AI service layer (prompt builders, response parsers)
  types/database.ts      — TypeScript types mirroring the DB schema
  middleware.ts          — Auth session refresh, route protection

supabase/migrations/     — SQL migration files (run in order)
DESIGN.md                — Binance design system reference
```

## Database Architecture — Critical Rules

### The Time Ledger
`time_events` is an **append-only** table. NEVER update or delete rows.

- `clock_in` — worker starts a session
- `clock_out` — worker ends a session
- `auto_out` — system closed a forgotten session (trigger handles this)
- `adjust` — manager correction, linked to original event via `adjusts_event_id`

To compute hours: pair clock_in events with their corresponding clock_out/auto_out events, calculate duration. If a worker is currently clocked in (no matching out event), compute duration as now() minus clock_in time.

### Payroll Closure Markers
When payroll runs:
1. Compute hours per worker since their last `payroll_closures.closed_through` timestamp
2. Snapshot the hourly rate into `payroll_line_items` (rate at time of run, not current rate)
3. Write a `payroll_closures` record marking `closed_through` = end of pay period
4. Next payroll run only looks at events AFTER the closure

This means hours are never zeroed, history is never destroyed, and past runs can be recalculated.

### Checkout Video State Machine
When a worker who has `require_video = true` checks out:
1. Clock-out timestamp is recorded immediately (stops the pay clock)
2. `video_status` is set to `pending`
3. Video uploads to Supabase Storage in the background
4. On successful upload, `video_status` → `uploaded`, `video_storage_path` is set
5. Worker can leave the app — upload continues

### Multi-Tenancy
Every table has `org_id`. Every RLS policy filters by `org_id` extracted from the user's JWT via `get_user_org_id()`. When querying, you don't need to manually filter — RLS handles it. But when inserting, you MUST include the correct `org_id`.

### Soft Deletes
Projects, profiles, tasks, and media have `deleted_at`. RLS policies filter these out automatically. To "delete" something, set `deleted_at = now()`. To restore, set `deleted_at = null`.

## Supabase Client Usage

**In Server Components and API routes:**
```ts
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();
```

**In Client Components:**
```ts
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

Never import the wrong one. Server client uses cookies for auth. Browser client uses the browser session.

## Auth Flow
1. Manager creates worker accounts (inserts into Supabase Auth + profiles table)
2. Each worker gets a unique PIN (4-6 digits)
3. PIN is hashed with Argon2 and stored in `profiles.pin_hash`
4. At login, `/api/auth/pin-login` receives PIN, looks up the hash using service role key, generates a session
5. Session is stored in cookies, middleware refreshes it on each request

## Coding Conventions
- TypeScript strict mode, no `any`
- Prefer Server Components. Use `"use client"` only when you need interactivity, browser APIs, or hooks
- One component per file, named export matching filename
- Use the types from `src/types/database.ts` — don't inline type definitions for DB entities
- Error handling: always handle Supabase errors (`if (error) { ... }`), never assume success
- GPS: use `navigator.geolocation.getCurrentPosition` (not watchPosition) for clock-in checks
- Time: store everything as UTC (`timestamptz`), format in the user's timezone on display
- Never hardcode org_id, project_id, or user_id — always derive from the auth session

## What's Built vs TODO

### Done
- [x] Project scaffolding (Next.js 15, Tailwind, Supabase SSR)
- [x] Database schema (14 tables, PostGIS, triggers)
- [x] RLS policies (full org isolation)
- [x] TypeScript types for all entities
- [x] Supabase client helpers (browser + server)
- [x] Auth middleware (session refresh, route protection)
- [x] Route structure with layouts (worker mobile, manager dashboard)
- [x] Login page UI (PIN entry, role toggle)
- [x] PWA manifest
- [x] Design tokens (Binance dark theme in globals.css)

### Phase 2 — Worker Experience (next)
- [ ] Wire PIN login to Supabase Auth (`/api/auth/pin-login`)
- [ ] Clock page: project picker, GPS check, clock in/out with live timer
- [ ] Checkout video flow (pending → upload → verified)
- [ ] Journal page: photo/video capture → Supabase Storage + media table
- [ ] Tasks page: view assigned tasks, mark done
- [ ] Hours page: personal time history from ledger

### Phase 3 — Manager Dashboard
- [ ] Overview: on-site count, team stats, recent activity feed
- [ ] Projects: CRUD, notes, GPS coordinates, rate setting
- [ ] Project detail: assigned workers, tasks, media gallery, drill-down to worker→day→events
- [ ] Team: list, filters by role, add/edit workers
- [ ] Timeline: all events with filters
- [ ] Payroll: compute hours since last closure, preview, confirm, export

### Phase 4 — AI
- [ ] Daily report generation (events + photos + tasks → summary)
- [ ] Photo analysis (vision API → progress tracking, safety flags)
- [ ] Voice commands (speech → intent → action)
- [ ] Manager assistant ("how's the 5th Ave project?")
