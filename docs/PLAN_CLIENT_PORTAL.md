# Client Portal — Phase 1–2 Report (Read-Only Audit + Architecture Proposal)

**Status:** Read-only audit complete. No code changes, no migrations, no RC worktree touched.
**Scope:** Phases 1 and 2 only. Phase 3 (UI skeleton) and Phase 4 (future map) deferred.
**Date saved:** 2026-05-20

---

## Phase 1 — Current State (Read-Only Audit)

### Project model
- `Project` table + `project.settings` (JSONB).
- Worker linkage: `project_assignments`, plus `project_access_mode` (`list` / `all_active`) and `project_exclusions`.
- **No project ↔ client relationship exists at all.**

### Media / files
- `Media` table (photo/video/pdf/document), linked to project via `project_id`.
- RLS (migrations `00011` / `00020`): manager-level sees all in org; worker sees only assigned projects + own uploads.
- **No "visible to client" flag.**
- Planning files (drawings / specs) live in `project.settings.attachments`, not in a dedicated table.

### Invoice / estimate / change-order
- Already exist as a concept, but stored **inside `project.settings`** under key `project_estimations` — not in a separate table.
- The `ProjectEstimate` type already separates:
  - `clientPrice` (what a client would see)
  - `internalCost`, `materialCost`, `laborHours`, `margin` (internal-only)
- Statuses: `draft → sent → approved → paid`.
- **Good news for the portal:** the client/internal split already exists in the type.
- **Bad news:** both halves live in the same JSON blob, so they cannot be safely exposed via RLS as-is.

### Roles / profile
- Role ladder (`roles.ts`): `worker → driver/sales/subcontractor → supervisor → manager → admin → owner`.
- **No `client` role exists.**
- Finance access (`finance-access.ts`): hardcoded owner/admin only, not surfaced through capabilities.

### Project access
- Auth-gate (`proxy.ts`) only checks for a Supabase session.
- Role-based routing lives in `app/page.tsx` (owner/admin/manager → `/overview`, sales → `/schedule`, others → `/clock`) and in route-group layouts.

### Layout pattern
- Route groups: `(auth)`, `(manager)`, `(worker)`.
- Each group: thin server-layout loads data → wraps content in a `*Shell` component.
- **No `(client)` group exists — the slot is clean.**

---

## Phase 2 — Client Portal Architecture Proposal

### Routes
- New route group: `app/(client)/`
  - `/client` — dashboard (client's projects + progress)
  - `/client/project/[id]` — single-project detail view
- New branch in `app/page.tsx`: `role === "client" → /client`

### Pages
- **Dashboard:** list of the client's projects + progress at a glance.
- **Project detail:** progress / milestones, owner-approved photos, videos, PDFs / drawings, approved invoices / change-orders (showing **`clientPrice` only**). Later: messages / updates.

### What the client SEES (owner-approved only)
- Progress
- Selected photos / videos / PDFs
- Selected milestones
- Approved invoices / change-orders — **client price only**

### What the client MUST NOT see
- Payroll
- Worker GPS / location
- Other clients' projects
- Internal notes
- Receipts / cost of goods
- `internalCost`, `materialCost`, `margin`
- Audit logs
- AI / Jarvis logs
- Un-approved media

### Key architectural finding
**Estimate / invoice data cannot be exposed to the client via RLS alone** — internal cost lives in the same `settings` blob as `clientPrice`. Two viable approaches:
1. **Server-side projection:** an API route returns only client-safe fields.
2. **Separate table** for client-facing documents.

Same problem for media: an explicit "approved for client" flag is required, and it does not exist today.

### What is needed later (NOT in this task)
- `client` role added to the role enum
- `project_clients` linkage table
- Visibility flag on `media`
- Client-safe projection of estimate / invoice
- RLS policies for the `client` role
- Storage policies for approved files
- Client invite / login flow
- Audit logging for "shared / un-shared"

---

## What is safe to build as a UI-only skeleton (a separate later task)

**Safe (Phase 3 candidates):**
- `(client)` route group
- `ClientShell` component
- Dashboard skeleton
- Project-detail skeleton
- Empty states
- Explicit copy: "you only see items the owner has approved"
- All on **mock / stub data**
- Behind a safe flag
- No links to real tables
- No real-client routing

**Blocked until a separate decision (NOT allowed in the skeleton):**
- Any real client access to data
- The `client` role
- Any RLS / storage / auth changes
- `project ↔ client` linkage
- `approved` flag on media
- Estimate projection

---

## Worktree / branch plan for Phase 3 (decided)

**Do NOT use:**
- The dirty `wip/uncommitted-recovery` branch / worktree.
- An old `main` branch if it does not match current production / current release.
- The Command Center / Jarvis RC worktree.

**Correct base for the future Phase 3 skeleton:**
1. Wait until Codex finishes the current Command Center + Jarvis RC production deploy.
2. After that deploy, use the **clean committed / deployed HEAD** as the base.
3. Create a separate worktree / branch for the Client Portal UI skeleton (e.g. `check-time-client-portal`).
4. Do not touch the Command Center / Jarvis RC.
5. Do not touch RLS, migrations, auth / roles, project access, payroll, clock, or Safety Brief.

---

## Hygiene notes (informational, not blockers)

- `finance-access.ts` references migration `00030_owner_admin_finance_only.sql`. That file is **not present** on disk in the main worktree (numbering goes up to `00028` plus `00099`). Likely lives in the RC worktree. Just noting it.
- `HANDOFF.md` is dated 12 May and barely mentions the Command Center / Jarvis RC, even though both are in the tree. Tree has moved ahead of the docs. Normal.
- `tsc` / lint / build were **not** run — this was a read-only phase on a dirty worktree, so running them would have been meaningless.

---

## Next decision (deferred)

Phase 3 (UI-only skeleton) is **not** authorized yet. It will be re-evaluated **after** the Codex Command Center + Jarvis RC deploy lands in production.
