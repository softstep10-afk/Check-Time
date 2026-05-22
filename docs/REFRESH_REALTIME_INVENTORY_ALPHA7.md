# Alpha-7 Refresh / Realtime Inventory

This is a static inventory for stabilization. It is not a redesign plan.

## Manager Layout

- File: `src/app/(manager)/layout.tsx`
- Subscribes by route to broad operational tables.
- Purpose: keep manager pages fresh through `router.refresh()`.
- Fix Pack 4: Command Center burst refresh remains live but is debounced less aggressively to reduce route refresh storms.
- Deferred: app-wide channel consolidation and route-specific local reducers.

## Overview

- File: `src/components/manager/OverviewLiveIndicator.tsx`
- Subscribes to time events, tasks, media, projects, profiles, payroll closures.
- Purpose: server-rendered overview catch-up.
- Current status: already coalesces and cleans up channel.
- Deferred: replacing full overview refresh with local reducers.

## Worker Shell

- File: `src/components/worker/WorkerShell.tsx`
- Subscribes to worker profile, tasks, time events, media, assignments, exclusions, payroll closures, and projects.
- Purpose: keep worker shell/task/clock state current.
- Fix Pack 4: fallback new-task polling now skips hidden tabs and catches up on visibility return.
- Deferred: app-wide worker shell realtime consolidation.

## Worker Notification Bell

- File: `src/components/worker/NotificationBell.tsx`
- Subscribes to worker messages and polls every 30 seconds.
- Purpose: unread message signal and urgent overlay.
- Fix Pack 4: hidden-tab polling skipped; identical poll results keep stable state reference.
- Visible behavior: visibility return still reloads.

## Manager Work Alert Bell

- File: `src/components/manager/ManagerWorkAlertBell.tsx`
- Subscribes to manager messages/tasks and polls every 30 seconds.
- Purpose: manager message/task alert signal.
- Fix Pack 4: hidden-tab polling/realtime reload scheduling skipped; identical poll results keep stable state references.
- Visible behavior: visibility return still reloads.

## Messages

- Files: `src/components/manager/BulkMessageComposer.tsx`, `src/components/worker/WorkerMessagesPage.tsx`
- Purpose: message history realtime reload.
- Current status: already debounced and cleaned up from previous Fix Pack.
- Deferred: payload-based local reducers and message pagination.

## Schedule

- File: `src/app/(manager)/schedule/SchedulePageClient.tsx`
- Purpose: calendar data refresh for tasks/projects/profiles.
- Current status: debounced, hidden-tab pending flag, cleanup present.
- Deferred: query scope or schedule data loading redesign.

## Command Center

- File: `src/app/(manager)/command-center/page.tsx`
- Purpose: server-rendered operational dashboard.
- Current status: no direct client subscription in the page; refresh comes from manager layout.
- Fix Pack 4: manager-layout Command Center refresh debounce reduced refresh storm risk.
- Deferred: data loading redesign, pagination, virtualized lists, or local reducers.

## Jarvis / AI

- File: `src/components/manager/AiWorkspacePage.tsx`
- Purpose: owner/admin diagnostics and Jarvis actions.
- Current status: diagnostics localStorage/event load is gated by `canViewDiagnostics`.
- Fix Pack 4: no code change needed.
- Deferred: deeper diagnostics profiling if authenticated owner session is available.

## Project / Media

- Files: `src/components/manager/ProjectDetailPage.tsx`, `src/lib/task-attachments.ts`
- Purpose: media upload/open/download and project detail refresh.
- Fix Pack 4: upload debug logs removed.
- Deferred: media pagination/lazy loading and signed URL caching beyond current component lifecycle.
