# Push Task Assignment I18n

## Summary

Localized the task-assignment push notification title per recipient profile language.
The dispatch payload still uses the same fields and the same fire-and-forget
`dispatchNotification(assignedTo, { title, body, url, tag })` path.

## Branch / Base

- Current branch: `feature/push-task-i18n`
- Current HEAD: `e3db8f8` (`feature/push-phase2-triggers` tip)
- Local base caveat: local `codex/work` (`2d74e12`) does not contain the push
  trigger described in the task. The branch was created from
  `feature/push-phase2-triggers`, which is a descendant of `codex/work` and is
  the branch where `src/lib/server/task-dispatch.ts` contains the hardcoded
  assignment push title.
- No merge and no push performed.

## Changes

- `src/lib/server/task-dispatch.ts`
  - Adds `language` to the existing assignee profile lookup.
  - Normalizes profile language to the app-supported locales (`en`, `ru`).
  - Falls back to `defaultLocale` for null/unknown values.
  - Uses `serverT(..., "tasks.newTaskBanner")` for the push title.
  - Leaves `body: data.title`, `url: "/my-tasks"`, `tag: task:<id>`, and
    fire-and-forget behavior unchanged.

- `tests/lib/push-phase2-triggers.test.ts`
  - Extends the existing source guard to require the language lookup and
    translated title.
  - Guards against reintroducing the hardcoded Russian push title.

## Gates

- `npx tsc --noEmit`: PASS after syncing branch dependencies with `npm install`.
  The first run failed because local `node_modules` was missing the branch's
  existing `web-push` dependency; dependency sync made no tracked file changes.
- `npm run lint`: PASS with 7 pre-existing warnings, 0 errors.
- `npm run test`: PASS, 139 files / 977 tests. Existing push rejection test logs
  the expected swallowed error.
- `npm run smoke:core`: PASS, no failures and no warnings.
- `git diff --check`: PASS; only repo CRLF warnings were printed.

## Owner Next

Review the branch and decide whether the base should be corrected by advancing
`codex/work` to include the push-trigger line before merge. No push was done.
