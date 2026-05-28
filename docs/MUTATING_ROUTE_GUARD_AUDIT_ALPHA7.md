# Alpha-7 Mutating Route Guard Audit

Date: 2026-05-28

## Purpose

Track release-readiness expectations for routes and server helpers that can mutate data. This report complements:

```bash
npm run alpha7:route-mutation-map
npm run inventory:service-role
```

## Required Guard Pattern

Every mutating route should confirm:

- Authenticated actor exists.
- Actor profile is loaded server-side.
- Actor org/company scope is known server-side.
- Resource org/project/task belongs to the same org.
- Role permission is checked before mutation.
- Service-role/admin clients are used only after guard checks.
- Client-provided `org_id`, `user_id`, `profile_id`, or role values are not trusted by themselves.

## Release Freeze Rule

If a route is classified by the route mutation map as `dangerous unknown` or `needs manual review`, do not treat that as a deploy blocker automatically for docs/scripts/UI-only changes. If the route itself changed, create a separate security hotfix task before deploy.

## Areas Kept Untouched

- Payroll and salary archive mutation logic.
- GPS, geofence, clock-in/out, and shift mutation logic.
- Archive/trash mutation logic.
- Supabase RLS and Storage policies.
- Database schema and migrations.

## Manual Review Queue

- Service-role project routes.
- Media delete routes.
- Jarvis action routes.
- Team/role update routes.
- Worker task and message action routes.

Use `reports/alpha7-route-mutation-map.md` for the current local map after running the script.
