# Push notifications — Phase 2 (production triggers)

**Branch:** `feature/push-phase2-triggers` (off `origin/claude/owner-dashboard-cleanup-rebased` @ `4b60486`)
**Scope:** two triggers (message → push, task-assignment → push) + the server-route cleanup the message
trigger forces. Not merged/pushed.

## Call-site map + verdicts

**`from("messages")` sites:**
| Site | Op | Verdict |
|---|---|---|
| `ForceCheckoutButton.tsx` | insert (mgr→worker) | **CONVERTED** → `sendMessagesViaApi` → `/api/messages/send` |
| `SendMessageForm.tsx` online DM | insert (mgr→worker) | **CONVERTED** |
| `BulkMessageComposer.tsx` online broadcast (chunked) | insert (mgr→workers) | **CONVERTED** |
| `SendMessageForm`/`BulkMessageComposer` `syncQueuedMessages` (offline drain) | insert | **LEFT** — offline queue (RED LINE); no push on drain (see gap) |
| `WorkerShell.tsx` offline field-action drain | insert | **LEFT** — worker-origin + offline queue |
| `NotificationBell`, `WorkerMessagesPage`, `ManagerWorkAlertBell`, `tasks/seen`, `message-tasks`, composers' history | select/update | **NO-OP** — reads / mark-seen / worker-origin |

**Task-creation sites:** all four task-creating routes (`manager/tasks`, `manager/message-tasks`,
`ai/actions/create-task`, `worker/project-tasks`) go through **one choke point:
`createManagerTask` (`src/lib/server/task-dispatch.ts`)** — which already validates the assignee is
in-org. `schedule` and `material-orders` create tasks via a *different* path (not `createManagerTask`),
so they are **outside** the named trigger set (flagged, not wired).

## Trigger 2 — task assignment (one change, all routes)
In `createManagerTask`, after the successful insert:
`if (assignedTo) dispatchNotification(assignedTo, {title:"Новая задача", body: task.title, url:"/my-tasks", tag:"task:<id>"})`.
- Fires only on create-with-assignee (this helper never runs on status changes → "not on status changes" holds).
- Naturally scoped to workers: only worker profiles hold push subscriptions, so a manager/no-subscription
  assignee is a natural no-op (`sendNotificationToProfile` finds 0 subscriptions). No extra role query.

## Trigger 1 — message send (the forced cleanup)
Manager components inserted into `messages` straight from the browser, which can't dispatch a push. New
**`POST /api/messages/send`** is the single authenticated write path:
- Auth-gated (`getUser` → 401); sender must be **manager-tier** (`isManagerRole` → 403 otherwise).
- **Stamps `org_id`/`sender_id` from the server profile** — a tampered client can't forge them.
- **Validates every recipient is a profile in the sender's org** (→ 403 otherwise).
- Inserts the same rows/fields (chunked 50, with the same priority-column fallback), service-role.
- Fire-and-forget push to **each distinct recipient, never the sender** (title = sender name, body = ~120-char
  preview, url `/my-messages`, tag `msg:<recipient>` to collapse per recipient).

Client side: **`src/lib/messages-client.ts` `sendMessagesViaApi(rows)`** returns a supabase-insert-shaped
`{data, error}`, so the three sites are near drop-in. A network failure surfaces as a network-like error, so
each component's **existing offline-queue fallback still fires** (`isNetworkLikeFieldError` →
`queueOfflineFieldAction`), and the downstream **task-creation** logic (`/api/manager/message-tasks`) is
unchanged.

## Fire-and-forget guarantee
`src/lib/notifications/dispatch.ts` `dispatchNotification` runs the send via Next **`after()`** (executes
after the HTTP response is flushed → never delays the write), swallows all errors (never throws), and falls
back to a detached promise if there's no request scope. So **a push failure can never fail or delay a
message/task write** (unit-tested).

## RED LINE compliance
- Fire-and-forget (no delay, no throw into the response path). ✅
- Message/task behavior unchanged — same rows/fields; recipient-in-org verified; service-role/server pattern
  consistent with `clock-in`. ✅
- **Offline queues untouched** (`sw.ts`, `offline-*`, drain paths, WorkerShell drain all unchanged); payroll
  and manager-page data structures untouched (verified: git diff touches none of them). ✅

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 7 baseline warnings
- `npm test` — 977 passed (+11 `push-phase2-triggers`)
- `npm run smoke:core` — no failures, no warnings
- `npm run build` — succeeds; `/api/messages/send` builds; worker inspection shows the Task 2.1 guardrail
  still holds (`precacheAndRoute`=0, `NavigationRoute`=0, nav/RSC + `sameOrigin` guards) — `sw.ts` untouched.

## Known gaps / decisions (flagged)
- **Offline-sent messages don't push on drain.** A message queued offline (manager sent while offline) is
  inserted directly by the drain, which can't easily dispatch a push without touching the offline queue
  (RED LINE). The recipient still gets the message; they just don't get a push for it. Low-frequency (managers
  are on the dashboard). Wireable later without a schema change (drain → route) if desired.
- **Task push title is RU (`"Новая задача"`).** The push is generated server-side where the *recipient's*
  locale isn't readily available; the app default locale is `ru` and the crew is RU-speaking. Could be
  localized per `profiles.language` in a follow-up. (The message push needs no i18n — title is the sender's
  name, body is the manager's own text.)

## Needs your live verification after deploy (Phase 1 env + migration must already be live)
On a device where a worker has **enabled push** (Phase 1 toggle) and has a `push_subscriptions` row:
1. **DM:** a manager sends that worker a message → the worker gets a push (title = sender name, body =
   preview); tapping it opens `/my-messages`. The message still appears normally.
2. **Bulk broadcast:** manager broadcasts → each subscribed recipient gets **one** push; the **sender gets
   none**.
3. **Force checkout:** manager force-checks-out that worker → the worker gets the checkout-notice push.
4. **Task assignment:** create/assign a task to that worker (manager Tasks board, AI create-task, and the
   message→task flow) → the worker gets a **"Новая задача"** push; tapping opens `/my-tasks`. A **status
   change** on an existing task must **not** push.
5. **No-regression:** confirm messages/tasks still write even if VAPID/push is misconfigured (push is
   fire-and-forget); confirm a message **sent while offline** still queues and syncs (no push on drain).
6. Watch server logs for `[push]` dispatch warnings (they indicate a dead/expired subscription being
   revoked — expected occasionally, harmless).

Not merged/pushed at time of writing.
