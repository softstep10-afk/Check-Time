# Alpha-7 Jarvis Action Audit

Mode: audit plus safe confirmation hardening only.

## Scope

- Verify Jarvis write actions prepare work first and require explicit owner/admin confirmation.
- Verify `create_task` and `create_project` report success only after the server returns a real created row id.
- Verify unsupported write actions do not get execution endpoints.
- Verify provider/model diagnostics remain owner/admin-only in the normal Jarvis page.

No model routing, prompt workflow, payroll, archive, role model, project lifecycle, RLS, Storage policy, schema, migration, production data, or deployment changes were made.

## Actions Inspected

### Assistant and voice routes

- `src/app/api/ai/assistant/route.ts`
- `src/app/api/ai/voice/route.ts`

Both routes return assistant answers and prepared actions. They log prepared actions for audit, but do not execute `create_task` or `create_project`. Memory writes remain owner/admin-only.

### Confirmation endpoints

- `src/app/api/ai/actions/create-task/route.ts`
- `src/app/api/ai/actions/create-project/route.ts`

Both endpoints require authenticated context and `canConfirmJarvisWriteAction`, which is owner/admin-only. The create-project endpoint now treats a missing inserted project id as failure, so the client cannot receive `ok: true` without a real project id.

### Client execution

- `src/components/manager/AiWorkspacePage.tsx`
- `src/lib/ai/action-endpoints.ts`

Only `create_project` and `create_task` map to confirmation endpoints. Navigation remains non-mutating. Unsupported write-like actions return no endpoint. The client reports success only when the endpoint response is OK and contains the expected non-empty id.

## Diagnostics

The normal Jarvis page still hides provider/model diagnostics unless the user is owner/admin. It now avoids collecting routing diagnostics when the user cannot see them.

## Tests

Covered by:

- `tests/lib/ai-action-endpoints.test.ts`
- `tests/lib/ai-assistant-skills.test.ts`
- `tests/lib/role-permissions.test.ts`
- `tests/lib/jarvis-diagnostics.test.ts`

Key assertions:

- `create_task` is prepared, not claimed created.
- `create_project` is prepared, not claimed created.
- Unsupported `send_message` has no execution endpoint.
- Confirmed write success requires the expected created id.
- Owner/admin can confirm Jarvis writes; manager, supervisor, and worker cannot.
- Diagnostics sanitize secrets and remain intended for owner/admin review.

## Deferred

- Direct SQL verification of production RLS/Storage state.
- Any new Jarvis write powers.
- Any role/access redesign.
- Any model-routing or prompt behavior redesign.
- Full authenticated production QA of Jarvis action confirmation.
