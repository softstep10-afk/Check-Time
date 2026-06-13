# Block Build Recipe

Every future module must follow this recipe. Do not skip steps to satisfy an out-of-order feature request.

## Standard 8-Step Recipe

1. Data contract
   - Define entities, allowed states, ownership, sensitive fields, and cross-entity relations.
   - Confirm what is explicitly out of scope.

2. SQL pack plus verification SQL
   - Prepare exact SQL for manual application or migration only after approval.
   - Prepare verification SQL before any schema change is applied.
   - Do not run `supabase db push` until migration history is repaired.

3. RLS policy design
   - Define allowed roles.
   - Define grant checks for sensitive data.
   - Define denied roles.
   - Define no-delete behavior unless deletion is explicitly approved.

4. API layer
   - Add server-side reads and mutations.
   - Validate inputs.
   - Enforce org, role, grant, and project boundaries before touching data.

5. UI read-only first
   - Ship list/detail surfaces before mutation flows.
   - Hidden UI is not security. Server checks and RLS remain required.

6. Audit/activity
   - Write audit events for sensitive changes.
   - Keep audit events stable enough for owner review and future AI action review.

7. Role QA matrix
   - Test owner/admin.
   - Test granted and ungranted manager.
   - Test granted and ungranted sales.
   - Test worker, supervisor, driver, and client denial paths where applicable.

8. Update docs/Карта проекта.md
   - Record status, deploy, commit, migration status, blocked follow-ups, and queue changes.

## Definition of Done

A block is DONE only when:

- schema design is approved
- RLS design is approved
- exact SQL and verification SQL exist when schema changes are needed
- implementation is scoped to the approved block
- tests/checks pass or known gaps are explicitly accepted
- no forbidden module was started
- docs/Карта проекта.md is updated
- production deploy happens only after Step 0 production verification and explicit deploy approval

## STOP Conditions

Stop and return BLOCKED if:

- git status is dirty before starting and the changes are not yours
- production deploy or commit differs from the supplied baseline
- Supabase project ref is uncertain
- schema state is uncertain
- migration history mismatch affects the planned change
- requested work requires SQL but SQL is not approved
- requested work would touch payroll, GPS, clock-in/out, auth, storage policies, or project permissions outside the approved block
- requested work would expose client-visible data without an approved visibility model
- Vercel or Supabase settings would need to change without explicit approval
- owner request conflicts with the safe build order

## What Counts As BLOCKED

BLOCKED means the agent cannot safely continue without owner approval, a verified baseline, or a separate repair plan. It is not a failure. It is the correct state when continuing would create production, security, or data risk.

## Out-of-Order Owner Requests

Owner may introduce ideas anytime. If the idea conflicts with the current safe build order:

1. State the current layer.
2. Assign the request to the correct future layer.
3. Add or update the queue in docs/Карта проекта.md.
4. Return to the current approved task.
5. Do not start new implementation until the current block is DONE.
