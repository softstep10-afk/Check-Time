# Shift Edit — custom 24-hour time inputs

**Branch:** `feature/24h-time-inputs` (off `claude/owner-dashboard-cleanup-rebased`)
**Scope:** `src/components/manager/ShiftEditDialog.tsx` only. No i18n changes (existing labels reused;
`"HH:MM"` is a locale-neutral literal). No route/POST changes.

## Why
`<input type="datetime-local">` renders an OS-controlled picker that forces AM/PM on US-locale
devices, confusing 24-hour shift entry. Replaced with a date picker + a custom 24-hour time field.

## What changed (input layer only)
Each of clock-in and clock-out is now a row of two inputs:
- `<input type="date">` (flex-1) — OS date picker (no AM/PM concern).
- A time **text** input: `inputMode="numeric"`, `placeholder="HH:MM"`, `maxLength=5`.
  - **Auto-colon:** keystrokes are formatted live (`formatTimeInput`) — digits only, capped at 4,
    colon inserted after the 2nd digit (type `1430` → `14:30`).
  - **Validation on blur:** `isValidTime` requires full `HH:MM` with `00–23` / `00–59`; on blur an
    invalid value shows a **red border** (`border-[var(--red)]`).
  - **Save gating:** a derived `canSave` disables the Save button while busy, when either date is
    empty, when either time is invalid, or (create mode) when no project is selected.

## State model
- Replaced the two `datetime-local` string states with `inDate`/`inTime`/`outDate`/`outTime`
  (+ `inTimeTouched`/`outTimeTouched`). Edit mode seeds them from the session ISO via
  `isoToLocalParts`; create mode starts empty.
- `localInputToIso` removed; `composeIso(date, time)` builds the ISO from the two parts
  (`new Date(\`${date}T${time}:00\`)`, local wall-clock → `toISOString()`), returning `null` if
  incomplete/invalid.
- `handleSave` composes both ISO values, keeps the existing `out > in` and create-project checks,
  and sends the same POST body/ISO strings as before — the server contract is unchanged.

## Preserved behavior
- **Crew hint** unchanged: create-mode hint day now reads `inDate` directly (already `YYYY-MM-DD`);
  edit-mode day still derives from the shift's clock-in. Effect dep `clockIn` → `inDate`.
- **Apply hint** still works and sets only the **time part** of clock-out:
  `setOutTime(formatHintTime(hint.to))` (marks it touched so it validates immediately).
- Project select, hint line, error text, cancel/save, and the modal shell are unchanged in behavior.

## Mobile-friendliness (repo rules)
- No width-based `sm:` breakpoints anywhere.
- Larger touch targets on all controls: `px-3 py-2.5 text-base` on the date/time/select inputs
  (up from `py-1.5 text-sm`); pill/apply/cancel/save buttons enlarged to match.

## Gates
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors (7 baseline warnings)
- `npm test` — 878 passed (121 files)
- `npm run smoke:core` — no failures, no warnings

Not merged/pushed at time of writing.
