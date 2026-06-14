# PROJECT STATE - Construction Clock

Machine-readable / human-readable state pack. Update this file after any phase
change, production deploy, security gate change, manual migration, or release
decision.

## Current Production
- URL: https://check-time-five.vercel.app
- deploy: dpl_7aJSyDWo619u8c9yBdbA7bNqdBGP
- commit: 6d6cee772145d6c5a18a61bf76e09013915865af
- branch: fix/postdeploy-qa-audit-patches
- last verified: 2026-06-13 from docs/project map; not reverified during this docs-only task

## Current Main
- branch: fix/postdeploy-qa-audit-patches
- HEAD: 590706e0c6d6e17117705e4ca792e77d0f1de8ff before docs-only PROJECT_STATE integration
- origin: git@github-alpha7-check-time:softstep10-afk/Check-Time.git
- clean: yes at docs-only integration start

## Active Track
- current module: L0 Security Hardening / H1C DB-level hourly_rate protection
- current phase: H1C candidate package prepared on feature branch
- status: app/code candidate prepared; SQL not applied; DB grant enforcement not closed
- next gate: owner review, DB-0 Gate, manual exact SQL approval for 00034, deploy/verify RPC path, then manual 00035 grant enforcement and H1D role verification

## Security Track
- H1A: DONE and deployed; safe profile DTO refactor removed rates from non-finance profile reads
- H1B: DONE in code; finance-gated rate read path centralized behind profile-rate helper
- H1C: IN PROGRESS / candidate only; 00034 RPC and 00035 profile column grants prepared, not applied
- H2: PLANNED; time_events / GPS visibility hardening brief exists, no SQL applied
- H3: PLANNED; tasks policy cleanup brief exists, no SQL applied
- H4: PLANNED; SECURITY DEFINER search_path / execute grant hardening brief exists, no SQL applied

## Database
- production Supabase ref: vlrajjwbaxikbwvqdpft
- db push allowed: no; supabase db push is forbidden until migration history repair is separately planned, approved, executed, and verified
- migration history: not repaired; supabase_migrations.schema_migrations absent in production Step 0 audit
- last manual migrations: 00029 storage policy hardening, 00030 database grants hardening, 00031 safety typed signatures, 00032 clients foundation, 00033 client project link
- pending migrations: 00034_security_h1c_rate_rpc.sql and 00035_security_h1c_profile_column_grants.sql are prepared but not applied; 00099_wash_and_reset.sql is forbidden and must never be run

## Queued Modules
- Project Finance Folder: queued; P0 contract prepared; implementation not started
- People Dossiers: queued; not started
- Client Portal: queued; not started
- Client Communications: queued; not started
- Estimates: queued; not started
- Invoices: queued; not started
- Change Orders: queued; not started
- AI / Atlas: queued; not started; no AI god-mode and no bypass channel

## Red Gates
- SQL: blocked unless owner explicitly approves exact SQL after DB-0 Gate
- migrations: blocked unless owner explicitly approves; never use supabase db push while migration history is unrepaired
- production deploy: blocked unless owner explicitly approves intended commit and checks pass
- production data: no mutation without explicit owner approval and exact repair plan
- RLS/grants: blocked unless task explicitly approves exact policy/grant hardening
- storage policies: blocked unless task explicitly approves exact Storage policy hardening
- payroll: do not change payroll calculations, paid periods, payroll archive, or compensation visibility without explicit owner approval

## Last Known Good
- Alpha-8 Phase 1B: DONE in production; deploy dpl_79ucDxQb79GAs2bYUhVYeUYo7LUZ; commit 25f336d1ca61f6e058aebd2e4dadfe247a4182ab
- H1A: DONE and deployed; deploy dpl_7aJSyDWo619u8c9yBdbA7bNqdBGP; commit 6d6cee772145d6c5a18a61bf76e09013915865af
- H1B: DONE in code and merged to main path; commit 590706e; production metadata was inspected as READY, final owner QA may still be pending

## Next Safe Action

Do not start Project Finance Folder, People Dossiers, Client Portal, estimates,
invoices, change orders, or AI/Atlas work yet. The next safe action is H1C:
run DB-0 Gate, get owner approval for exact manual SQL, apply 00034 first,
deploy/verify the RPC-backed app path, then apply 00035 only after the finance
rate screens pass. After H1C, run H1D role verification before leaving L0
Security Hardening.
