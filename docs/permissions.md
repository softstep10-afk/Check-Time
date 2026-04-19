# Permissions Matrix

## Role Hierarchy

| Power | Role | Description |
|-------|------|-------------|
| 5 | **owner** | Full system access. One per org. |
| 4 | **admin** | Legacy alias, treated as near-owner. |
| 3 | **manager** | Dashboard access, team/project management. |
| 2 | **supervisor** | Field lead, extended worker permissions. |
| 1 | **driver** | Worker + receipt upload shortcut. |
| 1 | **subcontractor** | Worker equivalent. |
| 0 | **worker** | Basic clock/journal/tasks/hours. |

## Permission Matrix

| Action | Worker | Driver | Supervisor | Manager | Owner |
|--------|--------|--------|------------|---------|-------|
| Clock in/out | ✅ | ✅ | ✅ | ✅ | ✅ |
| View own hours | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload journal media | ✅ | ✅ | ✅ | ✅ | ✅ |
| Complete assigned tasks | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload receipts | ❌ | ✅ | ❌ | ✅ | ✅ |
| View manager dashboard | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage projects (CRUD) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage team members | ❌ | ❌ | ❌ | ✅ | ✅ |
| Assign tasks | ❌ | ❌ | ❌ | ✅ | ✅ |
| Force checkout workers | ❌ | ❌ | ❌ | ✅ | ✅ |
| Adjust worker hours | ❌ | ❌ | ❌ | ✅ | ✅ |
| Send messages to workers | ❌ | ❌ | ❌ | ✅ | ✅ |
| Soft-delete (Trash) | ❌ | ❌ | ❌ | ✅ | ✅ |
| Restore from Trash | ❌ | ❌ | ❌ | ✅ | ✅ |
| Prepare payroll drafts | ❌ | ❌ | ❌ | ✅ | ✅ |
| View reports (read-only) | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Approve pay periods** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Mark payroll as paid** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Re-open archived periods** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Edit company settings** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Manage managers** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Manage supply stores** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Purge GPS location data** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Export location CSV** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Generate/archive reports** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Transfer ownership** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Permanently delete (Trash)** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **View audit log** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Change any user's role** | ❌ | ❌ | ❌ | ❌ | ✅ |

## RLS Enforcement

All owner-only writes are enforced at the Supabase RLS level using:

```sql
CREATE FUNCTION is_owner() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'owner'
    AND deleted_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Key policies:
- `audit_log`: INSERT allowed for system triggers only. NO UPDATE or DELETE policies.
- `pay_periods`: UPDATE (status to approved/paid) requires `is_owner()`.
- `supply_stores`: INSERT/UPDATE/DELETE requires `is_owner()`.
- `profiles.role`: UPDATE requires `is_owner()` when target role >= manager.
- `worker_live_locations`: DELETE requires `is_owner()` (purge).

## Ownership Transfer

- Atomic: recipient becomes `owner`, initiator becomes `manager`.
- Requires: typed confirmation of recipient name + initiator PIN.
- Logged in `audit_log` with before/after snapshots.
- Guard: system always has >= 1 owner.
