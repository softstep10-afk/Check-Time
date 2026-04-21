# Staging deployment — Vercel + HTTPS

Single-page reference for spinning up a stable HTTPS staging URL so the
phone can be tested in a real secure browser context (GPS, Service
Worker, clipboard — all require HTTPS or `localhost`).

---

## Why Vercel

- Built by the Next.js team — Next 16 features (Turbopack dev, Proxy
  middleware, RSC, edge functions) are first-class on day one.
- Free Hobby tier covers this app's expected staging load (1 GB
  bandwidth/day, 100 GB-hours of serverless execution per month).
- HTTPS is automatic — no cert management, no Caddy, no nginx.
- Deployment Protection (free on Hobby) gates every staging URL behind
  Vercel SSO by default — keeps the staging URL effectively private
  even before real auth is enforced. **Important given the AUTH_BYPASS
  caveat below.**
- Per-branch / per-PR preview URLs once the repo is on GitHub (optional
  follow-up).

---

## AUTH_BYPASS is env-driven

`src/lib/auth-bypass.ts` reads:

```ts
export const AUTH_BYPASS_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_BYPASS === "true";
```

- **Default = false** → PIN login is enforced everywhere the env var
  isn't explicitly set to `"true"`.
- **Local dev** keeps the auto-login experience because `.env.local`
  has `NEXT_PUBLIC_AUTH_BYPASS=true` (file is gitignored).
- **Vercel staging** simply omits the variable — bypass stays off, real
  auth is required. The PIN-login route uses `SUPABASE_SERVICE_ROLE_KEY`
  so make sure that env var is also set (see the table below).

Recommended belt-and-braces: leave Vercel's Deployment Protection ON
(default for new Hobby projects) so even before PIN login the URL is
gated by Vercel SSO. Once you're confident PIN login works, you can
turn Deployment Protection off if you need to share the URL with
testers who aren't on your Vercel team.

> Confirm Deployment Protection: Vercel dashboard → project → Settings
> → Deployment Protection → "Vercel Authentication" = Enabled / Standard.

---

## Environment variables

Six total. Four required, two optional (AI features). **Set these
in the Vercel dashboard before first deploy** so the build picks them up.

| Variable | Required | Notes |
|----------|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Same value as `.env.local`. Already public — it's in every browser response. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Same value as `.env.local`. RLS gates everything; the anon key is meant to be public. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Same value as `.env.local`. **Server-side only** — never inline this anywhere with `NEXT_PUBLIC_` prefix. PIN-login (`/api/auth/pin-login`) and admin user provisioning need it. Without it, login fails with a 503. |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | yes | Same value as `.env.local`. The manager map and live-positions panel will refuse to load without it. |
| `NEXT_PUBLIC_AUTH_BYPASS` | **do not set** | Omit on Vercel so real PIN auth is enforced. Setting it to `"true"` re-enables auto-login as the seeded Owner. |
| `ANTHROPIC_API_KEY` | optional | AI assistant + photo analysis routes. Empty string is fine if you're not testing AI features yet. |
| `ANTHROPIC_MODEL` | optional | e.g. `claude-sonnet-4-6`. Required only if `ANTHROPIC_API_KEY` is set. |

In Vercel Dashboard → project → Settings → Environment Variables, add
each with scope = **Production, Preview, Development** (all three
checkboxes). Save. Trigger a redeploy if you change any after the first
build.

---

## Deploy in five commands

Vercel CLI works directly from the local repo — no GitHub push required.

```bash
# 1. Install the Vercel CLI globally
npm i -g vercel

# 2. Log into your Vercel account (browser window opens once)
vercel login

# 3. From the project root — first run links + creates the project
cd "C:/Users/Nwbui/Documents/Max start bad/check-time/check-time"
vercel

#    answers when prompted:
#    - Set up and deploy?           Y
#    - Which scope?                 your personal account
#    - Link to existing project?    N
#    - What's your project's name?  check-time-staging
#    - In which directory ...?      ./
#    - Want to override settings?   N

# 4. Open the dashboard, paste the env vars from above, save.
#    URL: https://vercel.com/<your-name>/check-time-staging/settings/environment-variables

# 5. Trigger the production build now that env vars are live
vercel --prod
```

After step 5 the CLI prints two URLs. The `--prod` URL is your stable
staging address. Bookmark it on the phone.

Subsequent deploys are just `vercel --prod` from the project root.

---

## Post-deploy configuration (~5 minutes)

### A. Supabase: register the staging URL

The Supabase Auth callback uses an allowlist. Add the Vercel URL so
PIN login + magic-link OTP doesn't bounce.

> Supabase dashboard → project `vlrajjwbaxikbwvqdpft` → Authentication
> → URL Configuration:
> - **Site URL**: leave as is OR set to your Vercel URL if you want it
>   to be the canonical
> - **Redirect URLs**: add `https://check-time-staging-*.vercel.app/**`
>   and the stable `--prod` URL

### B. Google Maps: allow the Vercel referrer

Without this, the map components log a `RefererNotAllowed` error and
render blank.

> Google Cloud Console → APIs & Services → Credentials → click your
> Maps API key → Application restrictions → HTTP referrers:
> add `https://*.vercel.app/*` and your stable `--prod` URL.

### C. Confirm Deployment Protection (only if AUTH_BYPASS is still true)

> Vercel dashboard → project → Settings → Deployment Protection →
> "Vercel Authentication" = Standard Protection.

When you visit the URL on your phone the first time, log into Vercel via
the SSO page that appears. The browser remembers the cookie.

---

## URL the phone uses

Two forms — both work:

- **Stable**: `https://check-time-staging-<your-vercel-name>.vercel.app`
- **Per-deploy**: `https://check-time-staging-<git-or-deploy-hash>.vercel.app`

Use the stable one for testing — it always points at the latest `--prod`
deploy. The hashed ones are useful for comparing two deploys side-by-side.

---

## Validation plan

Run these in order from the phone (Chrome on Android, Safari on iPhone).
A clean run answers "is this URL ready as the main test environment?"

### 1. Login
- Open the URL → if Deployment Protection is on, log into Vercel SSO
  first.
- App should redirect to `/login` (or show owner UI directly if
  AUTH_BYPASS is still true).
- If AUTH_BYPASS=false: tap PIN `9999` → reaches owner dashboard.
- Network tab (remote-debug via `chrome://inspect#devices`): no 4xx /
  5xx on `/api/auth/pin-login`.

### 2. Worker shell
- Switch to a worker session (incognito tab + worker PIN, or a second
  phone).
- `/my-tasks` opens, shell renders, no Hydration warning in DevTools.

### 3. Manager flows
- Owner session → `/overview` loads with real data (projects, sessions
  list, NotificationBell).
- `/team/<workerId>` opens, SendMessageForm renders.

### 4. Messaging
- Send a message from manager view to a worker → green "Message sent"
  → confirm row in Supabase SQL Editor:
  ```sql
  select sender_id, recipient_id, text, priority, created_at
  from public.messages order by created_at desc limit 3;
  ```
- Switch to worker session → NotificationBell shows the new message →
  Got it → `read=true` in DB.

### 5. GPS — the whole reason for HTTPS staging
- Worker session → Clock In → consent modal → Accept.
- Open DevTools console (remote-debug). The `[GPS diagnostic]` line
  added in commit `3c7885b` will fire only on failure. With HTTPS:
  expect **no** failure log.
- Verify `window.isSecureContext === true` from the console.
- Wait 30-40 seconds. SQL Editor:
  ```sql
  select recorded_at, lat, lng, accuracy from public.worker_live_locations
  order by recorded_at desc limit 5;
  ```
  New rows landing every ~20s.
- Clock Out → no false "Location access required" banner.

### 6. /my-tasks
- Worker session → `/my-tasks` → list of assigned tasks.
- Hydration: no warnings, no "Text content did not match".
- Toggle a task between in-progress / done → DB persists.

### 7. Mobile-specific
- iOS Safari: add the URL to Home Screen → opens as standalone PWA →
  GPS still works in standalone mode.
- Android Chrome: same; verify the install prompt appears.
- Both: NotificationBell polls every 30s — leave the page open for
  90s, send a message from another session, confirm the bell badge
  updates.

---

## Risks / differences vs local dev

| Concern | Local (`http://10.0.0.55:3000`) | Vercel staging |
|---------|--------------------------------|----------------|
| HTTPS | no — GPS is denied on phone | yes — full Geolocation API |
| Cert trust | n/a | trusted public CA, no warnings |
| AUTH_BYPASS | true (`.env.local` has the var) | false — real PIN required (omit `NEXT_PUBLIC_AUTH_BYPASS` on Vercel) |
| Cookies | `Lax` on `localhost` | `SameSite=Lax; Secure` on https — Supabase session cookie behaves like prod |
| Cold start | always warm | first request after idle takes ~500-1500ms (serverless) |
| Logs | `npm run dev` console | Vercel dashboard → Deployments → Functions → Logs |
| Env vars | `.env.local` (file on disk) | Vercel dashboard (per-environment) |
| Build errors | shown immediately by Turbopack | only at `vercel --prod` time — fix locally first via `npm run build` |
| Service worker | not registered | will register if the app ever ships one (currently doesn't) |

### Things that may surprise you

- **Service-role key in env vars**: Vercel encrypts these at rest. Still,
  treat the dashboard URL like a password — anyone who reaches your
  Vercel project settings can read the key. Limit team membership.
- **Maps API key referrer restriction**: if you forget step B above, the
  map will load on desktop dev (no restriction triggers from
  `localhost`) but break silently on Vercel. The browser console will
  log the actual reason.
- **Supabase Site URL vs Redirect URL**: Site URL is a single canonical
  origin used for password-reset emails etc. Redirect URLs is the
  allowlist for OAuth-style flows. The PIN-login route does not use
  redirects, so this only matters if you enable email magic links
  later.
- **Edge runtime**: this app does not opt into edge runtime anywhere.
  All server code runs on Node.js Lambda (good — `@node-rs/argon2` and
  `@react-google-maps/api` need Node).

---

## Going forward

- Make staging the **only** environment you test on from a phone.
  `npm run dev` on the laptop is fine for desktop iteration, but every
  feature that touches GPS / clipboard / camera should be exercised on
  staging.
- Push code to GitHub later and connect the repo in Vercel for
  automatic deploys on `git push`. One-time setup, no app changes.
- When the schema changes (Phase 1 / 3 migrations etc.), apply the SQL
  in the Supabase SQL editor BEFORE the matching app code hits
  staging — staging reads the same DB as local dev.
- If staging starts being shared with non-Vercel-account testers, flip
  AUTH_BYPASS to false (or env-driven) and rely on PIN auth. Don't
  share an open URL.
