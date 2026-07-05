# Worker bundle split — C-M8 / C-M9

Branch: `claude/worker-bundle-split` (off `claude/owner-dashboard-cleanup-rebased`).

**Goal.** Crew phones cold-start slowly. Two audit findings: `/clock` loads the
Google Maps JS even when no map is on screen (C-M8), and heavy worker-flow
modals ship in the initial bundle (C-M9). Fix: code-split those pieces with
`next/dynamic` so they load only when actually rendered. Behavior is identical
— only load timing changes.

## Offenders found

| Component | Route | Weight | Rendered when |
|-----------|-------|--------|---------------|
| `WorkerGpsCheckMap` → `@react-google-maps/api` | `/clock` | 7.3 MB installed; ~164 KB client chunk | only after a clock-in GPS fence check |
| `CheckoutModal` | `/clock`, `/project/[id]` | pulls `TextInputWithVoice` → `VoiceInput` | only when the worker taps "End shift" |
| `WorkerTaskDetailModal` | `/project/[id]` | large task/materials detail modal | only when a task is opened |
| `SafetyBriefModal` | `/project/[id]` | safety-ack modal | only on the safety-brief step |

Nothing else in the worker flow imports `@react-google-maps/api`, so splitting
`WorkerGpsCheckMap` fully removes it from the `/clock` first-load graph.

## Change

- `next/dynamic(() => import(...).then(m => m.X), { ssr: false })` for each
  component above. All are client-only (browser Google Maps / interaction-driven
  modals), so `ssr: false` is correct and matches prior behavior.
- Each modal is now mounted only when its existing open/selection condition is
  true (`checkoutOpen`, `safetyOpen`, `liveSelectedTask`). This is
  behavior-equivalent: every one of these modals already returned `null` when
  its condition was false, so the rendered DOM is unchanged — the chunk simply
  isn't fetched until the modal is actually opened.
- The GPS map keeps its existing conditional render; it gains a minimal
  full-size `loading` placeholder (matches the map container background) for the
  brief chunk-fetch window. `GoogleMaps` already shows its own "Loading map…"
  state once the API script loads.
- `deriveShiftReview` and the edit dialog were **not** touched.

Files: `src/components/worker/ClockPage.tsx`,
`src/components/worker/WorkerProjectView.tsx`.

## Measurement — first-load JS (from `next build`)

Turbopack's build table doesn't print the Size column, so first-load JS was
measured directly from the build output: the union of client chunks each route
references synchronously (`page_client-reference-manifest.js`) plus the shared
root/polyfill files (`build-manifest.json`), summed on disk raw and gzipped.
`next/dynamic(ssr:false)` chunks are excluded from that set — they load on
demand — which is exactly the effect we want.

### `/clock`  (primary target)

| | Before | After | Δ |
|--|--|--|--|
| First-load JS (raw)  | 1344.6 KB | 1186.4 KB | **−158.2 KB (−11.8%)** |
| First-load JS (gzip) | 380.9 KB  | 345.3 KB  | **−35.6 KB (−9.3%)** |
| Google Maps in first-load graph | **YES** | **no** | removed |

### `/project/[id]`  (worker project view)

| | Before | After | Δ |
|--|--|--|--|
| First-load JS (raw)  | 1287.8 KB | 1262.3 KB | −25.5 KB (−2.0%) |
| First-load JS (gzip) | 370.6 KB  | 365.5 KB  | −5.1 KB (−1.4%) |

The `/clock` win is the headline: Google Maps is gone from the initial load and
now streams in only if a fence check is shown. The `/project/[id]` modals are
lighter and share some code with already-loaded chunks, so the number is
smaller, but all three now load on demand instead of up front.

## Gates — all green

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 7 warnings (all pre-existing, untouched files) |
| `npm test` | 124 files / 886 tests passed |
| `npm run smoke:core` | exit 0, `failures: []`, `warnings: []` |

## Notes
- An untracked `_claude_handoff/manual_sql_2026-07-05_bulk_review_ack.sql`
  exists on disk; it was not created by this task and is left untouched /
  excluded from these commits (chat-side hotfix awaiting its own handling).

STOP — not merged, not pushed. Awaiting Andrew's review.
