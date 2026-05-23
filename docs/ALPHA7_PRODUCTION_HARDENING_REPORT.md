# Alpha-7 Production Hardening Report

Production URL: `https://check-time-five.vercel.app`

Deployed baseline before this pack: `303f3588af73731df1e6808d8676da339d781037`

## Scope

This hardening pack prepares owner QA without mutating production data. It adds a safe owner/admin path for assigning the existing `driver` role and adds local regression gates/reports.

## Driver Role Setup

- The `driver` role already exists in the app model.
- Driver is not manager-tier.
- Driver remains worker-like and enables the material-focused queue.
- Owner/admin can assign `driver` through Team profile editing.
- Manager/supervisor/worker cannot assign `driver`.
- Sanya is not hardcoded. Sanya must have role `driver` to appear in material dropdowns.

## Regression Gates

- `npm run alpha7:danger-zones`
- `npm run alpha7:route-guards`
- `npm run alpha7:coverage-map`
- `npm run alpha7:rc-safety-gate`

Generated reports:

- `reports/alpha7-route-mutation-guard-map.md`
- `reports/alpha7-route-mutation-guard-map.json`
- `reports/alpha7-coverage-map.md`
- `reports/alpha7-coverage-map.json`

## Manual Review Areas

Static route scanning is conservative. Some AI/audit/helper routes may appear as `needs manual review` or `dangerous unknown` because static text cannot prove runtime guard flow. These are not declared vulnerabilities.

## Not Changed

- No production data mutation.
- No SQL.
- No migrations.
- No database schema changes.
- No Supabase RLS changes.
- No Storage policy changes.
- No payroll/archive/GPS/shift changes.
- No media delete privilege semantics changes.
- No message/task lifecycle redesign.
- No deployment.
