# Alpha-7 Performance Report

Date: 2026-05-28

Mode: safe performance hardening only. No payroll, GPS, shift, archive/trash, role, material queue, or message/task lifecycle redesign.

## Findings

- Project detail views were vulnerable to unnecessary redraws when server-provided task/media arrays were refreshed with equivalent data.
- Worker project media was rendered as one mixed list, making visual scanning slower on mobile.
- Project public notes updated only through initial page data, so users could need navigation or refresh to see note changes.
- Existing realtime and offline queue helpers already provide dedupe patterns; this pass reused those patterns instead of introducing a new realtime architecture.
- Heavy areas that still deserve future profiling: Command Center aggregate cards, manager task dashboards, and very large project/media lists.

## Safe Optimizations Added

- Reused `keepStableListIfUnchanged` in manager project task lists.
- Reused `keepStableListIfUnchanged` in worker project task and media lists.
- Added project notes realtime merge for manager and worker project detail views.
- Added categorized project media library so users can switch directly to photos, videos, or documents.
- Kept open/download/delete behavior on the existing attachment components to avoid media permission changes.

## Before / After

Before:

- Project media appeared as one mixed list.
- Unchanged project task/media arrays could still replace local list state.
- Project note changes could require leaving and returning to the project.

After:

- Project media is grouped with counts by type.
- Equivalent task/media refreshes keep stable list references.
- Project note changes can update live in project detail views.

## Not Changed

- No query schema changed.
- No database tables or migrations changed.
- No RLS or Storage policy changed.
- No payroll, GPS, shift, archive/trash, or material queue business rule changed.
- No media delete semantics changed.
- No task/message lifecycle redesign.

## Recommended Future Profiling

- Add browser timing around mobile project open and first contentful render.
- Measure Command Center card rendering with large production-like data.
- Measure realtime event bursts during active task/material/message use.
- Consider virtualization only after owner confirms which lists regularly exceed mobile-friendly limits.
