# Alpha-7 Mutation Surface Map

This map is a static code inventory for elevated mutations. It is not a substitute for Direct SQL Supabase Step 0.

## Project Routes

- `src/app/api/manager/projects/route.ts`
  - Method: `POST`
  - Mutation: create project.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, server-derived `profile.org_id`, finance guard for rates, project-save validation.
  - Preserved behavior: same-org manager/supervisor project create workflow remains.

- `src/app/api/manager/projects/[id]/route.ts`
  - Methods: `PATCH`, `DELETE`
  - Mutation: update project, move project to trash via soft delete.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, UUID route ID guard, target project scoped by `id` and `profile.org_id`, finance guard for rates, audit log.
  - Preserved behavior: soft-delete/trash meaning unchanged.

- `src/app/api/manager/projects/[id]/archive/route.ts`
  - Methods: `POST`, `PATCH`
  - Mutation: archive project.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, UUID route ID guard, update scoped by `id` and `profile.org_id`, audit log.
  - Preserved behavior: archive remains separate from trash.

- `src/app/api/manager/projects/[id]/planning/route.ts`
  - Method: `PUT`
  - Mutation: project planning settings/materials/estimations.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, UUID route ID guard, target project scoped by `id` and `profile.org_id`, finance guard for estimations.
  - Preserved behavior: project planning workflow unchanged.

## Task And Message Routes

- `src/app/api/manager/tasks/route.ts`
  - Method: `POST`
  - Mutation: create manager task.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, server-derived org, UUID validation for project/assignee/media IDs, task dispatch same-org checks.

- `src/app/api/manager/message-tasks/route.ts`
  - Method: `POST`
  - Mutation: create explicit priority-message tasks and link message metadata.
  - Elevated client: yes.
  - Guardrails: authenticated manager context, UUID validation for message/recipient/project IDs, message must belong to actor org and sender/recipient pair, idempotent existing-task lookup.
  - Preserved behavior: normal messages do not become tasks automatically.

- `src/app/api/worker/project-tasks/route.ts`
  - Method: `POST`
  - Mutation: worker-created project task.
  - Elevated client: yes.
  - Guardrails: authenticated worker profile, UUID project ID, same-org project lookup, existing assignment/exclusion checks, task dispatch same-org checks.

- `src/app/api/worker/claim-task/route.ts`
  - Method: `POST`
  - Mutation: claim unassigned project/delivery task.
  - Elevated client: yes.
  - Guardrails: authenticated profile, UUID task ID, user-scoped task read first, same-org check, project availability/access checks, predicate-narrowed admin update.

- `src/app/api/worker/tasks/seen/route.ts`
  - Method: `POST`
  - Mutation: task seen metadata and linked message read marker.
  - Elevated client: yes.
  - Guardrails: authenticated profile, UUID task ID array guard, same-org visible task read before updates, updates scoped by task ID and org.

## Media Routes

- `src/app/api/media/transcode/route.ts`
  - Method: `POST`
  - Mutation: media transcoding metadata.
  - Elevated client: yes.
  - Guardrails: authenticated user, UUID media ID, actor profile required, user-scoped media read, explicit media org equals actor org before admin update.

- `src/app/api/media/mux-webhook/route.ts`
  - Method: `POST`
  - Mutation: transcoding status from Mux webhook.
  - Elevated client: yes.
  - Guardrails: Mux signature verification, lookup by Mux asset ID, update scoped by matching media ID and org.
  - Note: no user session exists on webhook calls.

- `src/app/api/ai/photo-analysis/route.ts`
  - Method: `POST`
  - Mutation: media AI analysis persistence.
  - Elevated client: yes.
  - Guardrails: authenticated manager context or preview mode, UUID media ID, user-scoped media read, explicit media org equals actor org before admin update.

## Worker Video And Schedule Routes

- `src/app/api/worker/link-checkin-video/route.ts`
  - Method: `POST`
  - Mutation: link worker media to clock-in event.
  - Elevated client: yes.
  - Guardrails: authenticated user, UUID time event ID, shared link helper validates event ownership and media predicates.

- `src/app/api/worker/link-checkout-video/route.ts`
  - Method: `POST`
  - Mutation: link worker media to clock-out event.
  - Elevated client: yes.
  - Guardrails: authenticated user, UUID time event ID, shared link helper validates event ownership and media predicates.

- `src/app/api/schedule/route.ts`
  - Method: `POST`
  - Mutation: schedule item create, project date update, delivery claim/complete.
  - Elevated client: yes.
  - Guardrails: authenticated calendar actor, UUID guard for project/assignee/task IDs, same-org project/profile/task lookups, existing role allowances preserved.

## Deferred Surfaces

- `src/app/api/worker/clock-out/route.ts` remains out of scope for this pass because it touches clock/GPS/shift behavior.
- Team create/delete/reset-pin were previously hardened and were not changed in this project-route pass.
- Payroll routes remain out of scope.
- RLS/Storage policy verification remains blocked without Direct SQL access.
