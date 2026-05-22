# Alpha-7 Performance Baseline

This file records performance observations only. It is not a product redesign plan.

## Messages / Tasks / Notifications Fix Pack

Low-risk refresh changes applied:

- Worker message history now debounces repeated message realtime INSERT/UPDATE events.
- Worker notification bell now debounces repeated message realtime INSERT/UPDATE events.
- Manager work alert bell now debounces repeated message/task realtime events.
- Existing fallback polling and full reload behavior remains in place where event payloads are not enough to rebuild the full UI state.

Visible behavior preserved:

- Realtime was not removed.
- Record visibility was not changed.
- Message/task counts still come from the existing message/task queries.
- Notifications still clear by marking signals read, not by deleting source records.

Deferred performance work:

- Message/task pagination.
- Replacing full history reloads with complete payload-based local reducers.
- App-wide realtime channel consolidation.
- Broad revalidation strategy changes.
- Large component splitting.

Known limitation:

- No authenticated production timing baseline was captured in this pass. Owner should manually compare Messages, Tasks, and Command Center after deployment.
