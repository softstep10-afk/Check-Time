# Alpha-7 Realtime And Sync Hardening

Date: 2026-05-28

## Scope

This pass focused on live status stability without redesigning task, message, material, or notification business logic.

## Changes

- Manager project tasks use stable list comparison before replacing local state.
- Worker project tasks use stable list comparison before replacing local state.
- Worker project media uses stable list comparison before replacing local state.
- Project public notes receive realtime project row updates and merge into local note state.
- Existing task/message/material realtime helpers and offline queue behavior remain in place.

## Guardrails

- Realtime `UPDATE` events should merge by stable ids and fingerprints.
- Duplicate rows should not be added when the same event is delivered more than once.
- Notification clear remains a signal-state change only; it should not delete or hide source messages/tasks.
- Offline queued actions still must wait for server confirmation before confirmed success.

## Manual QA

- Open the same project as worker and owner/manager.
- Add a project note as worker and confirm owner/manager sees it without leaving the page.
- Take a task and confirm manager sees status update live.
- Complete a task and confirm manager sees done status live.
- Read a private message and confirm sender sees read status while the message remains in history.
- Clear a notification and confirm the source task/message remains visible.
