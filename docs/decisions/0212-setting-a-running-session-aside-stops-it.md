# Setting a running session aside stops its claude

- **Date:** 2026-11-11
- **Area:** [Status cues](../architecture/status-cues.md#status-cues)

## Decision

What setting a session aside does to a claude running in a tab of it is `setAsideRunning` in the settings: `"stop-close"`, the default, asks claude to leave and closes the tab once it has gone, `"stop"` asks it to leave and keeps the tab cold, and `"keep"` leaves it running.
Claude is asked as Stop asks it, so a busy one is interrupted; a tab without a running claude, starting or already leaving is left as it is.
Every set aside raises a toast saying until when, from a session's menu too, whose only button is Undo; it comes at once and again as each claude goes, and its Undo puts it all back: the marks, the tabs it closed where they stood, and claude started again where it ran, as `undoRunning` says.
Closing a tab of a session that is set aside offers Clear set aside beside Undo, Finished and Set aside…, and a close of one tab says until when.

This replaces [0156](0156-a-sessions-menu-raises-no-toast-for-set-aside.md), which kept the menu's Set aside… without a toast, and the parts of [0171](0171-set-aside-opens-one-dialog-that-only-marks.md) and [0141](0141-a-tab-can-no-longer-be-paused.md) that had setting aside only mark, leaving the tab as it is.

## Why

A prompt you send in a session set aside takes the mark off, which is how picking a session up settles it.
With claude left running, the session went on asking for replies, and one reply, even a last instruction, took the mark off you had just set.
Stopping claude takes that away, and closing the tab puts the session out of sight as finishing does, while the list keeps its bookmark.
Since a set aside can now close a tab, it is no longer the quiet act 0156 described, so every one says what it did and offers its Undo.

## Turned down

- Refusing Set aside while claude runs: two presses, a stop and then the set aside, for what one press can do.
- Leaving claude running and offering only an Undo when a prompt takes the mark off: the toast is easy to miss, and the session stays live while set aside.
- A prompt no longer taking the mark off: a session you are working in again would go on carrying a mark that says to come back later, until you remembered to clear it.
- `"stop"` as the default: it keeps a cold tab per session set aside, and cold tabs piling up in the bar is what made pausing go ([0141](0141-a-tab-can-no-longer-be-paused.md)).
