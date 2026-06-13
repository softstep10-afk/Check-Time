# DB-0 Gate

DB-0 Gate is mandatory before every migration, manual SQL pack, or schema-affecting task.

## Before Any Migration Or Manual SQL

1. Verify correct Supabase project ref.
   - Correct production project: `vlrajjwbaxikbwvqdpft`
   - Wrong project previously inspected: `khmcdtrzqfqabdpbcjkj`

2. Verify current production deploy and commit.
   - Read production metadata before planning SQL.
   - Stop if production does not match the task baseline.

3. Build a read-only schema map.
   - Tables
   - Columns
   - Constraints
   - Indexes
   - RLS state
   - Policies
   - Helper functions
   - Foreign keys

4. Table check.
   - Confirm whether every target table exists.
   - Confirm whether similarly named legacy or abandoned tables exist.

5. Column check.
   - Confirm required columns.
   - Confirm nullability.
   - Confirm defaults.
   - Confirm status or soft-delete fields.

6. Helper function check.
   - Confirm helper functions used by RLS or APIs exist.
   - Confirm helper semantics before relying on them.

7. RLS check.
   - Confirm RLS is enabled for target tables.
   - Confirm denied roles have no accidental access.

8. Policies check.
   - Confirm SELECT, INSERT, UPDATE, and DELETE policy intent.
   - No DELETE policy by default unless specifically approved.

9. FK check.
   - Confirm foreign keys to `organizations`, `profiles`, `projects`, `clients`, or other parent tables.
   - Confirm cascade behavior does not hard-delete sensitive records unexpectedly.

10. Migration history check.
    - Compare local migrations with remote migration history.
    - If history is not repaired, do not use `supabase db push`.

11. Prepare exact SQL.
    - SQL must be deterministic.
    - SQL must be scoped to the approved block.
    - SQL must avoid data mutation unless specifically approved.

12. Prepare verification SQL.
    - Verify tables.
    - Verify columns.
    - Verify constraints.
    - Verify indexes.
    - Verify RLS.
    - Verify policies.
    - Verify FKs.

## Current Migration History Rule

Manual migrations already applied:

- 00032 clients / client_contacts
- 00033 project_clients

Supabase CLI migration history is not repaired.

Do not run `supabase db push` until migration history repair is separately planned, approved, executed, and verified.

## Lesson Learned

The wrong Supabase project `khmcdtrzqfqabdpbcjkj` was initially inspected during Alpha-8 Clients Foundation work.

The correct production Supabase project is `vlrajjwbaxikbwvqdpft`.

Verifying the project ref is now a mandatory DB-0 Gate check before any SQL, migration, RLS design, or schema-dependent implementation.
