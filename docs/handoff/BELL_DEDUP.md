# Manager notification bell — duplicate bell glyph fix

**Branch:** `fix/manager-bell-dedup` (off `claude/owner-dashboard-cleanup-rebased`)
**Date:** 2026-07-06
**Symptom:** Owner's July-6 screenshot shows TWO alert bells in the bottom area of
manager pages (desktop + mobile).

## Root cause (investigated before changing anything)
It is **not** a double mount and **not** a polling/BroadcastChannel issue:
- `src/app/(manager)/layout.tsx` mounts `<ManagerWorkAlertBell />` exactly once
  (line 458, `isManagerUser ? <ManagerWorkAlertBell /> : null`). Grep confirms that
  is the only mount site.
- There is only one `(manager)` layout (no nested layout re-rendering the shell).
- No React StrictMode double-render. The BroadcastChannel leader election dedupes
  duplicate *polling*, not rendering — untouched here as instructed.

The duplication is **inside the component's own render**. `ManagerWorkAlertBell`
renders two buttons side-by-side in one flex row, and BOTH used a bell glyph:
- the **mute toggle** button: `{muted ? <BellOff/> : <Bell/>}` (was line 590), and
- the actual **notifications** bell button: `<Bell/>` (line 604).

So in the normal (unmuted) state the owner saw two identical bell icons next to each
other and read it as a duplicated notification bell.

## Fix (minimal, surgical)
Give the mute-toggle button a speaker icon instead of a bell, leaving exactly one bell
(the notifications button) visible. `src/components/manager/ManagerWorkAlertBell.tsx`:
- Import: `Bell, BellOff` → `Bell, Volume2, VolumeX` (drop `BellOff`, keep `Bell` for
  the notifications button, add the volume icons for mute state).
- Mute button icon: `{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}`.

Two lines changed. No layout restructuring, no change to mute behavior/state, no change
to polling/BroadcastChannel/realtime logic. The bell lives in a single fixed container
(`fixed bottom-24 right-4 ... md:bottom-5 md:right-5`), so one-bell holds on both mobile
and desktop breakpoints.

## Gates
| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (7 pre-existing warnings, none in this file) |
| `npm test` | 999 passed / 999 (141 files) |
| `npm run smoke:core` | 0 failures, 0 warnings |

Stopped here — no merge, no push.

## Needs owner eyeball
Confirm on a manager page (desktop + phone) that the bottom-right control now shows a
single bell plus a speaker/mute toggle, and that tapping the speaker still mutes/unmutes
the chime (icon flips to the muted speaker).
