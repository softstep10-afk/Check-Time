# Message mapping dedup

Branch: `hygiene/message-mapping-dedup`.

## Scope

Added `src/lib/message-mapping.ts` as the shared pure mapping utility for message display rows. It centralizes:

- priority inference from `priority`, `metadata.priority`, legacy color, then `info`;
- attachment normalization for display message rows;
- `messages` table row to `AppMessage` mapping;
- manager broadcast history row mapping.

Updated real duplicate call-sites only:

- `src/components/worker/NotificationBell.tsx`
- `src/components/worker/WorkerMessagesPage.tsx`
- `src/components/manager/ManagerWorkAlertBell.tsx`
- `src/components/manager/BulkMessageComposer.tsx`

Confirmed false positives / no matching display mapping changed:

- `src/components/manager/SendMessageForm.tsx` sends/queues messages and builds upload payloads.
- `src/components/manager/TeamMemberPage.tsx` passes IDs/names to `SendMessageForm`.
- `src/components/manager/ForceCheckoutButton.tsx` inserts a notification message.
- `src/components/manager/AiWorkspacePage.tsx` uses local UI status messages, not `AppMessage` display mapping.
- `src/app/(manager)/messages/page.tsx` only passes manager/crew data into `BulkMessageComposer`.
- `src/app/(manager)/command-center/page.tsx` only embeds `BulkMessageComposer`.

No worker PWA update banner/SW registration code, offline queues, money/auth logic, manager page data fetching, Suspense structure, or `manager-data.ts` was touched.

## Tests

Added `tests/lib/message-mapping.test.ts` covering:

- priority inference order and legacy color fallback;
- notification-style blank sender names and undefined empty attachments;
- worker history name callback, fallback color, and null empty attachments;
- attachment normalization modes used by notification/history displays;
- manager alert behavior with no metadata and no displayed attachments;
- broadcast history row mapping.

## Gates

`npm ci` was run first because the checked-out base references `@serwist/turbopack` and `node_modules` was missing that lockfile dependency locally.

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | passed |
| `npm run lint` | passed with 7 existing warnings |
| `npm test` | passed: 130 files / 926 tests |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |

STOP: no merge, push, or deploy.

## ИТОГ

Branch: `hygiene/message-mapping-dedup`
Commit: recorded in final chat after commit
Report: `docs/handoff/HYGIENE_MESSAGE_MAPPING_DEDUP.md`

Gates:
- `npx tsc --noEmit` — passed
- `npm run lint` — passed, 7 existing warnings
- `npm test` — passed, 130 files / 926 tests
- `npm run smoke:core` — passed, `failures: []`, `warnings: []`

Plan summary:
- Extracted shared pure message mapping helpers into `src/lib/message-mapping.ts`.
- Replaced only the real duplicate display mappers in NotificationBell, WorkerMessagesPage, ManagerWorkAlertBell, and BulkMessageComposer.
- Left suspected send-only/prop-passing false positives unchanged.

Questions: none.
