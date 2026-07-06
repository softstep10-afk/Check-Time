# Receipts + PIN hygiene

Branch: `hygiene/receipts-pin-hygiene` off `claude/owner-dashboard-cleanup-rebased` at `6a02887`.

## C-M2 receipts

The manager project receipts section no longer reads receipt rows directly from
the browser with `supabase.from("media").select("*")`.

Added `GET /api/manager/projects/[id]/receipts`:
- Authenticates with `supabase.auth.getUser()`.
- Reads actor `id, role, org_id` and gates with `isManagerRole(actor.role)`.
- Verifies the project with `.eq("org_id", actor.org_id)`.
- Reads receipts from `media` with `.eq("org_id", actor.org_id)`, project id,
  receipt category, `deleted_at is null`, a narrow column list, and a bounded
  `RECEIPT_ROW_LIMIT` window.
- Preserves the previous finance behavior: finance-capable managers see all
  project receipts; non-finance managers are narrowed to their own uploads.
- Signs media URLs server-side and returns the same `ReceiptItem` shape the UI
  already rendered.

Visible UI is unchanged: same collapsible receipts section, same upload form,
same grid, same delete path, same total/count calculation over loaded rows.

## S-L2 reset PIN

`/api/team/reset-pin` previously returned `{ ok: true, pin: newPin }`.

The UI consumer is `src/components/manager/TeamMemberPage.tsx`: it reads
`result.pin` to display the new PIN in the existing manager flow. No caller reads
`ok`, so the route now returns only `{ pin: newPin }`. PIN generation and length
were not changed.

## Scope

Did not touch worker-utils, ai/service, manager-utils, or overview page.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean exit; 7 pre-existing warnings |
| `npm test` | 125 files / 889 tests passed |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |
| `npm run alpha7:predeploy` | passed, including production build |

Supabase logs: no Supabase MCP/log tool is exposed in this Codex session
(`tool_search` only returned OpenAI docs and node_repl MCP tools). No migration,
RLS, grant, or data mutation was made.

STOP: no merge, push, or deploy.
