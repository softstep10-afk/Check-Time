# Money amount parsing dedup

Branch: `hygiene/money-amount-parsing` off `origin/claude/owner-dashboard-cleanup-rebased` at `4971ea0`.

## Scope

Added `src/lib/money-amount.ts` as a pure shared parser for `metadata.amount`.
It has no fetching, auth/session reads, Supabase calls, mutation, rounding, or formatting.

The utility preserves the legacy call-site families:

- `Number(value ?? 0)` with finite/zero fallback;
- finite `Number.parseFloat` with zero fallback;
- finite `Number.parseFloat` with `null` fallback;
- worker receipt display's loose parse behavior where invalid strings remain `NaN`.

## Call-site verdicts

Real duplicates replaced:

- `src/lib/manager-utils.ts` — replaced receipt total parsing in `buildProjectSummaries`; kept the existing `Number`-style conversion and positive/finite filter.
- `src/lib/ai/service.ts` — replaced assistant snapshot receipt parsing; kept the same `Number`-style conversion and positive/finite filter.
- `src/app/api/reports/annual/route.ts` — replaced annual report `readMoney(metadata)` internals; kept invalid/missing fallback `0`.
- `src/app/api/manager/projects/[id]/receipts/route.ts` — replaced receipt route `readMoney(value)` internals; kept finite `parseFloat` behavior and fallback `0`.
- `src/app/(manager)/archive/projects/[id]/page.tsx` — replaced archived project `receiptAmount(metadata)` internals; kept finite `parseFloat` behavior and fallback `null`.
- `src/app/(worker)/project/[id]/page.tsx` — replaced both preview and live receipt display amount projections; preserved raw number passthrough, `parseFloat` strings, missing `null`, and invalid string `NaN`.
- `src/lib/archive-utils.ts` — replaced only the archive receipt total `meta.amount` parse; preserved the local generic `toNumber` helper for payroll archive fields.

False positives left unchanged:

- `src/app/(manager)/trash/page.tsx` — cast-only display of `meta.amount`; no inline string/number parsing to deduplicate.
- Project detail forms, worker upload forms, payroll/profile rate paths, material quantities, and other numeric input parsers — not `metadata.amount` receipt parsing or semantics differ.

## Tests

Added `tests/lib/money-amount.test.ts` covering:

- number, string, zero, negative, missing, invalid, `NaN`, and infinity inputs;
- `Number(...)` coercion behavior used by manager/AI/annual paths;
- finite `parseFloat` with zero fallback used by receipts/archive totals;
- nullable finite `parseFloat` used by archive display;
- worker display's loose parsed values, including invalid string `NaN`.

## Guardrails

Did not touch:

- payroll computation logic itself;
- `profile_rates` handling;
- API route auth logic;
- offline queues or offline/client auth layer files;
- `WorkerShell.tsx`, `src/app/providers.tsx`, `authAwareFetch`, or offline libs.

No behavior change intended beyond replacing duplicated parsing with a shared pure utility.

## Gates

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | passed |
| `npm run lint` | passed with 7 existing warnings |
| `npm test` | passed: 135 files / 947 tests |
| `npm run smoke:core` | passed; `failures: []`, `warnings: []` |
| `npm run alpha7:predeploy` | passed, including production build |

STOP: no merge, push, or deploy.

## ИТОГ

Branch: `hygiene/money-amount-parsing`
Commit: recorded in final chat after commit
Report: `docs/handoff/HYGIENE_MONEY_AMOUNT_DEDUP.md`

Gates:
- `npx tsc --noEmit` — passed
- `npm run lint` — passed, 7 existing warnings
- `npm test` — passed, 135 files / 947 tests
- `npm run smoke:core` — passed, `failures: []`, `warnings: []`
- `npm run alpha7:predeploy` — passed, including production build

Call-site verdicts:
- Real replacements: `src/lib/manager-utils.ts`, `src/lib/ai/service.ts`, `src/app/api/reports/annual/route.ts`, `src/app/api/manager/projects/[id]/receipts/route.ts`, `src/app/(manager)/archive/projects/[id]/page.tsx`, `src/app/(worker)/project/[id]/page.tsx`, and the receipt-total call in `src/lib/archive-utils.ts`.
- False positives left unchanged: `src/app/(manager)/trash/page.tsx`, form/input numeric parsers, payroll/profile-rate logic, material quantity parsing.

Questions: none.
