# Media payload dedup

Branch: `hygiene/media-payload-dedup` off `origin/claude/owner-dashboard-cleanup-rebased` at `2b62ed3`.

## Scope

Added `src/lib/media-payload.ts` as a pure shared utility for media row payload construction:

- `buildMediaInsertPayload(...)`
- `buildProjectMediaMetadata(...)`
- `buildReceiptMediaMetadata(...)`

Replaced matching inline media insert payloads in:

- `src/components/worker/WorkerProjectView.tsx`
- `src/components/manager/ProjectDetailPage.tsx`
- `src/lib/task-attachments.ts`

The utility only builds plain objects. It does not upload, fetch, mutate, read auth/session state, or call Supabase.

## Call-site notes

Real duplicates replaced:

- project media uploads: same `media` insert row fields, default `caption: null`, `is_checkout: false`, `time_event_id: null`;
- delivery/material receipt uploads: same `media` insert row fields plus receipt metadata;
- task attachment upload helper: same `media` insert row shape with task attachment metadata.

Confirmed false positive:

- `src/app/(worker)/project/[id]/page.tsx` does not construct insert payloads; it performs display projection/splitting. Project media attachment refs there already use `toMaterialMediaAttachmentRef` from `src/lib/materials-grouping.ts`, so no new dedup was forced.

## Tests

Added `tests/lib/media-payload.test.ts` covering:

- full media insert payload shape;
- default `caption`, `is_checkout`, and `time_event_id` fields;
- explicit checkout/time-event edge case;
- project media metadata with and without source;
- receipt metadata preserving store, amount, purchase date, and uploader name.

## Guardrails

Did not touch:

- `cc_offline_*` queues;
- `offline-uploads.ts`;
- `WorkerShell.tsx`;
- money/auth logic;
- `/api` route logic;
- manager page Suspense/data-fetching structure.

No behavior change intended beyond replacing duplicated object construction.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | passed |
| `npm run lint` | passed with 7 existing warnings |
| `npm test` | passed: 129 files / 917 tests |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |

STOP: no merge, push, or deploy.

## ИТОГ

Branch: `hygiene/media-payload-dedup`
Commit: recorded in final chat after commit
Report: `docs/handoff/HYGIENE_MEDIA_PAYLOAD_DEDUP.md`

Gates:
- `npx tsc --noEmit` — passed
- `npm run lint` — passed, 7 existing warnings
- `npm test` — passed, 129 files / 917 tests
- `npm run smoke:core` — passed, `failures: []`, `warnings: []`

Plan summary:
- Extracted pure media payload builders into `src/lib/media-payload.ts`.
- Replaced real duplicate insert payload construction in worker project uploads, manager project uploads, and the task attachment helper.
- Left `src/app/(worker)/project/[id]/page.tsx` unchanged as a display-projection false positive.

Questions: none.
