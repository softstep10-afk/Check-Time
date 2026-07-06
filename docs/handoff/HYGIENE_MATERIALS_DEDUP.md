# Hygiene Materials Dedup

Branch: `hygiene/materials-grouping-dedup`.

## Confirmed Call-Sites

The duplicated material order grouping was confirmed in:
- `src/components/worker/WorkerProjectView.tsx`
- `src/components/manager/ProjectDetailPage.tsx`

The two route/page display shapers from the prompt were also checked and moved
onto shared media predicates where behavior matched:
- `src/app/(worker)/project/[id]/page.tsx`
- `src/app/(manager)/archive/projects/[id]/page.tsx`

## Change

Added `src/lib/materials-grouping.ts` as a pure, side-effect-free utility.

It now owns:
- `groupMaterialOrderItems()` for order-id/legacy material grouping.
- Existing grouping behavior: group by `metadata.order_id`, fallback to
  `legacy-${item.id}`, read `metadata.order_note`, keep earliest group
  `createdAt`, sort group items oldest-first, and sort groups newest-first.
- Optional link selection for the manager material view, preserving the previous
  "first available link in the group" behavior.
- Project media/receipt predicates used by the worker project route and archive
  project route.

No fetching, mutation, money parsing, API auth/money route, offline queue, or
message-mapping logic was changed.

## Tests

Added `tests/lib/materials-grouping.test.ts` covering:
- order grouping by `order_id`;
- legacy grouping fallback;
- note preservation;
- earliest group `createdAt`;
- item/group sort order;
- first available group link;
- project media vs receipt split;
- worker receipt filtering hook;
- archive category-only receipt predicate.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npx vitest run tests/lib/materials-grouping.test.ts` | 1 file / 4 tests passed |
| `npm run lint` | clean exit; 7 pre-existing warnings |
| `npm test` | 127 files / 907 tests passed |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |

No DB/RLS/migration changes.

## STOP

No merge, push, or deploy.
