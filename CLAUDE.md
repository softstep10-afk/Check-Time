# Construction Clock — Working Agreement (canonical)

Single source of truth for how AI coders (Claude Code / Codex) work on this repo.
**Codex: `AGENTS.md` points you here — read this file fully before doing anything.**

---

## RED LINE — scope discipline (the most important rule)
**Never remove or change ANY existing functionality beyond exactly what was asked.**
- Every edit is strictly minimal and surgical. Do ONLY the change discussed — nothing more.
- A fix must NEVER make some other existing feature, button, field, behavior, or data disappear
  as a side effect. The user asks for X → only X changes; everything else stays byte-for-byte.
- Prefer the smallest diff that achieves the asked-for result. Hiding/gating beats deleting when
  the goal is "don't show this here."
- Before committing, re-read your own diff line by line and confirm it removes/alters nothing the
  task did not explicitly name. If it does, revert that part.
- If achieving the request seems to require removing or altering existing functionality, do NOT
  proceed silently — surface it to chat and wait for an answer.

## Who / how (non-negotiable)
- Andrew owns the company and the product. Technically literate but does **not** write code.
  Never dump raw stack traces / PowerShell errors on him — translate to plain language.
  When a command fails, **diagnose and retry yourself**; don't ask him to debug.
- Full communication style & rules: see `ABOUT_ANDREW.md`.
- Roles: Owner > Admin > Manager > Supervisor > Driver > Worker.

## The loop (variant 2 — read carefully)
- Andrew dictates a bug → chat-side architect (Claude) writes a focused prompt → Andrew pastes it
  here → **you do the code work.**
- Chat-side Claude does NOT edit repo source files. If you find uncommitted changes on disk you
  didn't make, they're hotfixes from chat awaiting commit — ask before touching them.
  (Exception: `CLAUDE.md` / `AGENTS.md` may be updated from chat-side; just commit them.)
- **Fix your own errors. Do not bounce routine failures back to Andrew.** Read your own
  tsc / lint / test / runtime / Supabase errors and fix them. Loop until green. Escalate to chat
  ONLY a genuine blocker: an ambiguous product decision, a risky RLS/security change, or missing
  info you cannot derive. Routine compile/test errors are yours to solve.

## Supabase MCP — you have READ access. Use it to self-verify.
- You can read prod: schema, RLS policies, logs. Project `vlrajjwbaxikbwvqdpft`.
- **After any DB-affecting change, query the logs yourself and confirm zero new errors before
  reporting done.** This is now your step, not Andrew's.
- **Never run destructive SQL** (DROP / DELETE / TRUNCATE / column-dropping ALTER). The MCP is
  read-only by design. Schema changes ship as migration files that **Andrew applies by hand**.
- Migration head: `00032_profile_rates.sql`. New migration = next number (`00033_…`) as a file
  under `supabase/migrations/`. You write it; you do NOT push or apply it.

## RLS / shared-data discipline (L0 — the security foundation)
- Never change shared data — `profiles`, `time_events`, rates, RLS policies, grants — without first
  producing a FULL MAP of every place affected (every read/write/policy). Change wide → verify wide.
- If a task touches RLS / grants / shared columns and you don't have the full map: STOP and produce
  it. Do not edit blind. This has caused production regressions before.

## "Done" = three checkmarks
1. Full gate green (below).
2. Supabase logs show zero new errors.
3. Andrew eyeballs the screens. ← his step. You provide 1 + 2 and report concisely.

## Verify before you say done
- `npx tsc --noEmit` clean
- `npm run lint` not worse than current baseline
- `npm test` green (vitest)
- Anything touching routes / auth / security, also run `npm run smoke:core` and
  `npm run alpha7:predeploy` (and `alpha7:rc-safety-gate` before a release candidate)
- Do NOT flip `AUTH_BYPASS_ENABLED` back on. Real auth is live.

## Branch / deploy
- Work on a feature branch off `main`, never on `main`. Andrew (or the pasted prompt) names it.
- Every logical change = its own commit: `area(scope): what changed`.
- **Never merge to main. Never deploy.** Andrew reviews, merges, and deploys by hand.

## Stack quick facts
- Next.js 16.2.3 (App Router, Turbopack) — **NOT the Next you know**; check
  `node_modules/next/dist/docs/` before using framework APIs. Heed deprecations.
- React 19.2.4, TypeScript, Tailwind 4.
- Supabase (`vlrajjwbaxikbwvqdpft`) + PostGIS, `@supabase/ssr`.
- Auth: PIN-only `/api/auth/pin-login` (argon2). Seed owner Andrew, PIN 9999.
- Dev: `npm run dev` (`next dev -H 0.0.0.0`), LAN-exposed for mobile testing.

## Key locations
- Migrations: `supabase/migrations/` (head 00032)
- Auth: `src/app/api/auth/pin-login/route.ts`, `src/app/(auth)/login/page.tsx`
- Auth gate/proxy: `src/proxy.ts`; preview guard `src/lib/auth-bypass.ts`
- Role check: `src/lib/manager-utils.ts` `isManagerRole()` (owner+admin+manager+supervisor)
- Geo: `src/lib/worker-utils.ts` `parseGeoPoint` (WKB-aware); maps `src/components/maps/*`
- RBAC matrix: `docs/permissions.md`; GPS consent: `GPS_CONSENT_FORM.md`

## Old docs = archive, not current truth
`HANDOFF.md`, `PROGRESS_LOG.md`, `IMPLEMENTATION_PLAN.md`, `PLAN_*.md`, `AUDIT_REPORT.md`,
`OLD_APP_FINDINGS.md`, `STAGING_MOBILE_REPORT.md` are historical context only. The live source of
truth for current tasks is the prompt Andrew pastes (driven by chat-side START_HERE.md /
PROJECT_BACKLOG.md). When in doubt, the pasted prompt wins.

## Reports go to disk
When a task's deliverable is a report, analysis, or recon (not code), write the full text to
`docs/handoff/<topic>.md` in the repo and reply in chat with only a short summary and the file path.

## Applied by hand (migrations already live in prod)
Migrations Andrew has applied to prod directly — these are DONE; do NOT re-flag as outstanding:
- `00045_paid_api_usage.sql` — applied 2026-07-05; `paid_api_usage` table (paid-route rate
  limiter state) is live in prod.
