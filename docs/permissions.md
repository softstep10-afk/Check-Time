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

## Photo / Media Visibility (Wave X2)

Once `00011_media_project_privacy.sql` has been applied, the `media`
table SELECT policy is split by role. The change is purely additive at
the schema level (existing `INSERT` / `UPDATE` / `DELETE` policies are
untouched):

| Role | Can SELECT |
|------|-----------|
| `worker`, `driver`, `subcontractor` | • Media for projects they are currently in `project_assignments` for.<br>• Plus any media they uploaded themselves (own journal, regardless of current assignment status). |
| `supervisor`, `manager`, `admin`, `owner` | All non-deleted media in their org (existing org-wide visibility preserved — supervisors keep it because they're rotated across crews). |

### Implementation notes

- **RLS handles the filter automatically** through the SSR Supabase
  client. The worker shell (`src/lib/worker-data.ts`) only fetches
  `media WHERE uploaded_by = self`, which is strictly narrower than
  the policy, so no app-level change is needed there.
- **The admin client bypasses RLS.** The only worker-relevant route
  that uses it is `src/app/api/ai/photo-analysis/route.ts`, which is
  already gated by `requireManagerContext()` — workers can't trigger
  it. Comments at both call sites point this out for future
  reviewers.
- **Storage bucket policies are out of scope** for the SQL migration
  in 00011. The signed URLs returned by
  `storage.from('media').getPublicUrl(...)` are public — anyone with
  the URL can fetch the file. Tightening that requires a separate
  Supabase Storage policy pass and is tracked separately.
- **AUTH_BYPASS demo mode mirrors the rule** in
  `src/lib/preview-data.ts → buildPreviewWorkerShellData()` so the
  demo doesn't leak photos from sites the preview worker isn't
  assigned to.

### Storage path convention

`media/{orgId}/{projectId}/{date}/{filename}` — the project segment
in the path matches `media.project_id`, so a future bucket policy
can reuse the same `project_assignments` check.
