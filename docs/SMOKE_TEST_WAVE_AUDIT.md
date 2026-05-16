# WaveAudit Recovery Smoke Test

Run this checklist after applying the pending migrations and before promoting the branch to production.

## Setup

- Open the target deployment in a clean browser session.
- Test one owner/admin account and one worker PIN account.
- Keep DevTools Network open while checking media, payroll, and Jarvis surfaces.

## PIN Login

- Valid PIN logs in and lands on the correct manager or worker shell.
- Repeated invalid PIN attempts eventually return a lockout/rate-limit message with HTTP 429, then a valid PIN works again after the lockout window.

## Manager Pages

- Overview loads, shows live indicator, active objects, command summary, review queue, worker presence, and the Jarvis dock without blocking navigation.
- Projects list loads active projects first by urgency, shows Washington-only map state, project status dots, timeline badge, and planning/material summary without opening external windows.
- Project detail opens a project, saves notes/GPS/project dates, shows planning materials, estimates, invoices, extra work, media, tasks, crew, and archive action without leaking finance fields to non-finance managers.
- Team page shows grouped owners, managers, supervisors, sales, drivers, workers, and subcontractors; create, edit, message, reset PIN, and deactivate flows stay org-scoped.
- Payroll page creates a draft period, filters by worker/date, blocks payment when unreviewed shifts are included, and marks reviewed/paid hours as closed after payment.
- Payroll history filters by date range and shows paid/approved/draft periods with correct paid date and worker count.
- Timeline shows readable shift entries, review state, video/GPS badges, and does not show contradictory "needs review" plus "reviewed" states.
- Schedule opens full-month calendar, allows day modal entries, project dates, meetings, inspections, subcontractor meetings, delivery entries, assignee selection, and status changes.
- Jarvis page/settings loads owner-visible configuration, memory/rules, skills/access descriptions, and does not expose worker-only controls.
- Settings/admin pages load owner settings, permissions, audit log, and finance access controls without showing stale "AI" branding where Jarvis is expected.

## Worker Pages

- Hours page shows paid/closed and unpaid/open badges; paid periods remain visible but no finance totals beyond worker-safe payroll visibility are exposed.
- Tasks page shows personal tasks and project tasks; delivery tasks can be claimed and completed, and the manager view updates after the claim.
- Project view opens assigned/all-active projects only, shows active project tasks, notes, media upload, materials/spec list, and worker-safe Jarvis text mode.
- Checkout modal respects live `require_video`: workers without required video can close a shift, workers with required video must attach proof, GPS/no-GPS state is recorded, and checkout succeeds from both Shift and Project screens.

## Jarvis

- Owner text question can answer from workspace snapshot, such as active projects, latest shifts, material totals, payroll-visible summaries, and urgent tasks.
- Worker text question is available in worker-safe mode and refuses or omits financial details.
- Voice realtime connects when OpenAI billing/key are configured; first call should prewarm faster than before, and the orb should animate only while listening/speaking/thinking.
- Memory rule persistence saves an owner rule, shows it under Jarvis memory/rules, and includes it in later owner answers.

## Payroll Guard

- A payroll run containing unreviewed suspicious shifts is blocked before payment and tells the manager which shifts need review.
- After the shifts are reviewed, the same worker/date period can be paid once, and a second payment attempt should not create duplicate closure or ledger rows.

## Org-Scoped Writes

Code review confirms that server routes taking client-supplied IDs enforce org scope before service-role writes:

- `/api/manager/projects`, `/api/manager/projects/[id]`, `/api/manager/projects/[id]/archive`, and `/api/manager/projects/[id]/planning` read the manager context and constrain project reads/writes by `profile.org_id`.
- `/api/team/create`, `/api/team/delete`, `/api/team/reset-pin`, and `/api/team/pay-worker` read manager context and constrain target profiles/payroll rows by `manager.org_id`.
- `/api/worker/project-tasks`, `/api/worker/claim-task`, `/api/worker/clock-out`, `/api/worker/link-checkin-video`, and `/api/worker/link-checkout-video` validate the authenticated worker, project/task/time-event ownership, and matching `org_id`.
- `/api/schedule` validates actor org, project org, assignee org, and task org before schedule/task writes.
- `/api/media/transcode` reads media through the caller's RLS-scoped client first, then constrains service-role updates by the media row's `org_id`.
- `/api/media/mux-webhook` verifies the Mux signature before service-role updates and constrains updates by the matched media row's `org_id`.
- `/api/ai/actions/create-project`, `/api/ai/photo-analysis`, and Jarvis API routes use manager/AI auth context and constrain writes by the authenticated org.
