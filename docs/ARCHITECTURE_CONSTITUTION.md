# Architecture Constitution

This document defines the permanent engineering rules for Construction Clock after Alpha-8 Phase 1B. It is a planning and governance document only. It does not implement Project Finance Folder, Client Portal, estimates, invoices, or AI actions.

## L0 Foundation Rules

1. Every domain table has `org_id` where the record belongs to an organization.
2. `profiles` is the identity and role base. Application roles start there.
3. Role is not enough for sensitive access. Sensitive folders require explicit grants.
4. Project Finance Folder access is grant-based for selected managers and sales. Owner/admin retain full access.
5. Every sensitive read or mutation uses server checks plus RLS. UI hiding is cosmetic only.
6. `audit_log` is the single audit source for sensitive state changes.
7. Soft delete, `status`, `is_active`, or archive state is the default. Hard delete is exceptional and must be explicitly approved.
8. Storage is private by default. Files are viewed or downloaded through signed URLs generated after access checks.
9. Standard columns should be used unless there is a documented reason not to use them:
   - `id`
   - `org_id`
   - parent entity ids such as `project_id`, `client_id`, or `user_id`
   - `status` or `is_active`
   - `created_at`
   - `updated_at`
   - `created_by`
   - `updated_by`
10. DB-0 Gate is required before every migration or manual SQL pack.
11. Manual exact SQL plus verification SQL remains the operating model until Supabase CLI migration history is intentionally repaired.
12. `supabase db push` is forbidden until the migration-history repair is planned, approved, executed, and verified.

## AI-Ready Water

Future AI must operate in water that is safe for humans first:

- Important state lives in database tables, not only in React state.
- Entity relationships are stable and queryable: organization, profile, client, project, grant, document, message, approval, invoice, estimate, and audit event.
- AI uses the same server APIs as humans.
- AI reads under the current user's role and RLS permissions.
- AI can draft, classify, summarize, and propose.
- Owner approves sensitive actions.
- The system executes approved actions.
- `audit_log` records the final action and, where needed, the proposal and approval trail.

## Hard AI Rule

No AI god-mode.

No bypass channel.

AI must not bypass RLS, grants, owner approval, audit logging, private storage, payroll boundaries, GPS boundaries, or client-visible publishing rules.

## Sensitive Access Rule

The following domains require explicit design before implementation:

- Project Finance Folder
- Project Finance Access Grants
- client-visible documents
- estimates
- invoices
- change orders and extras
- payroll and labor rates
- GPS and internal location data
- storage policies and signed URL generation
- AI actions

When owner requests work in one of these domains before the current layer is ready, record it in the queue and return to the current approved block.
